/**
 * Multi-party internal meetings (server-only).
 *
 * Media is a WebRTC **mesh**: every peer connects directly to every other peer,
 * and the server only relays SDP/ICE and mute/camera state through
 * `MeetingSignal` rows (the same REST-signaling pattern as 1:1 case calling).
 * The mesh is hard-capped at 4 participants because each peer needs an uplink
 * stream per peer; beyond that an SFU (mediasoup/LiveKit) is the documented
 * answer. Recordings live in the vault (`storagePutWithHistory`) and the on-device
 * transcript is saved explicitly by the host afterwards.
 *
 * AUDITOR and CLIENT are denied every meeting surface; ADMIN reaches any meeting
 * in their organisation; staff may reach a meeting they host/attend or that
 * belongs to one of their teams. Authorization is derived entirely server-side.
 */
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";
import { requireCapability, type AuthContext } from "@/lib/auth";
import { notifyUser, type NotifyInput } from "@/lib/services/notify";
import { audit, actorLabel } from "@/lib/api-helpers";
import { storagePutWithHistory, storageGet } from "@/lib/storage";
import { sniffAudioMime, stripDataUrl } from "@/lib/media/audio";
import { assertTeamAccess } from "@/lib/services/teams";

const MAX_PARTICIPANTS = 4;
const MAX_SIGNAL_CHARS = 15_000;
const MAX_SIGNALS_PER_POLL = 200;
const MAX_MEETING_TRANSCRIPT = 400_000;
const MAX_RECORDING_BYTES = 25 * 1024 * 1024; // 25 MB

const SIGNAL_KINDS = [
  "OFFER",
  "ANSWER",
  "ICE",
  "HANGUP",
  "STATE",
  "CONSENT",
] as const;

export type MeetingParticipantRow = {
  userId: string;
  name: string;
  role: "HOST" | "MEMBER";
  micOn: boolean;
  cameraOn: boolean;
  joinedAt: string;
};

export type MeetingRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  teamId: string | null;
  caseId: string | null;
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  participants: MeetingParticipantRow[];
  myRole: "HOST" | "MEMBER";
  maxParticipants: number;
  recordingBytes: number | null;
  recordingDurationMs: number | null;
  transcriptStatus: string;
};

export type StartMeetingInput = {
  teamId?: string;
  caseId?: string;
  title?: string;
  kind?: string;
};
export type MeetingStateInput = { micOn?: boolean; cameraOn?: boolean };
export type MeetingSignalInput = {
  toUserId: string | null;
  kind: string;
  payload: Record<string, unknown>;
};
export type MeetingRecordingInput = {
  audioBase64: string;
  mime?: string;
  durationMs?: number;
  consentGiven?: boolean;
};

export type RecordingConsentEntry = { byUserId: string; at: string };

// ── helpers ──

function meetingInclude() {
  return { participants: { orderBy: { joinedAt: "asc" as const } } };
}

async function notifySafe(input: NotifyInput) {
  try {
    await notifyUser(input);
  } catch (err) {
    console.error("[meetings] notify failed", err);
  }
}

function formatDateTime(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

type MeetingRowInput = {
  id: string;
  title: string;
  kind: string;
  status: string;
  teamId: string | null;
  caseId: string | null;
  startedBy: string;
  startedAt: Date;
  endedAt: Date | null;
  maxParticipants: number;
  recordingBytes: number | null;
  recordingDurationMs: number | null;
  transcriptStatus: string;
  participants: Array<{
    userId: string;
    role: string;
    micOn: boolean;
    cameraOn: boolean;
    joinedAt: Date;
  }>;
};

async function toMeetingRow(
  meeting: MeetingRowInput,
  viewerId: string
): Promise<MeetingRow> {
  const ids = meeting.participants.map((p) => p.userId);
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const nameMap = new Map(users.map((u) => [u.id, u.name]));

  const participants: MeetingParticipantRow[] = meeting.participants.map(
    (p) => ({
      userId: p.userId,
      name: nameMap.get(p.userId) ?? "Unknown",
      role: p.role === "HOST" ? "HOST" : "MEMBER",
      micOn: p.micOn,
      cameraOn: p.cameraOn,
      joinedAt: p.joinedAt.toISOString(),
    })
  );

  const mine = meeting.participants.find((p) => p.userId === viewerId);
  const myRole: "HOST" | "MEMBER" = mine
    ? mine.role === "HOST"
      ? "HOST"
      : "MEMBER"
    : meeting.startedBy === viewerId
    ? "HOST"
    : "MEMBER";

  return {
    id: meeting.id,
    title: meeting.title,
    kind: meeting.kind,
    status: meeting.status,
    teamId: meeting.teamId,
    caseId: meeting.caseId,
    startedBy: meeting.startedBy,
    startedAt: meeting.startedAt.toISOString(),
    endedAt: meeting.endedAt ? meeting.endedAt.toISOString() : null,
    participants,
    myRole,
    maxParticipants: meeting.maxParticipants,
    recordingBytes: meeting.recordingBytes,
    recordingDurationMs: meeting.recordingDurationMs,
    transcriptStatus: meeting.transcriptStatus,
  };
}

/** Load a meeting with participants; throws 404 when absent. */
async function loadMeeting(id: string) {
  const meeting = await db.meeting.findUnique({
    where: { id },
    include: meetingInclude(),
  });
  if (!meeting) throw new DomainError("Meeting not found", 404);
  return meeting;
}

// ── authorization ──

/**
 * The single object-level gate for a meeting. AUDITOR/CLIENT are always denied;
 * ADMIN reaches any meeting in their organisation; staff must host it, be a
 * participant, or belong to the meeting's team (so an invited member can join
 * before becoming a participant).
 */
async function assertMeetingAccess(ctx: AuthContext, meetingId: string) {
  if (ctx.role === "AUDITOR")
    throw new DomainError("Forbidden: auditors cannot access meetings", 403);
  if (ctx.role === "CLIENT") throw new DomainError("Forbidden", 403);
  const meeting = await db.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new DomainError("Meeting not found", 404);
  if (meeting.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  if (ctx.role === "ADMIN") return meeting;
  if (meeting.startedBy === ctx.userId) return meeting;

  const participant = await db.meetingParticipant.findUnique({
    where: { meetingId_userId: { meetingId, userId: ctx.userId } },
    select: { id: true },
  });
  if (participant) return meeting;

  if (meeting.teamId) {
    const membership = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId: meeting.teamId, userId: ctx.userId } },
      select: { id: true },
    });
    if (membership) return meeting;
  }
  throw new DomainError("Forbidden: not a meeting participant", 403);
}

/** Signaling is participant-only; a peer that never joined (or already left) cannot read or inject. */
async function requireActiveParticipant(ctx: AuthContext, meetingId: string) {
  const participant = await db.meetingParticipant.findUnique({
    where: { meetingId_userId: { meetingId, userId: ctx.userId } },
    select: { id: true, leftAt: true },
  });
  if (!participant || participant.leftAt)
    throw new DomainError("Forbidden: not an active meeting participant", 403);
}

// ── meetings ──

export async function listMeetings(
  ctx: AuthContext,
  opts: { active?: boolean; teamId?: string; caseId?: string }
): Promise<MeetingRow[]> {
  if (ctx.role === "AUDITOR")
    throw new DomainError("Forbidden: auditors cannot access meetings", 403);
  if (ctx.role === "CLIENT") throw new DomainError("Forbidden", 403);

  let scope: { OR: Array<Record<string, unknown>> } | Record<string, never> =
    {};
  if (ctx.role !== "ADMIN") {
    const memberships = await db.teamMember.findMany({
      where: { userId: ctx.userId },
      select: { teamId: true },
    });
    const teamIds = memberships.map((t) => t.teamId);
    scope = {
      OR: [
        { startedBy: ctx.userId },
        { participants: { some: { userId: ctx.userId } } },
        { teamId: { in: teamIds } },
      ],
    };
  }

  const rows = await db.meeting.findMany({
    where: {
      orgId: ctx.orgId,
      ...(opts.active ? { status: "OPEN" } : {}),
      ...(opts.teamId ? { teamId: opts.teamId } : {}),
      ...(opts.caseId ? { caseId: opts.caseId } : {}),
      ...scope,
    },
    include: meetingInclude(),
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return Promise.all(rows.map((m) => toMeetingRow(m, ctx.userId)));
}

export async function startMeeting(
  ctx: AuthContext,
  input: StartMeetingInput
): Promise<MeetingRow> {
  requireCapability(ctx, "meeting.start");
  if (!input.teamId && !input.caseId)
    throw new DomainError("teamId or caseId required", 400);
  const kind = input.kind ?? "AUDIO";
  if (kind !== "AUDIO" && kind !== "VIDEO")
    throw new DomainError("kind must be AUDIO or VIDEO", 400);

  let teamId: string | null = null;
  let defaultTitle = "";
  if (input.teamId) {
    const team = await assertTeamAccess(ctx, input.teamId);
    teamId = team.id;
    defaultTitle = `${team.name} · ${formatDateTime(new Date())}`;
  }
  let caseId: string | null = null;
  if (input.caseId) {
    const c = await db.case.findUnique({
      where: { id: input.caseId },
      select: { id: true, reference: true, orgId: true },
    });
    if (!c) throw new DomainError("Case not found", 404);
    if (c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    caseId = c.id;
    if (!teamId) defaultTitle = `Case ${c.reference} · meeting`;
  }

  const title = input.title?.trim() || defaultTitle;
  if (!title) throw new DomainError("Meeting title required", 400);

  const meeting = await db.$transaction(async (tx) => {
    const created = await tx.meeting.create({
      data: {
        orgId: ctx.orgId,
        teamId,
        caseId,
        title,
        kind,
        status: "OPEN",
        startedBy: ctx.userId,
        maxParticipants: MAX_PARTICIPANTS,
      },
    });
    await tx.meetingParticipant.create({
      data: { meetingId: created.id, userId: ctx.userId, role: "HOST" },
    });
    return created;
  });

  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "meeting.started",
    target: meeting.title,
    after: { meetingId: meeting.id, kind, teamId, caseId },
  });

  if (teamId) {
    const members = await db.teamMember.findMany({
      where: { teamId, userId: { not: ctx.userId } },
      select: { userId: true },
    });
    for (const m of members) {
      await notifySafe({
        userId: m.userId,
        category: "TEAM",
        title: `Meeting started · ${title}`,
        body: `${ctx.name} started a meeting. Open the team to join.`,
      });
    }
  }

  const full = await loadMeeting(meeting.id);
  return toMeetingRow(full, ctx.userId);
}

export async function getMeeting(
  ctx: AuthContext,
  id: string
): Promise<{ meeting: MeetingRow; side: "HOST" | "MEMBER" }> {
  await assertMeetingAccess(ctx, id);
  const full = await loadMeeting(id);
  const meeting = await toMeetingRow(full, ctx.userId);
  return { meeting, side: meeting.myRole };
}

export async function joinMeeting(
  ctx: AuthContext,
  id: string
): Promise<MeetingRow> {
  const meeting = await assertMeetingAccess(ctx, id);
  if (meeting.status !== "OPEN")
    throw new DomainError("Meeting has ended", 409);

  const existing = await db.meetingParticipant.findUnique({
    where: { meetingId_userId: { meetingId: id, userId: ctx.userId } },
  });
  if (!existing) {
    const active = await db.meetingParticipant.count({
      where: { meetingId: id, leftAt: null },
    });
    if (active >= meeting.maxParticipants) {
      throw new DomainError(
        `Meeting is full (max ${meeting.maxParticipants} participants)`,
        409
      );
    }
    await db.meetingParticipant.create({
      data: { meetingId: id, userId: ctx.userId, role: "MEMBER" },
    });
  } else if (existing.leftAt) {
    await db.meetingParticipant.update({
      where: { id: existing.id },
      data: { leftAt: null },
    });
  }

  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "meeting.participant.joined",
    target: id,
    after: { meetingId: id, userId: ctx.userId },
  });

  if (meeting.startedBy !== ctx.userId) {
    await notifySafe({
      userId: meeting.startedBy,
      category: "TEAM",
      title: `Meeting joined · ${meeting.title}`,
      body: `${ctx.name} joined the meeting.`,
    });
  }

  const full = await loadMeeting(id);
  return toMeetingRow(full, ctx.userId);
}

export async function leaveMeeting(
  ctx: AuthContext,
  id: string
): Promise<MeetingRow> {
  await assertMeetingAccess(ctx, id);
  const participant = await db.meetingParticipant.findUnique({
    where: { meetingId_userId: { meetingId: id, userId: ctx.userId } },
  });
  if (!participant) throw new DomainError("Not a meeting participant", 409);
  if (!participant.leftAt) {
    await db.meetingParticipant.update({
      where: { id: participant.id },
      data: { leftAt: new Date() },
    });
  }

  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "meeting.participant.left",
    target: id,
    after: { meetingId: id, userId: ctx.userId },
  });

  const remaining = await db.meetingParticipant.count({
    where: { meetingId: id, leftAt: null },
  });
  if (remaining === 0) {
    const ended = await db.meeting.update({
      where: { id },
      data: { status: "ENDED", endedAt: new Date() },
      include: meetingInclude(),
    });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "meeting.ended",
      target: id,
      reason: "last-participant-left",
    });
    return toMeetingRow(ended, ctx.userId);
  }

  const full = await loadMeeting(id);
  return toMeetingRow(full, ctx.userId);
}

export async function endMeeting(
  ctx: AuthContext,
  id: string,
  reason?: string
): Promise<MeetingRow> {
  const meeting = await assertMeetingAccess(ctx, id);
  if (meeting.startedBy !== ctx.userId && ctx.role !== "ADMIN") {
    throw new DomainError(
      "Forbidden: only the host or an admin may end the meeting",
      403
    );
  }
  if (meeting.status === "ENDED")
    throw new DomainError("Meeting already ended", 409);

  await db.meetingParticipant.updateMany({
    where: { meetingId: id, leftAt: null },
    data: { leftAt: new Date() },
  });
  const ended = await db.meeting.update({
    where: { id },
    data: { status: "ENDED", endedAt: new Date(), endedBy: ctx.userId },
    include: meetingInclude(),
  });

  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "meeting.ended",
    target: meeting.title,
    reason,
    after: { meetingId: id },
  });
  return toMeetingRow(ended, ctx.userId);
}

export async function setParticipantState(
  ctx: AuthContext,
  id: string,
  input: MeetingStateInput
): Promise<MeetingRow> {
  await assertMeetingAccess(ctx, id);
  await requireActiveParticipant(ctx, id);

  const data: { micOn?: boolean; cameraOn?: boolean } = {};
  if (typeof input.micOn === "boolean") data.micOn = input.micOn;
  if (typeof input.cameraOn === "boolean") data.cameraOn = input.cameraOn;
  if (Object.keys(data).length) {
    await db.meetingParticipant.update({
      where: { meetingId_userId: { meetingId: id, userId: ctx.userId } },
      data,
    });
  }

  const full = await loadMeeting(id);
  return toMeetingRow(full, ctx.userId);
}

// ── signaling (mesh relay) ──

export async function appendMeetingSignal(
  ctx: AuthContext,
  id: string,
  input: MeetingSignalInput
): Promise<{ seq: number }> {
  await assertMeetingAccess(ctx, id);
  await requireActiveParticipant(ctx, id);

  if (!(SIGNAL_KINDS as readonly string[]).includes(input.kind))
    throw new DomainError("Unsupported signal kind", 400);

  const payloadRaw = JSON.stringify(input.payload ?? {});
  if (payloadRaw.length > MAX_SIGNAL_CHARS)
    throw new DomainError("Signal payload exceeds 15000 characters", 400);

  if (input.toUserId) {
    const peer = await db.meetingParticipant.findUnique({
      where: { meetingId_userId: { meetingId: id, userId: input.toUserId } },
      select: { id: true, leftAt: true },
    });
    if (!peer || peer.leftAt)
      throw new DomainError("toUserId must be a current participant", 400);
  }

  // Recording consent is server-stamped proof (byUserId/at) — a participant
  // can only ever ack for themselves, never for a counterparty.
  const payload =
    input.kind === "CONSENT"
      ? JSON.stringify({ byUserId: ctx.userId, at: new Date().toISOString() })
      : payloadRaw;

  // SDP/ICE payloads are never logged — only the opaque row is persisted.
  const toUserId = input.toUserId ?? null;
  const max = await db.meetingSignal.aggregate({
    where: { meetingId: id },
    _max: { seq: true },
  });
  let seq = (max._max.seq ?? 0) + 1;
  try {
    await db.meetingSignal.create({
      data: {
        meetingId: id,
        seq,
        fromUserId: ctx.userId,
        toUserId,
        kind: input.kind,
        payload,
      },
    });
  } catch {
    // Concurrent writers may collide on the unique (meetingId, seq) — re-read once.
    const re = await db.meetingSignal.aggregate({
      where: { meetingId: id },
      _max: { seq: true },
    });
    seq = (re._max.seq ?? 0) + 1;
    await db.meetingSignal.create({
      data: {
        meetingId: id,
        seq,
        fromUserId: ctx.userId,
        toUserId,
        kind: input.kind,
        payload,
      },
    });
  }
  return { seq };
}

export async function meetingSignalsAfter(
  ctx: AuthContext,
  id: string,
  afterSeq: number
): Promise<{
  status: string;
  participants: MeetingParticipantRow[];
  signals: Array<{
    seq: number;
    fromUserId: string;
    kind: string;
    payload: string;
  }>;
}> {
  await assertMeetingAccess(ctx, id);
  await requireActiveParticipant(ctx, id);

  const meeting = await db.meeting.findUnique({
    where: { id },
    select: { status: true },
  });

  // A peer only ever receives rows addressed to it (or broadcast); its own rows
  // are filtered out so it never re-reads what it produced.
  const signals = await db.meetingSignal.findMany({
    where: {
      meetingId: id,
      seq: { gt: afterSeq },
      fromUserId: { not: ctx.userId },
      OR: [{ toUserId: ctx.userId }, { toUserId: null }],
    },
    orderBy: { seq: "asc" },
    take: MAX_SIGNALS_PER_POLL,
    select: { seq: true, fromUserId: true, kind: true, payload: true },
  });

  const rows = await db.meetingParticipant.findMany({
    where: { meetingId: id, leftAt: null },
    orderBy: { joinedAt: "asc" },
  });
  const ids = rows.map((p) => p.userId);
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const nameMap = new Map(users.map((u) => [u.id, u.name]));
  const participants: MeetingParticipantRow[] = rows.map((p) => ({
    userId: p.userId,
    name: nameMap.get(p.userId) ?? "Unknown",
    role: p.role === "HOST" ? "HOST" : "MEMBER",
    micOn: p.micOn,
    cameraOn: p.cameraOn,
    joinedAt: p.joinedAt.toISOString(),
  }));

  return { status: meeting?.status ?? "ENDED", participants, signals };
}

// ── recording + transcript (vault) ──

/** Parse one stored CONSENT payload; foreign/malformed rows never count. */
function parseMeetingConsent(payload: string): RecordingConsentEntry | null {
  try {
    const data = JSON.parse(payload) as { byUserId?: unknown; at?: unknown };
    if (typeof data.byUserId !== "string" || !data.byUserId) return null;
    if (typeof data.at !== "string" || !data.at) return null;
    return { byUserId: data.byUserId, at: data.at };
  } catch {
    return null;
  }
}

/**
 * Counterparty recording consent: one server-stamped ack (byUserId/at) per
 * participant, read back from the CONSENT signal rows. First ack per user wins.
 */
export async function recordingConsentStatus(
  id: string
): Promise<{ consents: RecordingConsentEntry[] }> {
  const rows = await db.meetingSignal.findMany({
    where: { meetingId: id, kind: "CONSENT" },
    orderBy: { seq: "asc" },
    select: { payload: true },
  });
  const seen = new Set<string>();
  const consents: RecordingConsentEntry[] = [];
  for (const row of rows) {
    const entry = parseMeetingConsent(row.payload);
    if (!entry || seen.has(entry.byUserId)) continue;
    seen.add(entry.byUserId);
    consents.push(entry);
  }
  return { consents };
}

/** Record the caller's own ack (idempotent — a second ack is a no-op). */
export async function acknowledgeRecordingConsent(
  ctx: AuthContext,
  id: string
): Promise<{ consents: RecordingConsentEntry[] }> {
  await assertMeetingAccess(ctx, id);
  await requireActiveParticipant(ctx, id);
  const { consents } = await recordingConsentStatus(id);
  if (consents.some((c) => c.byUserId === ctx.userId)) return { consents };
  await appendMeetingSignal(ctx, id, {
    toUserId: null,
    kind: "CONSENT",
    payload: {},
  });
  return recordingConsentStatus(id);
}

/**
 * Consent snapshot for the room UI: who acked, whether the viewer acked, and
 * how many counterparties are still outstanding.
 */
export async function meetingConsent(
  ctx: AuthContext,
  id: string
): Promise<{
  consents: RecordingConsentEntry[];
  ackedByMe: boolean;
  missing: number;
}> {
  await assertMeetingAccess(ctx, id);
  const [participants, { consents }] = await Promise.all([
    db.meetingParticipant.findMany({
      where: { meetingId: id },
      select: { userId: true },
    }),
    recordingConsentStatus(id),
  ]);
  const acked = new Set(consents.map((c) => c.byUserId));
  return {
    consents,
    ackedByMe: acked.has(ctx.userId),
    missing: participants.filter((p) => !acked.has(p.userId)).length,
  };
}

/**
 * The counterparty rule: EVERY participant who ever joined must have acked
 * before a single recording byte or transcript line is stored. Missing acks
 * are a 403 naming how many counterparties are still outstanding — the host
 * cannot record past a silent room.
 */
async function requireRecordingConsents(id: string): Promise<void> {
  const [participants, { consents }] = await Promise.all([
    db.meetingParticipant.findMany({
      where: { meetingId: id },
      select: { userId: true },
    }),
    recordingConsentStatus(id),
  ]);
  const acked = new Set(consents.map((c) => c.byUserId));
  const missing = participants.filter((p) => !acked.has(p.userId)).length;
  if (missing > 0) {
    throw new DomainError(
      `Recording consent incomplete: ${missing} participant(s) have not acknowledged recording`,
      403
    );
  }
}

export async function storeMeetingRecording(
  ctx: AuthContext,
  id: string,
  input: MeetingRecordingInput
): Promise<{ bytes: number }> {
  const meeting = await assertMeetingAccess(ctx, id);
  if (input.consentGiven !== true) {
    throw new DomainError(
      "Recording consent required: consentGiven must be true",
      400
    );
  }
  await requireRecordingConsents(id);
  if (meeting.startedBy !== ctx.userId && ctx.role !== "ADMIN") {
    throw new DomainError(
      "Forbidden: only the host or an admin may store a recording",
      403
    );
  }
  if (!input.audioBase64) throw new DomainError("audioBase64 required", 400);

  const base64 = stripDataUrl(input.audioBase64);
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_RECORDING_BYTES)
    throw new DomainError("Recording exceeds the 25 MB cap", 413);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_RECORDING_BYTES)
    throw new DomainError("Recording exceeds the 25 MB cap", 413);
  const sniff = sniffAudioMime(bytes);
  if (!sniff) throw new DomainError("Unsupported audio format", 415);

  const durationMs =
    typeof input.durationMs === "number"
      ? Math.max(0, Math.round(input.durationMs))
      : null;
  const recordingKey = `vault://meeting/${id}.${sniff.ext}`;
  await storagePutWithHistory(recordingKey, bytes);

  await db.meeting.update({
    where: { id },
    data: {
      recordingKey,
      recordingMime: sniff.mime,
      recordingBytes: bytes.length,
      recordingDurationMs: durationMs,
      transcriptStatus: "PENDING",
    },
  });

  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "meeting.recording.stored",
    target: meeting.title,
    after: { meetingId: id, bytes: bytes.length, durationMs },
  });
  return { bytes: bytes.length };
}

export async function readMeetingRecording(
  ctx: AuthContext,
  id: string
): Promise<{ bytes: Buffer; mime: string }> {
  const meeting = await assertMeetingAccess(ctx, id);
  if (!meeting.recordingKey)
    throw new DomainError("No recording for this meeting", 404);
  const bytes = await storageGet(meeting.recordingKey);
  if (!bytes) throw new DomainError("Recording not found", 404);
  return { bytes, mime: meeting.recordingMime ?? "application/octet-stream" };
}

export async function saveMeetingTranscript(
  ctx: AuthContext,
  id: string,
  transcript: string
): Promise<void> {
  const meeting = await assertMeetingAccess(ctx, id);
  if (meeting.startedBy !== ctx.userId && ctx.role !== "ADMIN") {
    throw new DomainError(
      "Forbidden: only the host or an admin may save a transcript",
      403
    );
  }
  // A transcript derives from the recording — the same counterparty bar applies.
  await requireRecordingConsents(id);

  const text = (transcript ?? "").trim();
  if (!text) throw new DomainError("Transcript required", 400);
  if (text.length > MAX_MEETING_TRANSCRIPT)
    throw new DomainError("Transcript exceeds 400000 characters", 400);

  await db.meeting.update({
    where: { id },
    data: { transcript: text, transcriptStatus: "READY" },
  });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "meeting.transcript.saved",
    target: meeting.title,
    after: { meetingId: id, chars: text.length },
  });
}
