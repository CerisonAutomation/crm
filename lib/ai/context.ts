/**
 * AI context — assemble the grounding facts an agent needs, and persist the
 * conversation threads that give the assistant memory.
 *
 * Two halves:
 *  1. buildPlatformContext / buildCaseContext — pull live, ORG-SCOPED facts
 *     from the database so every answer is grounded in real data.
 *  2. AiContextStore — a small file-backed thread store (no schema change
 *     required, survives restarts) keyed by organisation AND user, so one
 *     member of an organisation can never read or delete another member's
 *     conversations (see the security note in the thread-store section).
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { platformCaseStatusLabel } from "@/lib/settings/registry";
import { loadPlatformSettings } from "@/lib/settings/store";
import { buildCaseFacts, type CaseFactsBundle } from "./facts";

// ───────────────────────── context assembly ─────────────────────────

const OPEN_STATUSES = [
  "ONBOARDING",
  "DATA_SUBMITTED",
  "DATA_APPROVED",
  "SERVICE_SELECTED",
  "SERVICE_APPROVED",
  "DOCS_REQUESTED",
  "IN_PROGRESS",
  "DISPATCHED",
  "FOLLOW_UP",
  "APPROVED_IN_PRINCIPLE",
];

/** Live, org-scoped platform facts (counts + pipeline shape). */
export async function buildPlatformContext(orgId: string, assignedUserId?: string): Promise<string> {
  const caseWhere = assignedUserId
    ? { orgId, assignments: { some: { userId: assignedUserId } } }
    : { orgId };
  const [byStatus, pendingDocs, openRequests, failedRuns, unassigned, reminders] = await Promise.all([
    db.case.groupBy({ by: ["status"], where: caseWhere, _count: true }),
    db.document.count({ where: { case: { ...caseWhere }, status: { in: ["IN_REVIEW", "CLIENT_CONFIRMED", "OCR_PROCESSED"] } } }),
    db.documentRequest.count({ where: { case: { ...caseWhere }, status: "OPEN" } }),
    assignedUserId ? Promise.resolve(0) : db.workflowRun.count({ where: { workflow: { orgId }, status: "FAILED" } }),
    db.case.count({ where: { ...caseWhere, status: { in: OPEN_STATUSES }, assignments: { none: {} } } }),
    db.reminder.count({ where: { status: "SCHEDULED", case: { ...caseWhere } } }),
  ]);
  // Admin-editable status labels resolve settings-first (canon underneath), so
  // the pipeline prose matches the queue rather than the frozen domain map.
  const platform = await loadPlatformSettings();
  const pipeline = byStatus
    .sort((a, b) => b._count - a._count)
    .map((b) => `${platformCaseStatusLabel(platform, b.status)}: ${b._count}`)
    .join(", ");
  return [
    `Organisation pipeline — ${pipeline || "no cases"}.`,
    `Documents awaiting review: ${pendingDocs}.`,
    `Open document requests: ${openRequests}.`,
    `Failed workflow runs: ${failedRuns}${assignedUserId ? " (not included in the assigned-case view)" : ""}.`,
    `Open cases without an assigned RM: ${unassigned}.`,
    `Scheduled reminders: ${reminders}.`,
  ].join("\n");
}

/**
 * Live, org-scoped LEDGER for one case (null when not in the org).
 *
 * Returns the typed fact list AND its prose projection. The prose is what the
 * agents consume today — byte-identical to what this function used to return —
 * while the ledger is what a claim can be checked against, and what a future
 * model's output would be diffed against.
 */
export async function buildCaseLedger(caseId: string, orgId: string): Promise<CaseFactsBundle | null> {
  const c = await db.case.findFirst({
    where: { id: caseId, orgId },
    include: {
      client: { select: { id: true, name: true, nationality: true } },
      programme: { select: { id: true, name: true, country: true } },
      documents: { select: { id: true, type: true, status: true }, orderBy: { createdAt: "desc" }, take: 12 },
      requests: { select: { id: true, title: true, status: true, dueDate: true } },
      assignments: { select: { user: { select: { name: true } } } },
      dispatches: { select: { id: true, trackingId: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      letters: { select: { version: true }, orderBy: { createdAt: "desc" }, take: 1 },
      statusHistory: { select: { to: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!c) return null;
  const platform = await loadPlatformSettings();
  const dispatch = c.dispatches[0];
  return buildCaseFacts({
    caseId: c.id,
    reference: c.reference,
    statusLabel: platformCaseStatusLabel(platform, c.status),
    clientId: c.client.id,
    clientName: c.client.name,
    clientNationality: c.client.nationality,
    programmeId: c.programme?.id ?? null,
    programmeName: c.programme?.name ?? null,
    programmeCountry: c.programme?.country ?? null,
    dataApproval: c.dataApproval,
    serviceApproval: c.serviceApproval,
    documents: c.documents.map((d) => ({ id: d.id, type: d.type, status: d.status })),
    requests: c.requests.map((r) => ({ id: r.id, title: r.title, status: r.status, dueDate: r.dueDate })),
    relationshipManagers: c.assignments.map((a) => a.user.name),
    dispatch: dispatch ? { id: dispatch.id, trackingId: dispatch.trackingId, status: dispatch.status } : null,
    letterVersion: c.letters[0]?.version ?? null,
    // Kept in the query's own (newest-first) order — the prose reads the same
    // way it always has; do not "fix" the direction without changing callers.
    recentTransitions: c.statusHistory.map((h) => platformCaseStatusLabel(platform, h.to)),
  });
}

/** Live, org-scoped context for one case as prose (returns null if not in the org). */
export async function buildCaseContext(caseId: string, orgId: string): Promise<string | null> {
  const ledger = await buildCaseLedger(caseId, orgId);
  return ledger ? ledger.text : null;
}

// ───────────────────────── thread store (file-backed) ─────────────────────────
//
// Security: threads are keyed by BOTH organisation and user — the on-disk path
// is db/ai-context/<orgId>/<userId>/<threadId>.json. Keying by organisation
// alone was an access-control bug: every member of an organisation (self-service
// clients included) shares one orgId, so an org-wide store let any authenticated
// user list, read and delete every other member's AI conversations, including
// staff threads that quote other applicants' case data. Scoping by userId keeps
// each user's threads private while still surviving restarts.

export type AiMessage = { role: "user" | "assistant"; content: string; at: string };
export type AiThread = {
  id: string;
  scope: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AiMessage[];
};
export type AiThreadSummary = Pick<AiThread, "id" | "scope" | "title" | "updatedAt">;

/**
 * Where AI threads live.
 *
 * `AI_CONTEXT_ROOT` wins. On a serverless host the deployment filesystem is
 * read-only outside /tmp, so the project-relative default would throw EROFS on
 * the first write. Falling back to the OS temp dir keeps the feature working —
 * threads are short-lived scratch context, not records of truth — and degrades
 * to "threads do not persist across instances" rather than "the endpoint 500s".
 */
function root(): string {
  const explicit = process.env.AI_CONTEXT_ROOT?.trim();
  if (explicit) return explicit;
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  if (serverless) return path.join(/* turbopackIgnore: true */ tmpdir(), "citizen-lane-ai-context");
  return path.join(/* turbopackIgnore: true */ process.cwd(), "db", "ai-context");
}
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "x";
}
/** Per-organisation directory (kept for readability of the on-disk layout). */
function orgDir(orgId: string): string {
  return path.join(/* turbopackIgnore: true */ root(), slug(orgId));
}
/** Per-user directory — the unit of isolation for AI threads. */
function userDir(orgId: string, userId: string): string {
  return path.join(/* turbopackIgnore: true */ orgDir(orgId), slug(userId));
}
function threadPath(orgId: string, userId: string, id: string): string {
  return path.join(/* turbopackIgnore: true */ userDir(orgId, userId), `${slug(id)}.json`);
}

/** List the caller's threads, newest first (bounded). */
export async function listThreads(orgId: string, userId: string, limit = 50): Promise<AiThreadSummary[]> {
  const dir = userDir(orgId, userId);
  let names: string[] = [];
  try {
    names = await readdir(/* turbopackIgnore: true */ dir);
  } catch {
    return [];
  }
  const rows: Array<AiThreadSummary & { mtime: number }> = [];
  for (const name of names.filter((n) => n.endsWith(".json")).slice(0, limit * 2)) {
    try {
      const full = path.join(/* turbopackIgnore: true */ dir, name);
      const [raw, info] = await Promise.all([
        readFile(/* turbopackIgnore: true */ full, "utf8"),
        stat(/* turbopackIgnore: true */ full),
      ]);
      const t = JSON.parse(raw) as AiThread;
      rows.push({ id: t.id, scope: t.scope, title: t.title, updatedAt: t.updatedAt, mtime: info.mtimeMs });
    } catch {
      /* skip unreadable thread */
    }
  }
  return rows.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map(({ mtime: _mtime, ...rest }) => rest);
}

/** Read one of the caller's threads (null when absent or owned by someone else). */
export async function getThread(orgId: string, userId: string, id: string): Promise<AiThread | null> {
  const file = threadPath(orgId, userId, id);
  try {
    return JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8")) as AiThread;
  } catch {
    return null;
  }
}

/** Persist one of the caller's threads under their own directory. */
export async function saveThread(orgId: string, userId: string, thread: AiThread): Promise<void> {
  const dir = userDir(orgId, userId);
  const file = threadPath(orgId, userId, thread.id);
  await mkdir(/* turbopackIgnore: true */ dir, { recursive: true });
  await writeFile(/* turbopackIgnore: true */ file, JSON.stringify(thread), "utf8");
}

/** Delete one of the caller's threads. */
export async function deleteThread(orgId: string, userId: string, id: string): Promise<boolean> {
  const file = threadPath(orgId, userId, id);
  try {
    await rm(/* turbopackIgnore: true */ file);
    return true;
  } catch {
    return false;
  }
}