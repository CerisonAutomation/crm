/**
 * Internal staff teams + team chat (server-only).
 *
 * A "team" is a staff-only grouping (RM / SENIOR_RM / ADMIN). Clients never see
 * a team; `AUDITOR` is deliberately denied every team surface — internal staff
 * comms sit outside read-only oversight, while its audit trail still records the
 * `team.*` actions. `assertTeamAccess` is the single object-level gate; every
 * function calls it (except `listTeams`, which scopes its own query).
 *
 * Voice notes follow the vault pattern: audio bytes live in blob storage
 * (`vault://team/<teamId>/<messageId>.<ext>`), the DB holds metadata only, and
 * the on-device transcript is a short string on the message row. Unread state
 * reuses the existing `IdempotencyKey` table as a per-user read watermark so no
 * new model is introduced (see `markTeamRead`).
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";
import { notifyUser, type NotifyInput } from "@/lib/services/notify";
import { audit, actorLabel } from "@/lib/api-helpers";
import { storagePut } from "@/lib/storage";
import { sniffAudioMime, stripDataUrl } from "@/lib/media/audio";
import type { AuthContext } from "@/lib/auth";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_MESSAGE_BODY = 4000;
const MAX_TRANSCRIPT = 40_000;
const MAX_TEAM_NAME = 120;
const MAX_DESCRIPTION = 2000;
const READ_SCOPE = "teams";

const TEAM_KINDS = ["TEAM", "COMMITTEE", "POD"] as const;
const STAFF_ROLES = ["RM", "SENIOR_RM", "ADMIN"] as const;

export type TeamRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  kind: string;
  memberCount: number;
  isMember: boolean;
  myRole: "LEADER" | "MEMBER" | null;
  lastMessageAt: string | null;
  unread: number;
  archived: boolean;
};

export type TeamMessageRow = {
  id: string;
  teamId: string;
  body: string;
  kind: string;
  author: { id: string; name: string; role: string };
  createdAt: string;
  audioBytes: number | null;
  audioDurationMs: number | null;
  transcriptStatus: string;
  transcript: string | null;
  hasAudio: boolean;
  mine: boolean;
};

export type CreateTeamInput = {
  name: string;
  description?: string;
  kind?: string;
  memberIds?: string[];
};

export type UpdateTeamPatch = {
  name?: string;
  description?: string;
  kind?: string;
  archived?: boolean;
};

export type TeamMessageInput = {
  body?: string;
  kind?: string;
  audioBase64?: string;
  audioMime?: string;
  audioDurationMs?: number;
  transcript?: string;
};

// ── small helpers ──

/** Lowercase, non-alphanumeric → "-", collapse repeats, trim, cap at 60 chars. */
export function slugifyTeam(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "team";
}

async function uniqueTeamSlug(name: string): Promise<string> {
  const base = slugifyTeam(name);
  let candidate = base;
  let n = 2;
  while (await db.team.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    const suffix = `-${n}`;
    candidate = `${base.slice(0, 60 - suffix.length)}${suffix}`;
    n += 1;
  }
  return candidate;
}

async function notifySafe(input: NotifyInput) {
  try {
    await notifyUser(input);
  } catch (err) {
    console.error("[teams] notify failed", err);
  }
}

// ── read watermark (deliberate IdempotencyKey reuse) ──

/**
 * A team's unread watermark is stored in the existing `IdempotencyKey` table
 * under `key = "teamread:<teamId>:<userId>"`, `scope = "teams"`, with the ISO
 * timestamp in `resultRef`. This is a deliberate reuse: it avoids a dedicated
 * model for a single per-user timestamp, and `IdempotencyKey` already exists as
 * a generic keyed key/value row. The key namespace cannot collide with the
 * `event-hub` / `workflow-run` scopes.
 */
function readKey(teamId: string, userId: string): string {
  return `teamread:${teamId}:${userId}`;
}

async function readWatermark(teamId: string, userId: string): Promise<Date | null> {
  const row = await db.idempotencyKey.findUnique({ where: { key: readKey(teamId, userId) }, select: { resultRef: true } });
  if (!row?.resultRef) return null;
  const d = new Date(row.resultRef);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function unreadCount(teamId: string, userId: string, watermark: Date | null): Promise<number> {
  return db.teamMessage.count({
    where: {
      teamId,
      authorId: { not: userId },
      ...(watermark ? { createdAt: { gt: watermark } } : {}),
    },
  });
}

// ── mappers ──

type TeamRowInput = {
  id: string;
  name: string;
  slug: string;
  description: string;
  kind: string;
  archivedAt: Date | null;
  members: Array<{ userId: string; role: string }>;
  messages: Array<{ createdAt: Date }>;
  _count: { members: number };
};

function toTeamRow(t: TeamRowInput, unread: number): TeamRow {
  const membership = t.members[0] ?? null;
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    description: t.description,
    kind: t.kind,
    memberCount: t._count.members,
    isMember: Boolean(membership),
    myRole: membership ? (membership.role === "LEADER" ? "LEADER" : "MEMBER") : null,
    lastMessageAt: t.messages[0] ? t.messages[0].createdAt.toISOString() : null,
    unread,
    archived: t.archivedAt !== null,
  };
}

type MessageRowInput = {
  id: string;
  teamId: string;
  authorId: string;
  body: string;
  kind: string;
  audioKey: string | null;
  audioBytes: number | null;
  audioDurationMs: number | null;
  transcript: string | null;
  transcriptStatus: string;
  createdAt: Date;
  author: { name: string; role: string };
};

function toMessageRow(m: MessageRowInput, viewerId: string): TeamMessageRow {
  return {
    id: m.id,
    teamId: m.teamId,
    body: m.body,
    kind: m.kind,
    author: { id: m.authorId, name: m.author.name, role: m.author.role },
    createdAt: m.createdAt.toISOString(),
    audioBytes: m.audioBytes,
    audioDurationMs: m.audioDurationMs,
    transcriptStatus: m.transcriptStatus,
    transcript: m.transcript,
    hasAudio: m.audioKey !== null,
    mine: m.authorId === viewerId,
  };
}

async function loadTeamRow(userId: string, teamId: string): Promise<TeamRow | null> {
  const t = await db.team.findUnique({
    where: { id: teamId },
    include: {
      members: { where: { userId }, select: { userId: true, role: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      _count: { select: { members: true } },
    },
  });
  if (!t) return null;
  const watermark = await readWatermark(teamId, userId);
  const unread = await unreadCount(teamId, userId, watermark);
  return toTeamRow(t, unread);
}

// ── authorization ──

/**
 * The single object-level gate for a team. AUDITOR and CLIENT are always denied;
 * ADMIN reaches any team in their own organisation; RM/SENIOR_RM need a
 * `TeamMember` row. A client-supplied role/user id is never consulted.
 */
export async function assertTeamAccess(ctx: AuthContext, teamId: string) {
  if (ctx.role === "AUDITOR") throw new DomainError("Forbidden: auditors cannot access internal teams", 403);
  if (ctx.role === "CLIENT") throw new DomainError("Forbidden", 403);
  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) throw new DomainError("Team not found", 404);
  if (team.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
  if (ctx.role === "ADMIN") return team;
  const membership = await db.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: ctx.userId } },
    select: { role: true },
  });
  if (!membership) throw new DomainError("Forbidden: not a team member", 403);
  return team;
}

function assertAdmin(ctx: AuthContext) {
  if (ctx.role !== "ADMIN") throw new DomainError("Forbidden: admin only", 403);
}

// ── teams ──

export async function listTeams(ctx: AuthContext): Promise<TeamRow[]> {
  if (ctx.role === "AUDITOR") throw new DomainError("Forbidden: auditors cannot access internal teams", 403);
  if (ctx.role === "CLIENT") throw new DomainError("Forbidden", 403);

  const teams = await db.team.findMany({
    where:
      ctx.role === "ADMIN"
        ? { orgId: ctx.orgId }
        : { orgId: ctx.orgId, members: { some: { userId: ctx.userId } } },
    include: {
      members: { where: { userId: ctx.userId }, select: { userId: true, role: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      _count: { select: { members: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const keys = teams.map((t) => readKey(t.id, ctx.userId));
  const marks = await db.idempotencyKey.findMany({
    where: { scope: READ_SCOPE, key: { in: keys } },
    select: { key: true, resultRef: true },
  });
  const markMap = new Map(marks.map((m) => [m.key, m.resultRef]));

  const out: TeamRow[] = [];
  for (const t of teams) {
    const ref = markMap.get(readKey(t.id, ctx.userId)) ?? null;
    const parsed = ref ? new Date(ref) : null;
    const watermark = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    const unread = await unreadCount(t.id, ctx.userId, watermark);
    out.push(toTeamRow(t, unread));
  }
  return out;
}

export async function createTeam(ctx: AuthContext, input: CreateTeamInput): Promise<TeamRow> {
  assertAdmin(ctx);

  const name = (input.name ?? "").trim();
  if (!name) throw new DomainError("Team name required", 400);
  if (name.length > MAX_TEAM_NAME) throw new DomainError(`Team name must be ≤ ${MAX_TEAM_NAME} characters`, 400);
  const description = (input.description ?? "").trim();
  if (description.length > MAX_DESCRIPTION) throw new DomainError(`Description must be ≤ ${MAX_DESCRIPTION} characters`, 400);
  const kind = input.kind ?? "TEAM";
  if (!(TEAM_KINDS as readonly string[]).includes(kind)) throw new DomainError("kind must be TEAM, COMMITTEE or POD", 400);

  const memberIds = [...new Set(input.memberIds ?? [])].filter((id) => id !== ctx.userId);
  const invalid: string[] = [];
  const valid: string[] = [];
  if (memberIds.length > 0) {
    const users = await db.user.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, orgId: true, role: true, status: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    for (const userId of memberIds) {
      const u = userMap.get(userId);
      if (!u || u.orgId !== ctx.orgId || u.status !== "ACTIVE" || !(STAFF_ROLES as readonly string[]).includes(u.role)) {
        invalid.push(userId);
      } else {
        valid.push(userId);
      }
    }
  }
  if (invalid.length) throw new DomainError(`Invalid member ids: ${invalid.join(", ")}`, 400);

  const slug = await uniqueTeamSlug(name);
  const team = await db.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: { orgId: ctx.orgId, name, slug, description, kind, createdBy: ctx.userId },
    });
    await tx.teamMember.create({ data: { teamId: created.id, userId: ctx.userId, role: "LEADER", addedBy: ctx.userId } });
    if (valid.length > 0) {
      await tx.teamMember.createMany({
        data: valid.map((userId) => ({
          teamId: created.id,
          userId,
          role: "MEMBER",
          addedBy: ctx.userId,
        })),
      });
    }
    return created;
  });

  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "team.created",
    target: team.slug,
    after: { teamId: team.id, name: team.name, kind: team.kind, members: valid.length + 1 },
  });

  for (const userId of valid) {
    await notifySafe({
      userId,
      category: "TEAM",
      title: `Added to team ${name}`,
      body: `${ctx.name} added you to the team “${name}”.`,
    });
  }

  const row = await loadTeamRow(ctx.userId, team.id);
  if (!row) throw new DomainError("Team not found", 404);
  return row;
}

export async function getTeam(
  ctx: AuthContext,
  teamId: string
): Promise<{ team: TeamRow; members: Array<{ userId: string; name: string; email: string; role: string; teamRole: string; addedAt: string }> }> {
  await assertTeamAccess(ctx, teamId);
  const team = await loadTeamRow(ctx.userId, teamId);
  if (!team) throw new DomainError("Team not found", 404);
  const rows = await db.teamMember.findMany({
    where: { teamId },
    include: { user: { select: { name: true, email: true, role: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    team,
    members: rows.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.user.role,
      teamRole: m.role,
      addedAt: m.createdAt.toISOString(),
    })),
  };
}

export async function updateTeam(ctx: AuthContext, teamId: string, patch: UpdateTeamPatch): Promise<TeamRow> {
  const team = await assertTeamAccess(ctx, teamId);
  assertAdmin(ctx);

  const data: { name?: string; description?: string; kind?: string; archivedAt?: Date | null } = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new DomainError("Team name required", 400);
    if (name.length > MAX_TEAM_NAME) throw new DomainError(`Team name must be ≤ ${MAX_TEAM_NAME} characters`, 400);
    if (name !== team.name) {
      data.name = name;
      before.name = team.name;
      after.name = name;
    }
  }
  if (patch.description !== undefined) {
    const description = patch.description.trim();
    if (description.length > MAX_DESCRIPTION) throw new DomainError(`Description must be ≤ ${MAX_DESCRIPTION} characters`, 400);
    if (description !== team.description) {
      data.description = description;
      before.description = team.description;
      after.description = description;
    }
  }
  if (patch.kind !== undefined) {
    if (!(TEAM_KINDS as readonly string[]).includes(patch.kind)) throw new DomainError("kind must be TEAM, COMMITTEE or POD", 400);
    if (patch.kind !== team.kind) {
      data.kind = patch.kind;
      before.kind = team.kind;
      after.kind = patch.kind;
    }
  }
  if (patch.archived !== undefined) {
    const isArchived = team.archivedAt !== null;
    if (patch.archived !== isArchived) {
      data.archivedAt = patch.archived ? new Date() : null;
      before.archived = isArchived;
      after.archived = patch.archived;
    }
  }

  if (Object.keys(data).length) {
    await db.team.update({ where: { id: teamId }, data });
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: actorLabel(ctx),
      action: "team.updated",
      target: team.slug,
      before,
      after,
    });
  }

  const row = await loadTeamRow(ctx.userId, teamId);
  if (!row) throw new DomainError("Team not found", 404);
  return row;
}

export async function addTeamMember(ctx: AuthContext, teamId: string, userId: string, role?: string): Promise<void> {
  const team = await assertTeamAccess(ctx, teamId);
  assertAdmin(ctx);

  const memberRole = role ?? "MEMBER";
  if (memberRole !== "LEADER" && memberRole !== "MEMBER") throw new DomainError("role must be LEADER or MEMBER", 400);

  const target = await db.user.findUnique({ where: { id: userId }, select: { orgId: true, role: true, status: true } });
  if (!target || target.orgId !== ctx.orgId || target.status !== "ACTIVE" || !(STAFF_ROLES as readonly string[]).includes(target.role)) {
    throw new DomainError("Target must be an active staff member in your organisation", 400);
  }

  const existing = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
  if (!existing) {
    await db.teamMember.create({ data: { teamId, userId, role: memberRole, addedBy: ctx.userId } });
  } else if (existing.role !== memberRole) {
    await db.teamMember.update({ where: { id: existing.id }, data: { role: memberRole } });
  }

  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "team.member.added",
    target: team.slug,
    after: { userId, role: memberRole },
  });
  await notifySafe({
    userId,
    category: "TEAM",
    title: `Added to team ${team.name}`,
    body: `${ctx.name} added you to the team “${team.name}”.`,
  });
}

export async function removeTeamMember(ctx: AuthContext, teamId: string, userId: string): Promise<void> {
  const team = await assertTeamAccess(ctx, teamId);
  assertAdmin(ctx);

  const member = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
  if (!member) throw new DomainError("Not a team member", 404);
  if (member.role === "LEADER") {
    const leaders = await db.teamMember.count({ where: { teamId, role: "LEADER" } });
    if (leaders <= 1) throw new DomainError("Cannot remove the last team leader", 409);
  }

  await db.teamMember.delete({ where: { id: member.id } });
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "team.member.removed",
    target: team.slug,
    before: { userId, role: member.role },
  });
  await notifySafe({
    userId,
    category: "TEAM",
    title: `Removed from team ${team.name}`,
    body: `You were removed from the team “${team.name}”.`,
  });
}

// ── chat ──

export async function listTeamMessages(
  ctx: AuthContext,
  teamId: string,
  opts: { after?: string; limit?: number }
): Promise<{ messages: TeamMessageRow[]; readAt: string | null }> {
  await assertTeamAccess(ctx, teamId);

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const after = opts.after ? new Date(opts.after) : null;
  const where = {
    teamId,
    ...(after && !Number.isNaN(after.getTime()) ? { createdAt: { gt: after } } : {}),
  };
  const rows = await db.teamMessage.findMany({
    where,
    include: { author: { select: { name: true, role: true } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const watermark = await readWatermark(teamId, ctx.userId);
  return { messages: rows.map((m) => toMessageRow(m, ctx.userId)), readAt: watermark ? watermark.toISOString() : null };
}

export async function postTeamMessage(ctx: AuthContext, teamId: string, input: TeamMessageInput): Promise<TeamMessageRow> {
  const team = await assertTeamAccess(ctx, teamId);

  const kind = input.kind ?? "TEXT";
  if (kind !== "TEXT" && kind !== "AUDIO") throw new DomainError("kind must be TEXT or AUDIO", 400);

  const body = (input.body ?? "").trim();
  const id = randomUUID();

  if (kind === "TEXT") {
    if (!body) throw new DomainError("Message body required", 400);
    if (body.length > MAX_MESSAGE_BODY) throw new DomainError(`Message body must be ≤ ${MAX_MESSAGE_BODY} characters`, 400);
    const created = await db.teamMessage.create({
      data: { id, teamId, authorId: ctx.userId, body, kind, transcriptStatus: "NONE" },
      include: { author: { select: { name: true, role: true } } },
    });
    await notifyTeamOfMessage(ctx, teamId, team.name, body);
    return toMessageRow(created, ctx.userId);
  }

  // kind === "AUDIO"
  if (!input.audioBase64) throw new DomainError("audioBase64 required for AUDIO messages", 400);
  const base64 = stripDataUrl(input.audioBase64);
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_AUDIO_BYTES) throw new DomainError("Audio exceeds the 25 MB cap", 413);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_AUDIO_BYTES) throw new DomainError("Audio exceeds the 25 MB cap", 413);
  const sniff = sniffAudioMime(bytes);
  if (!sniff) throw new DomainError("Unsupported audio format", 415);

  const transcript = typeof input.transcript === "string" ? input.transcript.trim().slice(0, MAX_TRANSCRIPT) : "";
  const audioKey = `vault://team/${teamId}/${id}.${sniff.ext}`;
  await storagePut(audioKey, bytes);

  const created = await db.teamMessage.create({
    data: {
      id,
      teamId,
      authorId: ctx.userId,
      body,
      kind,
      audioKey,
      audioMime: sniff.mime,
      audioBytes: bytes.length,
      audioDurationMs: typeof input.audioDurationMs === "number" ? Math.max(0, Math.round(input.audioDurationMs)) : null,
      transcript: transcript || null,
      transcriptStatus: transcript ? "READY" : "PENDING",
    },
    include: { author: { select: { name: true, role: true } } },
  });

  const durationMs = typeof input.audioDurationMs === "number" ? Math.round(input.audioDurationMs) : 0;
  const excerpt = transcript || body || `🎙 ${Math.max(1, Math.round(durationMs / 1000))}s voice note`;
  await notifyTeamOfMessage(ctx, teamId, team.name, excerpt);
  return toMessageRow(created, ctx.userId);
}

async function notifyTeamOfMessage(ctx: AuthContext, teamId: string, teamName: string, excerpt: string) {
  const members = await db.teamMember.findMany({ where: { teamId }, select: { userId: true } });
  const body = excerpt.slice(0, 140);
  for (const m of members) {
    if (m.userId === ctx.userId) continue;
    await notifySafe({ userId: m.userId, category: "TEAM", title: `${ctx.name} · ${teamName}`, body });
  }
}

export async function markTeamRead(ctx: AuthContext, teamId: string): Promise<{ readAt: string }> {
  await assertTeamAccess(ctx, teamId);
  const readAt = new Date();
  const key = readKey(teamId, ctx.userId);
  await db.idempotencyKey.upsert({
    where: { key },
    create: { key, scope: READ_SCOPE, resultRef: readAt.toISOString() },
    update: { resultRef: readAt.toISOString() },
  });
  return { readAt: readAt.toISOString() };
}

export async function attachTranscript(
  ctx: AuthContext,
  teamId: string,
  messageId: string,
  transcript: string
): Promise<TeamMessageRow> {
  const team = await assertTeamAccess(ctx, teamId);
  const message = await db.teamMessage.findFirst({ where: { id: messageId, teamId } });
  if (!message) throw new DomainError("Message not found", 404);
  if (message.authorId !== ctx.userId && ctx.role !== "ADMIN") {
    throw new DomainError("Forbidden: only the message author may attach a transcript", 403);
  }

  const text = (transcript ?? "").trim().slice(0, MAX_TRANSCRIPT);
  if (!text) throw new DomainError("Transcript required", 400);

  const updated = await db.teamMessage.update({
    where: { id: messageId },
    data: { transcript: text, transcriptStatus: "READY" },
    include: { author: { select: { name: true, role: true } } },
  });

  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: actorLabel(ctx),
    action: "team.message.transcribed",
    target: team.slug,
    after: { messageId, chars: text.length },
  });
  return toMessageRow(updated, ctx.userId);
}
