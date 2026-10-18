/**
 * Autopilot — automation auto-detection & auto-generation.
 *
 * One engine that (a) DISCOVERS everything in an organisation that can be
 * exposed as an inbound endpoint, (b) PREDICTS the outbound topics each
 * resource should emit (deterministic "auto-context": derived from the
 * workflow's trigger node + the universal completion topic), and (c) GENERATES
 * a secured, rotatable inbound hook endpoint per published workflow.
 *
 * Security model (inferred best practice):
 *   • The public URL carries an unguessable 192-bit `token` (the capability).
 *   • Every inbound call MUST be signed: `X-Signature: sha256=<hmac>` over the
 *     raw body with that endpoint's own `secret` (returned once, rotatable).
 *     A leaked URL alone is therefore not enough to trigger a run.
 *
 * Idempotent by construction: one HookEndpoint per (orgId, workflowId), so
 * re-running provisioning repairs/creates without ever duplicating.
 */
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { db, withTenantContext } from "@/lib/db";
import { supportsInteractiveTx } from "@/lib/db-adapter";
import { WEBHOOK_TOPICS, generateEndpointSecret, maskSecret } from "@/lib/integrations/webhooks";
import { NODE_CATALOG } from "@/lib/nodes/catalog";
import { audit } from "@/lib/api-helpers";

/** Feature-level errors map to HTTP via DomainError. */
import { DomainError } from "@/lib/domain/states";

type WfNodeLite = { key: string; pieceKey: string; name?: string; config?: Record<string, unknown> };

export type DiscoveredResource = {
  workflowId: string;
  name: string;
  description: string;
  published: boolean;
  disabled: boolean;
  triggerKey: string | null;
  triggerLabel: string | null;
  predictedTopics: string[];
  /** Human-readable justification for the prediction (auto-context). */
  rationale: string;
  hookId: string | null;
  token: string | null;
  url: string | null;
  active: boolean;
  calls: number;
  lastUsedAt: string | null;
};

export type ProvisionPlanItem = {
  workflowId: string;
  name: string;
  action: "create" | "repair" | "none";
  detail: string;
};

export type ProvisionOutcome = {
  workflowId: string;
  name: string;
  created: boolean;
  url: string;
  hookId: string;
  /** Only present when the endpoint was (re)created or rotated. */
  secret: string | null;
};

export type HookEndpointView = {
  id: string;
  workflowId: string;
  workflowName: string;
  label: string;
  url: string;
  token: string;
  active: boolean;
  source: string;
  calls: number;
  lastUsedAt: string | null;
  createdAt: string;
  /** Masked secret hint — never the plaintext. */
  secretHint: string;
};

const CATALOG_BY_KEY = new Map(NODE_CATALOG.map((n) => [n.pieceKey, n]));

/**
 * Deterministic trigger→topic prediction. Unknown/absent triggers fall back to
 * the universal `workflow.run.completed` topic so every endpoint is useful.
 */
const TRIGGER_TOPICS: Record<string, string[]> = {
  "trigger.manual": [],
  "trigger.case.created": ["case.created"],
  "trigger.document.uploaded": ["document.uploaded"],
  "trigger.document.approved": ["document.approved"],
  "trigger.document.rejected": ["document.rejected"],
  "trigger.page.submitted": ["page.submitted"],
  "trigger.schedule.due": ["case.status.changed"],
  "trigger.case.status.changed": ["case.status.changed"],
  "trigger.dispatch.created": ["dispatch.created"],
  "trigger.letter.issued": ["letter.issued"],
  "trigger.message.received": ["message.received"],
};

const UNIVERSAL_TOPIC = "workflow.run.completed";
const ALLOWED_TOPICS = new Set<string>([...WEBHOOK_TOPICS, "*"]);

function predictTopics(triggerKey: string | null): { topics: string[]; rationale: string } {
  const mapped = (triggerKey && TRIGGER_TOPICS[triggerKey]) || [];
  const topics = [...new Set([...mapped, UNIVERSAL_TOPIC])].filter((t) => ALLOWED_TOPICS.has(t));
  const triggerLabel = triggerKey ? CATALOG_BY_KEY.get(triggerKey)?.name ?? triggerKey : "no explicit trigger";
  const rationale =
    mapped.length > 0
      ? `Trigger "${triggerLabel}" maps to ${mapped.join(", ")}; every run also emits ${UNIVERSAL_TOPIC}.`
      : `No recognised trigger — defaulting to ${UNIVERSAL_TOPIC}.`;
  return { topics, rationale };
}

/** Unguessable, URL-safe capability token (192 bits). */
export function generateHookToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Per-endpoint signing secret — sealed via the integrations helper (single implementation, ponytail-S #6). */
export const generateHookSecret = generateEndpointSecret;

/** Public (relative) URL for a token. The UI prefixes the current origin. */
export function hookUrlFor(token: string): string {
  return `/api/hooks/${token}`;
}

/** Constant-time HMAC verification of a raw body against an endpoint secret. */
export function verifyHookSignature(secret: string, rawBody: string, signature: string): boolean {
  const raw = signature.replace(/^sha256=/i, "").trim();
  if (!raw) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(raw);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// maskSecret deliberately NOT duplicated here — imported from
// @/lib/integrations/webhooks (single fixed-mask helper, ponytail-S #7).
function parseNodes(raw: string): WfNodeLite[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WfNodeLite[]) : [];
  } catch {
    return [];
  }
}

function triggerOf(nodes: WfNodeLite[]): string | null {
  return nodes.find((n) => n.pieceKey?.startsWith("trigger."))?.pieceKey ?? null;
}

/**
 * Discover every exposable workflow in the org: its trigger, predicted topics
 * (auto-context), and the state of its generated hook endpoint (if any).
 */
export async function discover(orgId: string): Promise<DiscoveredResource[]> {
  const workflows = await db.workflow.findMany({
    where: { orgId },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
      hookEndpoints: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return workflows.map((wf) => {
    const latest = wf.versions[0];
    const nodes = latest ? parseNodes(latest.nodes) : [];
    const triggerKey = triggerOf(nodes);
    const { topics, rationale } = predictTopics(triggerKey);
    const hook = wf.hookEndpoints[0] ?? null;
    return {
      workflowId: wf.id,
      name: wf.name,
      description: wf.description,
      published: wf.status === "PUBLISHED" && wf.currentVersion > 0,
      disabled: wf.disabled,
      triggerKey,
      triggerLabel: triggerKey ? CATALOG_BY_KEY.get(triggerKey)?.name ?? triggerKey : null,
      predictedTopics: topics,
      rationale,
      hookId: hook?.id ?? null,
      token: hook?.token ?? null,
      url: hook ? hookUrlFor(hook.token) : null,
      active: hook?.active ?? false,
      calls: hook?.callCount ?? 0,
      lastUsedAt: hook?.lastUsedAt?.toISOString() ?? null,
    };
  });
}

/**
 * Dry-run plan: what provisioning WOULD do for each published workflow. Only
 * PUBLISHED, enabled workflows are eligible — provisioning a draft would create
 * a live endpoint that can never run.
 */
export async function plan(orgId: string): Promise<ProvisionPlanItem[]> {
  const resources = await discover(orgId);
  return resources
    .filter((r) => r.published && !r.disabled)
    .map((r) => {
      if (!r.hookId) {
        return { workflowId: r.workflowId, name: r.name, action: "create" as const, detail: "No inbound hook yet — will generate a tokenised, signed URL." };
      }
      if (!r.active) {
        return { workflowId: r.workflowId, name: r.name, action: "repair" as const, detail: "Hook exists but is disabled — will reactivate." };
      }
      return { workflowId: r.workflowId, name: r.name, action: "none" as const, detail: "Hook is present and active." };
    });
}

/**
 * Ensure a workflow has an active hook endpoint. Idempotent — safe to call on
 * every publish. Creates when missing, repairs (reactivates) when disabled.
 */
export async function ensureHookForWorkflow(
  orgId: string,
  workflowId: string,
  opts?: { label?: string; source?: "AUTO" | "MANUAL" },
): Promise<{ id: string; created: boolean; token: string; secret: string | null }> {
  const existing = await db.hookEndpoint.findUnique({
    where: { orgId_workflowId: { orgId, workflowId } },
  });
  if (existing) {
    if (!existing.active) {
      await db.hookEndpoint.update({ where: { id: existing.id }, data: { active: true } });
    }
    return { id: existing.id, created: false, token: existing.token, secret: null };
  }
  const wf = await db.workflow.findUnique({ where: { id: workflowId }, select: { name: true, orgId: true } });
  if (!wf || wf.orgId !== orgId) throw new DomainError("Workflow not found", 404);
  const token = generateHookToken();
  const secret = generateHookSecret();
  const created = await db.hookEndpoint.create({
    data: {
      orgId,
      workflowId,
      label: opts?.label ?? wf.name,
      token,
      secret,
      active: true,
      source: opts?.source ?? "AUTO",
    },
  });
  return { id: created.id, created: true, token: created.token, secret };
}

/**
 * Apply provisioning to every eligible workflow. Returns the (re)generated
 * endpoints; `secret` is populated only for endpoints created in this pass.
 */
export async function provision(
  orgId: string,
  actorLabel: string,
): Promise<{ outcomes: ProvisionOutcome[]; created: number; repaired: number }> {
  const items = await plan(orgId);
  const outcomes: ProvisionOutcome[] = [];
  let created = 0;
  let repaired = 0;

  for (const item of items) {
    if (item.action === "none") continue;
    const before = item.action;
    const res = await ensureHookForWorkflow(orgId, item.workflowId, { source: "AUTO" });
    if (res.created) created += 1;
    else if (before === "repair") repaired += 1;
    outcomes.push({
      workflowId: item.workflowId,
      name: item.name,
      created: res.created,
      url: hookUrlFor(res.token),
      hookId: res.id,
      secret: res.secret,
    });
  }

  if (outcomes.length > 0) {
    await audit({
      orgId,
      actorLabel,
      action: "autopilot.provisioned",
      target: "hook-endpoints",
      after: { created, repaired, total: outcomes.length },
    });
  }
  return { outcomes, created, repaired };
}

/** List generated endpoints (masked secrets) for the admin view + MCP. */
export async function listEndpoints(orgId: string): Promise<HookEndpointView[]> {
  const rows = await db.hookEndpoint.findMany({
    where: { orgId },
    include: { workflow: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflowId,
    workflowName: r.workflow?.name ?? "(deleted workflow)",
    label: r.label,
    url: hookUrlFor(r.token),
    token: r.token,
    active: r.active,
    source: r.source,
    calls: r.callCount,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    secretHint: maskSecret(r.secret),
  }));
}

export async function setEndpointActive(orgId: string, id: string, active: boolean): Promise<HookEndpointView> {
  const row = await db.hookEndpoint.findUnique({ where: { id } });
  if (!row || row.orgId !== orgId) throw new DomainError("Hook endpoint not found", 404);
  await db.hookEndpoint.update({ where: { id }, data: { active } });
  return (await listEndpoints(orgId)).find((e) => e.id === id)!;
}

/** Rotate token + secret. Returns the NEW secret ONCE (never stored in plaintext again). */
export async function rotateEndpoint(orgId: string, id: string): Promise<{ endpoint: HookEndpointView; secret: string }> {
  const row = await db.hookEndpoint.findUnique({ where: { id } });
  if (!row || row.orgId !== orgId) throw new DomainError("Hook endpoint not found", 404);
  const token = generateHookToken();
  const secret = generateHookSecret();
  await db.hookEndpoint.update({ where: { id }, data: { token, secret } });
  const endpoint = (await listEndpoints(orgId)).find((e) => e.id === id)!;
  return { endpoint, secret };
}

export async function deleteEndpoint(orgId: string, id: string): Promise<void> {
  const row = await db.hookEndpoint.findUnique({ where: { id } });
  if (!row || row.orgId !== orgId) throw new DomainError("Hook endpoint not found", 404);
  await db.hookEndpoint.delete({ where: { id } });
}

/**
 * Record a successful inbound call (best-effort; never throws into the hook).
 * T2 scoped unit (HOOKS slice): with orgId on pg the counter update runs
 * inside the tenant context; otherwise (org-less, Neon-HTTP) the global
 * client, exactly as before. H3 accepted: the increment is non-idempotent —
 * a duplicate delivery that startRun dedupes still counts twice. Accepted
 * deliberately (a counter, not a state transition); do not gate it on
 * run-created without an engine change.
 */
export async function recordHookCall(id: string, orgId?: string | null): Promise<void> {
  const write = () =>
    db.hookEndpoint
      .update({ where: { id }, data: { callCount: { increment: 1 }, lastUsedAt: new Date() } })
      .catch(() => undefined);
  if (orgId && supportsInteractiveTx()) {
    await withTenantContext(orgId, () => write()).catch(() => undefined);
    return;
  }
  await write();
}
