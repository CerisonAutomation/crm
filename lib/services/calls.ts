/**
 * Peer-to-peer case calling service.
 *
 * Media never touches the server: peers negotiate a WebRTC connection and the
 * server only relays SDP/ICE signaling through `CallSignal` rows. Signaling
 * rides the app's own authenticated REST API (short-poll) rather than the
 * separate socket.io chat mini-service so calling works whenever the app works.
 * See docs/p2p-calling-research.md for the full design and trade-offs.
 *
 * All authorization is derived server-side from `AuthContext` + the case; a
 * caller never supplies their own user id, role or side.
 */
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";
import { notifyUser } from "@/lib/services/notify";
import { audit } from "@/lib/api-helpers";
import type { AuthContext } from "@/lib/auth";

export type CallSide = "CLIENT" | "STAFF";
export type CallRow = {
  id: string;
  caseId: string;
  caseReference: string;
  kind: "AUDIO" | "VIDEO";
  status: string;
  callerRole: CallSide;
  initiatedBy: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  counterparty: { name: string; role: string } | null;
};

/** Relation selection shared by every query that produces a `CallRow`. */
const CALL_INCLUDE = {
  case: {
    select: {
      id: true,
      reference: true,
      clientId: true,
      client: { select: { name: true } },
      assignments: { select: { user: { select: { name: true, role: true } } } },
    },
  },
};

/** Structural shape the shared mapper needs (Prisma's inferred result is a superset). */
type CallWithCase = {
  id: string;
  caseId: string;
  kind: string;
  status: string;
  callerRole: string;
  initiatedBy: string;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  case: {
    id: string;
    reference: string;
    clientId: string;
    client: { name: string } | null;
    assignments: Array<{ user: { name: string; role: string } }>;
  };
};

const RING_TIMEOUT_MS = 90_000;
const MAX_SIGNAL_BYTES = 15_000;
const MAX_SIGNALS_PER_POLL = 100;
const MAX_CALLS = 30;

const actorName = (ctx: AuthContext) => `${ctx.name} [${ctx.role}]`;

/**
 * Object-level access check derived from the case. `AUDITOR` can never call
 * (read-only oversight). A `CLIENT` may only reach their own case; any staff
 * role is scoped to its own organisation. Returns the caller's `side` plus the
 * case facts needed by callers.
 */
async function loadCaseForCall(ctx: AuthContext, caseId: string) {
  const c = await db.case.findUnique({
    where: { id: caseId },
    select: { id: true, reference: true, orgId: true, clientId: true },
  });
  if (!c) throw new DomainError("Case not found", 404);
  if (ctx.role === "AUDITOR")
    throw new DomainError(
      "Forbidden: auditors cannot participate in calls",
      403
    );
  if (ctx.role === "CLIENT") {
    if (c.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
  } else if (c.orgId !== ctx.orgId) {
    throw new DomainError("Forbidden", 403);
  }
  const side: CallSide = c.clientId === ctx.userId ? "CLIENT" : "STAFF";
  return { c, side };
}

/** The counterparty to show the viewer: a staff viewer sees the client; a client sees their RM. */
function pickCounterparty(
  call: CallWithCase,
  viewerId: string
): { name: string; role: string } | null {
  const client = call.case.client;
  if (call.case.clientId === viewerId) {
    const rm = call.case.assignments[0]?.user;
    if (rm) return { name: rm.name, role: rm.role };
  }
  return client ? { name: client.name, role: "CLIENT" } : null;
}

/** Single shared mapper from a persisted call to the wire-safe `CallRow`. */
function toCallRow(call: CallWithCase, viewerId: string): CallRow {
  return {
    id: call.id,
    caseId: call.caseId,
    caseReference: call.case.reference,
    kind: call.kind === "AUDIO" ? "AUDIO" : "VIDEO",
    status: call.status,
    callerRole: call.callerRole === "CLIENT" ? "CLIENT" : "STAFF",
    initiatedBy: call.initiatedBy,
    startedAt: call.startedAt.toISOString(),
    answeredAt: call.answeredAt ? call.answeredAt.toISOString() : null,
    endedAt: call.endedAt ? call.endedAt.toISOString() : null,
    endReason: call.endReason,
    counterparty: pickCounterparty(call, viewerId),
  };
}

export async function resolveCallAccess(
  ctx: AuthContext,
  caseId: string
): Promise<{
  side: CallSide;
  caseReference: string;
  orgId: string;
  counterpartyIds: string[];
}> {
  const { c, side } = await loadCaseForCall(ctx, caseId);

  let counterpartyIds: string[];
  if (side === "CLIENT") {
    const assignments = await db.caseAssignment.findMany({
      where: { caseId: c.id },
      select: { userId: true },
    });
    counterpartyIds = assignments.map((a) => a.userId);
    if (counterpartyIds.length === 0) {
      const pool = await db.user.findMany({
        where: {
          orgId: c.orgId,
          role: { in: ["RM", "SENIOR_RM"] },
          status: "ACTIVE",
        },
        select: { id: true },
      });
      counterpartyIds = pool.map((u) => u.id);
    }
  } else {
    counterpartyIds = [c.clientId];
  }
  return { side, caseReference: c.reference, orgId: c.orgId, counterpartyIds };
}

export async function startCall(
  ctx: AuthContext,
  caseId: string,
  kind: "AUDIO" | "VIDEO"
): Promise<CallRow> {
  const access = await resolveCallAccess(ctx, caseId);

  const existing = await db.callSession.findFirst({
    where: { caseId, status: { in: ["RINGING", "ACTIVE"] } },
    select: { id: true },
  });
  if (existing)
    throw new DomainError("A call is already in progress for this case", 409);

  const created = await db.callSession.create({
    data: {
      caseId,
      orgId: access.orgId,
      kind,
      status: "RINGING",
      initiatedBy: ctx.userId,
      callerRole: access.side,
    },
    include: CALL_INCLUDE,
  });

  const title = `${
    kind === "VIDEO" ? "Incoming video call" : "Incoming call"
  } — ${access.caseReference}`;
  for (const userId of access.counterpartyIds) {
    if (userId === ctx.userId) continue;
    try {
      await notifyUser({
        userId,
        category: "CASE",
        title,
        body: `${ctx.name} is calling from the case dashboard. Open the case to answer.`,
        caseId,
      });
    } catch (err) {
      // A failed notification must never abort the call.
      console.error("[calls] startCall notify failed", err);
    }
  }

  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorName(ctx),
    action: "call.started",
    target: access.caseReference,
    after: { kind, callId: created.id },
  });

  return toCallRow(created, ctx.userId);
}

export async function listCalls(
  ctx: AuthContext,
  opts: { caseId?: string; active?: boolean }
): Promise<CallRow[]> {
  if (ctx.role === "AUDITOR")
    throw new DomainError(
      "Forbidden: auditors cannot participate in calls",
      403
    );
  if (opts.caseId) await resolveCallAccess(ctx, opts.caseId);

  const scope =
    ctx.role === "CLIENT"
      ? { case: { clientId: ctx.userId } }
      : { case: { orgId: ctx.orgId } };
  const caseFilter = opts.caseId ? { caseId: opts.caseId } : {};

  // Expire stale rings before reading — a caller is notified once per expiry.
  const cutoff = new Date(Date.now() - RING_TIMEOUT_MS);
  const stale = await db.callSession.findMany({
    where: {
      status: "RINGING",
      startedAt: { lt: cutoff },
      ...caseFilter,
      ...scope,
    },
    include: CALL_INCLUDE,
    take: MAX_CALLS,
  });
  for (const s of stale) {
    await db.callSession.update({
      where: { id: s.id },
      data: { status: "MISSED", endedAt: new Date(), endReason: "no-answer" },
    });
    try {
      await notifyUser({
        userId: s.initiatedBy,
        category: "CASE",
        title: `Call not answered — ${s.case.reference}`,
        body: "Your call was not answered. The case remains available to call again.",
        caseId: s.caseId,
      });
    } catch (err) {
      console.error("[calls] stale-ring notify failed", err);
    }
  }

  const rows = await db.callSession.findMany({
    where: {
      ...caseFilter,
      ...(opts.active ? { status: { in: ["RINGING", "ACTIVE"] } } : undefined),
      ...scope,
    },
    include: CALL_INCLUDE,
    orderBy: { startedAt: "desc" },
    take: MAX_CALLS,
  });
  return rows.map((r) => toCallRow(r, ctx.userId));
}

export async function getCallForUser(
  ctx: AuthContext,
  callId: string
): Promise<{ call: CallRow; side: CallSide }> {
  const call = await db.callSession.findUnique({
    where: { id: callId },
    include: CALL_INCLUDE,
  });
  if (!call) throw new DomainError("Call not found", 404);
  const { side } = await loadCaseForCall(ctx, call.caseId);
  return { call: toCallRow(call, ctx.userId), side };
}

/** Shared teardown used by `actOnCall("end")` and by a `HANGUP` signal. */
async function endCallInternal(
  ctx: AuthContext,
  call: CallWithCase,
  side: CallSide,
  reference: string
): Promise<CallRow> {
  if (call.status !== "RINGING" && call.status !== "ACTIVE") {
    throw new DomainError(`Cannot end a call in state ${call.status}`, 409);
  }
  const wasRinging = call.status === "RINGING";
  const reason = side === call.callerRole ? "hung-up" : "remote-hung-up";
  const updated = await db.callSession.update({
    where: { id: call.id },
    data: {
      status: wasRinging ? "MISSED" : "ENDED",
      endedAt: new Date(),
      endedBy: ctx.userId,
      endReason: reason,
    },
    include: CALL_INCLUDE,
  });
  if (wasRinging) {
    try {
      await notifyUser({
        userId: call.initiatedBy,
        category: "CASE",
        title: `Call not answered — ${reference}`,
        body: "Your call was not answered.",
        caseId: call.caseId,
      });
    } catch (err) {
      console.error("[calls] end notify failed", err);
    }
  }
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorName(ctx),
    action: "call.ended",
    target: reference,
    after: { callId: call.id, reason },
  });
  return toCallRow(updated, ctx.userId);
}

export async function actOnCall(
  ctx: AuthContext,
  callId: string,
  action: "answer" | "decline" | "end"
): Promise<CallRow> {
  const call = await db.callSession.findUnique({
    where: { id: callId },
    include: CALL_INCLUDE,
  });
  if (!call) throw new DomainError("Call not found", 404);
  const { side, c } = await loadCaseForCall(ctx, call.caseId);
  const reference = c.reference;
  const isCaller = side === call.callerRole;

  if (action === "answer") {
    if (isCaller)
      throw new DomainError("The caller cannot answer their own call", 409);
    if (call.status !== "RINGING")
      throw new DomainError(
        `Cannot answer a call in state ${call.status}`,
        409
      );
    const updated = await db.callSession.update({
      where: { id: callId },
      data: { status: "ACTIVE", answeredAt: new Date() },
      include: CALL_INCLUDE,
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorName(ctx),
      action: "call.answered",
      target: reference,
      after: { callId: call.id },
    });
    return toCallRow(updated, ctx.userId);
  }

  if (action === "decline") {
    if (isCaller)
      throw new DomainError("The caller cannot decline their own call", 409);
    if (call.status !== "RINGING")
      throw new DomainError(
        `Cannot decline a call in state ${call.status}`,
        409
      );
    const updated = await db.callSession.update({
      where: { id: callId },
      data: { status: "DECLINED", endedAt: new Date(), endedBy: ctx.userId },
      include: CALL_INCLUDE,
    });
    try {
      await notifyUser({
        userId: call.initiatedBy,
        category: "CASE",
        title: `Call declined — ${reference}`,
        body: `${ctx.name} declined your call.`,
        caseId: call.caseId,
      });
    } catch (err) {
      console.error("[calls] decline notify failed", err);
    }
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorName(ctx),
      action: "call.declined",
      target: reference,
      after: { callId: call.id },
    });
    return toCallRow(updated, ctx.userId);
  }

  return endCallInternal(ctx, call, side, reference);
}

export async function appendSignal(
  ctx: AuthContext,
  callId: string,
  kind: "OFFER" | "ANSWER" | "ICE" | "HANGUP" | "SUBTITLE" | "CONSENT",
  payload: Record<string, unknown>
): Promise<{ seq: number }> {
  const call = await db.callSession.findUnique({
    where: { id: callId },
    include: CALL_INCLUDE,
  });
  if (!call) throw new DomainError("Call not found", 404);
  const { side, c } = await loadCaseForCall(ctx, call.caseId);

  if (call.status !== "RINGING" && call.status !== "ACTIVE") {
    throw new DomainError(
      `Call is not accepting signals (status ${call.status})`,
      409
    );
  }

  // Recording consent is server-stamped proof (byUserId/at) — a caller can
  // never forge the counterparty's ack, only their own side's.
  const effective =
    kind === "CONSENT"
      ? { byUserId: ctx.userId, role: side, at: new Date().toISOString() }
      : payload && typeof payload === "object"
      ? payload
      : {};
  const serialized = JSON.stringify(effective);
  if (serialized.length > MAX_SIGNAL_BYTES) {
    throw new DomainError("Signal payload exceeds 15000 characters", 400);
  }

  const max = await db.callSignal.aggregate({
    where: { callId },
    _max: { seq: true },
  });
  let seq = (max._max.seq ?? 0) + 1;
  try {
    await db.callSignal.create({
      data: { callId, seq, role: side, kind, payload: serialized },
    });
  } catch {
    // Concurrent writers may collide on the unique (callId, seq) — re-read once.
    const re = await db.callSignal.aggregate({
      where: { callId },
      _max: { seq: true },
    });
    seq = (re._max.seq ?? 0) + 1;
    await db.callSignal.create({
      data: { callId, seq, role: side, kind, payload: serialized },
    });
  }

  if (kind === "HANGUP") {
    await endCallInternal(ctx, call, side, c.reference);
  }

  return { seq };
}

export async function signalsAfter(
  ctx: AuthContext,
  callId: string,
  afterSeq: number
): Promise<{
  status: string;
  signals: Array<{ seq: number; kind: string; payload: string }>;
}> {
  const call = await db.callSession.findUnique({ where: { id: callId } });
  if (!call) throw new DomainError("Call not found", 404);
  const { side } = await loadCaseForCall(ctx, call.caseId);

  // Never echo a side's own signals back — a peer only reads the counterpart's rows.
  const signals = await db.callSignal.findMany({
    where: { callId, seq: { gt: afterSeq }, role: { not: side } },
    orderBy: { seq: "asc" },
    take: MAX_SIGNALS_PER_POLL,
    select: { seq: true, kind: true, payload: true },
  });

  return { status: call.status, signals };
}

// ─────────────────────────── transcript & recording ───────────────────────────

export type CallTranscript = {
  transcript: string;
  transcriptUpdatedAt: string | null;
  recordingRequested: boolean;
  /** Dual-consent proof: one server-stamped ack per side; transcript stays hidden until both exist. */
  consentComplete: boolean;
  consents: Array<{ byUserId: string; role: string; at: string }>;
};

const MAX_TRANSCRIPT = 40_000;

/** Parse one stored CONSENT payload; foreign/malformed rows never count. */
function parseCallConsent(row: {
  role: string;
  payload: string;
}): { byUserId: string; role: string; at: string } | null {
  try {
    const data = JSON.parse(row.payload) as {
      byUserId?: unknown;
      at?: unknown;
    };
    if (typeof data.byUserId !== "string" || !data.byUserId) return null;
    if (typeof data.at !== "string" || !data.at) return null;
    if (row.role !== "CLIENT" && row.role !== "STAFF") return null;
    return { byUserId: data.byUserId, role: row.role, at: data.at };
  } catch {
    return null;
  }
}

/**
 * Dual recording consent for a 1:1 call. Each side stamps exactly one ack
 * (first CONSENT row per role wins); `complete` is true only when BOTH the
 * CLIENT side and the STAFF side have acked. Audio itself is never stored
 * server-side — consent gates the transcript only.
 */
export async function recordingConsentStatus(
  callId: string
): Promise<Pick<CallTranscript, "consentComplete" | "consents">> {
  const rows = await db.callSignal.findMany({
    where: { callId, kind: "CONSENT" },
    orderBy: { seq: "asc" },
    select: { role: true, payload: true },
  });
  const seen = new Set<string>();
  const consents: Array<{ byUserId: string; role: string; at: string }> = [];
  for (const row of rows) {
    if (seen.has(row.role)) continue;
    const entry = parseCallConsent(row);
    if (!entry) continue;
    seen.add(row.role);
    consents.push(entry);
  }
  return {
    consentComplete: seen.has("CLIENT") && seen.has("STAFF"),
    consents,
  };
}

/** Record the caller's own side ack (idempotent — a second ack is a no-op). */
export async function acknowledgeRecordingConsent(
  ctx: AuthContext,
  callId: string
): Promise<{ consentComplete: boolean }> {
  const call = await db.callSession.findUnique({ where: { id: callId } });
  if (!call) throw new DomainError("Call not found", 404);
  const { side } = await loadCaseForCall(ctx, call.caseId);
  if (call.status !== "RINGING" && call.status !== "ACTIVE") {
    throw new DomainError(
      `Call is not accepting signals (status ${call.status})`,
      409
    );
  }
  const status = await recordingConsentStatus(callId);
  if (status.consents.some((c) => c.role === side))
    return { consentComplete: status.consentComplete };
  await appendSignal(ctx, callId, "CONSENT", {});
  return recordingConsentStatus(callId);
}

/**
 * Read a call's transcript (participants only — auditors/foreign users get 403).
 * The text stays hidden until BOTH sides have acked recording consent; the
 * consent proof itself is always visible so each side can see what is missing.
 */
export async function getCallTranscript(
  ctx: AuthContext,
  callId: string
): Promise<CallTranscript> {
  const call = await db.callSession.findUnique({ where: { id: callId } });
  if (!call) throw new DomainError("Call not found", 404);
  await loadCaseForCall(ctx, call.caseId);
  const { consentComplete, consents } = await recordingConsentStatus(callId);
  return {
    transcript: consentComplete ? call.transcript ?? "" : "",
    transcriptUpdatedAt:
      consentComplete && call.transcriptUpdatedAt
        ? call.transcriptUpdatedAt.toISOString()
        : null,
    recordingRequested: call.recordingRequested,
    consentComplete,
    consents,
  };
}

/**
 * Autosave the live transcript, toggle the recording-consent flag, and/or
 * record this side's consent ack (`consentGiven: true`). Only participants may
 * write; the timestamp only moves when the text changes (so a chatty autosave
 * loop does not churn rows). Never stores audio — text only.
 */
export async function saveCallTranscript(
  ctx: AuthContext,
  callId: string,
  input: {
    transcript?: string;
    recordingRequested?: boolean;
    consentGiven?: boolean;
  }
): Promise<CallTranscript> {
  const call = await db.callSession.findUnique({ where: { id: callId } });
  if (!call) throw new DomainError("Call not found", 404);
  await loadCaseForCall(ctx, call.caseId);

  const data: {
    transcript?: string;
    transcriptUpdatedAt?: Date;
    recordingRequested?: boolean;
  } = {};

  if (typeof input.transcript === "string") {
    const text = input.transcript.slice(0, MAX_TRANSCRIPT);
    if (text !== (call.transcript ?? "")) {
      data.transcript = text;
      data.transcriptUpdatedAt = new Date();
    }
  }

  if (input.consentGiven === true) {
    await acknowledgeRecordingConsent(ctx, callId);
  }

  // Dual-consent firewall: no transcript byte is stored before BOTH sides ack.
  // (The ack above runs first, so a combined ack+transcript write still lands.)
  if (typeof input.transcript === "string") {
    const incoming = input.transcript.slice(0, MAX_TRANSCRIPT);
    if (incoming !== (call.transcript ?? "")) {
      const { consentComplete } = await recordingConsentStatus(callId);
      if (!consentComplete) {
        throw new DomainError(
          "Recording consent incomplete: both sides must acknowledge before the transcript is stored",
          403
        );
      }
    }
  }

  if (
    typeof input.recordingRequested === "boolean" &&
    input.recordingRequested !== call.recordingRequested
  ) {
    data.recordingRequested = input.recordingRequested;
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorName(ctx),
      action: input.recordingRequested
        ? "call.recording_requested"
        : "call.recording_withdrawn",
      target: call.caseId,
      after: { callId: call.id },
    });
  }

  const updated = Object.keys(data).length
    ? await db.callSession.update({ where: { id: callId }, data })
    : call;

  // The gate lives in one place: whatever was just written, the reader sees
  // exactly what getCallTranscript would return.
  return getCallTranscript(ctx, callId).then((gated) => ({
    ...gated,
    recordingRequested: updated.recordingRequested,
  }));
}
