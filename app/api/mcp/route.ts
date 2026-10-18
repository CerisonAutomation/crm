import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, withTenantContext, type TenantTx } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { NODE_CATALOG } from "@/lib/nodes/catalog";
import { getExecutor } from "@/lib/nodes";
import { startRun } from "@/lib/services/workflow-engine";
import { emitAutomationEvent, AUTOMATION_TOPICS } from "@/lib/adapters/automation";
import { discover, listEndpoints, plan, provision } from "@/lib/services/autopilot";
import { audit } from "@/lib/api-helpers";
import { assertSameOrigin } from "@/lib/security/csrf";
import { hit } from "@/lib/rate-limit";
import { XERO_MCP_TOOLS, callXeroTool } from "@/lib/mcp/xero-tools";
import { BEXIO_MCP_TOOLS, callBexioTool } from "@/lib/mcp/bexio-tools";
import { GITHUB_MCP_TOOLS, callGithubTool } from "@/lib/mcp/github-tools";

export const dynamic = "force-dynamic";

/**
 * Citizen Lane — MCP server (Model Context Protocol) over JSON-RPC 2.0.
 *
 * Exposes the platform's REAL automation capabilities as MCP tools so any
 * MCP client (Claude, Cursor, AI agents…) can drive the platform:
 *
 *   list_workflows · run_workflow · list_nodes · run_node
 *   list_pages · list_cases · get_case · list_events · dispatch_event
 *   list_letters · platform_stats
 *
 * Auth — per-tenant token model (Tier-1: the tenant is authenticated, never
 * asserted — a client cannot self-select an organisation or its capabilities):
 *   • External MCP clients: `Authorization: Bearer <orgId>.<signature>`
 *     (or `x-mcp-token` header), where signature =
 *     hex(hmacSha256($LANE_INTERNAL_SECRET, "mcp-tenant:" + orgId)).
 *     Mint with: `deriveMcpTenantToken(orgId, process.env.LANE_INTERNAL_SECRET)`.
 *     The token is bound to ONE tenant; capabilities are assigned server-side.
 *     The shared master secret alone authenticates NOTHING (retired 2026-10).
 *   • In-app (admin console): the admin session cookie works as-is.
 *   • Without a valid token/session the endpoint answers 401 — nothing leaks.
 */

/* ── JSON-RPC framing ───────────────────────────────────────── */

interface RpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcResult = (id: RpcReq["id"], result: Record<string, unknown>) =>
  Response.json({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcReq["id"], code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } });

/* ── tool catalogue ─────────────────────────────────────────── */

const str = (description: string) => ({ type: "string", description });

const tools = [
  ...XERO_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  ...BEXIO_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  ...GITHUB_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  {
    name: "list_workflows",
    description: "List every workflow on the platform (id, name, description, status, version).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_workflow",
    description: "Run a PUBLISHED workflow by id with an optional context payload. Returns the run id and status.",
    inputSchema: {
      type: "object",
      properties: { workflowId: str("workflow id"), context: { type: "object", description: "trigger context / variables" } },
      required: ["workflowId"],
    },
  },
  {
    name: "list_nodes",
    description: "List the node registry — every automation piece type with its category and config fields.",
    inputSchema: { type: "object", properties: { category: str("optional category filter, e.g. Communication") } },
  },
  {
    name: "run_node",
    description: "Execute any registered node once with a config and context — the universal automation primitive (notify, case transition, delay preview…).",
    inputSchema: {
      type: "object",
      properties: {
        pieceKey: str("node piece key, e.g. action.notify.user"),
        config: { type: "object", description: "node config fields" },
        context: { type: "object", description: "run context available to templates" },
      },
      required: ["pieceKey"],
    },
  },
  {
    name: "list_pages",
    description: "List Lane Pages (id, title, slug, status, block count).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_cases",
    description: "List recent cases with client, service and status.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "default 20, max 50" } } },
  },
  {
    name: "get_case",
    description: "Fetch one case with client, documents and letters.",
    inputSchema: { type: "object", properties: { caseId: str("case id or reference, e.g. CL-2025-0001") }, required: ["caseId"] },
  },
  {
    name: "list_events",
    description: "List recent OutboxEvents (the platform event bus ledger).",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "default 20, max 100" } } },
  },
  {
    name: "dispatch_event",
    description: "Fire an event into the automation bus (outbound webhooks fan-out).",
    inputSchema: {
      type: "object",
      properties: { topic: str("event topic, e.g. custom.crm.sync"), payload: { type: "object" } },
      required: ["topic"],
    },
  },
  {
    name: "list_letters",
    description: "List issued official letters (type, reference, case, issuer).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "platform_stats",
    description: "Live platform counters: users, cases, workflows, runs, notifications, pages, audit events.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_hooks",
    description: "List auto-generated inbound hook endpoints (workflow, URL, active, call count). Secrets are never returned.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "predict_automation",
    description: "Auto-detect every exposable workflow: its trigger, the outbound topics it is predicted to emit, and the provisioning plan.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "provision_hooks",
    description: "Auto-generate/repair a signed inbound hook endpoint for every published workflow. Returns URLs (secrets withheld — read them once in the admin panel).",
    inputSchema: { type: "object", properties: {} },
  },
];

/** Tenant scope for a tool call; never fall back to an arbitrary organisation. */
async function resolveOrgId(orgId: string | undefined): Promise<string> {
  if (!orgId) throw new DomainError("Explicit tenant context is required", 400);
  const org = await db.organisation.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) throw new DomainError("Tenant not found", 404);
  return org.id;
}

const MCP_CAPABILITIES: Record<string, string> = {
  list_workflows: "workflow.read", run_workflow: "run.manage", list_nodes: "workflow.read",
  run_node: "run.manage", list_pages: "page.read", list_cases: "case.read.all",
  get_case: "case.read.all", list_events: "audit.read", dispatch_event: "run.manage",
  list_letters: "document.read.all", platform_stats: "audit.read", list_hooks: "workflow.read",
  predict_automation: "workflow.read", provision_hooks: "automation.manage",
};

// Accounting tools (xero_*, bexio_*) require the accounting.read capability.
for (const t of XERO_MCP_TOOLS) MCP_CAPABILITIES[t.name] = "accounting.read";
for (const t of BEXIO_MCP_TOOLS) MCP_CAPABILITIES[t.name] = "accounting.read";
for (const t of GITHUB_MCP_TOOLS) MCP_CAPABILITIES[t.name] = "github.read";

function requireMcpCapability(actor: McpActor, name: string) {
  const capability = MCP_CAPABILITIES[name];
  if (!capability || !actor.capabilities.includes(capability)) {
    throw new DomainError(`Forbidden: missing MCP capability for ${name}`, 403);
  }
}

/* ── tool implementations (REAL — every call hits live services) ── */

async function callTool(name: string, args: Record<string, unknown>, actor: McpActor, tx: TenantTx | typeof db): Promise<Record<string, unknown>> {
  requireMcpCapability(actor, name);
  const orgId = await resolveOrgId(actor.orgId);
  switch (name) {
    case "list_workflows": {
      const workflows = await tx.workflow.findMany({
        select: { id: true, name: true, description: true, status: true, currentVersion: true, disabled: true, updatedAt: true },
        where: { orgId }, orderBy: { updatedAt: "desc" },
      });
      return { workflows };
    }
    case "run_workflow": {
      const workflowId = String(args.workflowId ?? "");
      const workflow = await tx.workflow.findUnique({ where: { id: workflowId }, select: { orgId: true } });
      if (!workflow || workflow.orgId !== orgId) throw new DomainError("Workflow not found", 404);
      const run = await startRun({
        workflowId,
        trigger: "mcp.tool",
        context: { ...((args.context as Record<string, unknown>) ?? {}), orgId },
        actorLabel: `MCP (${actor.label})`,
      });
      await audit({ orgId, actorLabel: `MCP (${actor.label})`, action: "mcp.workflow.run", target: workflowId, after: { runId: run.id } });
      const fresh = await tx.workflowRun.findUnique({ where: { id: run.id }, select: { id: true, status: true, trigger: true, createdAt: true } });
      return { run: fresh };
    }
    case "list_nodes": {
      const category = args.category ? String(args.category) : undefined;
      const nodes = NODE_CATALOG
        .filter((n) => !category || n.category === category)
        .map((n) => ({ pieceKey: n.pieceKey, label: n.name, category: n.category, description: n.description, fields: n.fields.map((f) => f.key) }));
      return { nodes, categories: [...new Set(NODE_CATALOG.map((n) => n.category))] };
    }
    case "run_node": {
      const pieceKey = String(args.pieceKey ?? "");
      const executor = getExecutor(pieceKey);
      if (!executor) throw new DomainError(`Unknown node type: ${pieceKey}`, 400);
      const context = (args.context as Record<string, unknown>) ?? {};
      if (context.caseId) {
        const c = await tx.case.findUnique({ where: { id: String(context.caseId) }, select: { orgId: true } });
        if (!c || c.orgId !== orgId) throw new DomainError("Case not found", 404);
      }
      const result = await executor.execute((args.config as Record<string, unknown>) ?? {}, { ...context, orgId });
      await audit({ orgId, actorLabel: `MCP (${actor.label})`, action: "mcp.node.run", target: pieceKey });
      return { pieceKey, output: result.output, waitForApproval: result.waitForApproval === true };
    }
    case "list_pages": {
      const pages = await tx.lanePage.findMany({
        select: { id: true, title: true, slug: true, status: true, updatedAt: true, blocks: true },
        where: { orgId }, orderBy: { updatedAt: "desc" },
        take: 100,
      });
      return { pages: pages.map((p) => ({ id: p.id, title: p.title, slug: p.slug, status: p.status, updatedAt: p.updatedAt, blocks: JSON.parse(p.blocks || "[]").length })) };
    }
    case "list_cases": {
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 20)));
      const cases = await tx.case.findMany({
        select: { id: true, reference: true, status: true, riskFlag: true, createdAt: true, client: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        where: { orgId }, take: limit,
      });
      return { cases };
    }
    case "get_case": {
      const ref = String(args.caseId ?? "");
      const c = await tx.case.findFirst({
        where: { orgId, OR: [{ id: ref }, { reference: ref }] },
        include: {
          client: { select: { name: true, email: true, nationality: true } },
          documents: { select: { id: true, type: true, status: true, createdAt: true } },
          letters: { select: { id: true, fileName: true, version: true, createdAt: true } },
        },
      });
      if (!c) throw new DomainError(`Case not found: ${ref}`, 404);
      return { case: c };
    }
    case "list_events": {
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20)));
      // OutboxEvent predates tenant ownership in the schema. MCP only exposes
      // events whose canonical payload carries this tenant marker.
      const events = await tx.outboxEvent.findMany({ where: { payload: { contains: `"orgId":"${orgId}"` } }, orderBy: { createdAt: "desc" }, take: limit });
      return { events };
    }
    case "dispatch_event": {
      const topic = String(args.topic ?? "");
      // known platform topics + explicit custom.* namespace for external events
      const known = new Set<string>(AUTOMATION_TOPICS);
      if (!known.has(topic) && !/^custom\.[a-z0-9._-]+$/.test(topic)) {
        throw new DomainError(`Invalid topic "${topic}" — use a platform topic or "custom.<name>"`, 400);
      }
      const result = await emitAutomationEvent(topic as Parameters<typeof emitAutomationEvent>[0], { ...((args.payload as Record<string, unknown>) ?? {}), orgId }, { actor: `MCP (${actor.label})`, orgId });
      await audit({ orgId, actorLabel: `MCP (${actor.label})`, action: "mcp.event.dispatch", target: topic });
      return { dispatched: true, topic, delivery: result };
    }
    case "list_letters": {
      const letters = await tx.approvalLetter.findMany({
        select: { id: true, fileName: true, version: true, createdAt: true, uploadedBy: true, case: { select: { reference: true } } },
        where: { case: { orgId } }, orderBy: { createdAt: "desc" },
        take: 50,
      });
      return { letters };
    }
    case "platform_stats": {
      const [users, cases, workflows, publishedWorkflows, runs7d, notifications7d, pages, auditEvents] = await Promise.all([
        tx.user.count({ where: { orgId } }), tx.case.count({ where: { orgId } }), tx.workflow.count({ where: { orgId } }),
        tx.workflow.count({ where: { orgId, status: "PUBLISHED" } }),
        tx.workflowRun.count({ where: { workflow: { orgId }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
        tx.notification.count({ where: { user: { orgId }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
        tx.lanePage.count({ where: { orgId, status: "PUBLISHED" } }), tx.auditEvent.count({ where: { orgId } }),
      ]);
      return { stats: { users, cases, workflows, publishedWorkflows, runs7d, notifications7d, publishedPages: pages, auditEvents } };
    }
    case "list_hooks": {
      return { hooks: await listEndpoints(orgId) };
    }
    case "predict_automation": {
      const [resources, provisioningPlan] = await Promise.all([discover(orgId), plan(orgId)]);
      return { resources, plan: provisioningPlan };
    }
    case "provision_hooks": {
      const result = await provision(orgId, `MCP (${actor.label})`);
      await audit({ orgId: orgId, actorLabel: `MCP (${actor.label})`, action: "mcp.autopilot.provision", target: "hook-endpoints", after: { created: result.created, repaired: result.repaired } });
      // Secrets are deliberately withheld from the MCP surface (read them once in the admin panel).
      return { created: result.created, repaired: result.repaired, hooks: result.outcomes.map((o) => ({ workflowId: o.workflowId, name: o.name, url: o.url, created: o.created })) };
    }
    default:
      if (name.startsWith("xero_")) return callXeroTool(name, args);
      if (name.startsWith("bexio_")) return callBexioTool(name, args);
      if (name.startsWith("github_")) return callGithubTool(name, args);
      throw new DomainError(`Unknown tool: ${name}`, 400);
  }
}

/* ── auth ───────────────────────────────────────────────────── */

type McpActor = { label: string; orgId?: string; capabilities: string[] };

/**
 * Mint a per-tenant MCP token (pure — no DB — so ops can mint offline):
 *   token = orgId + '.' + hex(hmacSha256(secret, 'mcp-tenant:' + orgId))
 * The master secret alone authenticates nothing — only a token derived from
 * it, bound to one tenant, is accepted.
 */
export function deriveMcpTenantToken(orgId: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(`mcp-tenant:${orgId}`).digest("hex");
  return `${orgId}.${signature}`;
}

/**
 * Verify a presented per-tenant token. Returns the bound orgId, or null.
 * Constant-time on the signature; the tenant id is authenticated, never
 * asserted — a token minted for org A can never select org B.
 */
function verifyTenantToken(presented: string | undefined | null, secret: string): string | null {
  if (!presented) return null;
  const separator = presented.lastIndexOf(".");
  if (separator <= 0) return null;
  const orgId = presented.slice(0, separator);
  const signature = presented.slice(separator + 1);
  if (!orgId || !/^[0-9a-f]{64}$/i.test(signature)) return null;
  const expected = createHmac("sha256", secret).update(`mcp-tenant:${orgId}`).digest("hex");
  const a = Buffer.from(signature.toLowerCase());
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return orgId;
}

/**
 * Capabilities granted to a valid per-tenant token. Assigned SERVER-SIDE from
 * the tool catalogue — no client-asserted capabilities header is read (the old
 * x-mcp-capabilities header let any secret-holder escalate to any capability).
 *
 * Least privilege: tokens default to READ-ONLY tools. State-changing tools
 * (run_workflow, run_node, dispatch_event, provision_hooks, xero_*, bexio_*)
 * require an admin session — external writers graduate to a per-tenant
 * write-allowlist (needs a DB field) in a follow-up, not a shared secret.
 */
const TOKEN_READONLY_TOOLS: readonly string[] = [
  "list_workflows", "list_nodes", "list_pages", "list_cases", "get_case",
  "list_events", "list_letters", "platform_stats", "list_hooks", "predict_automation",
];
const TOKEN_MCP_CAPABILITIES: string[] = [
  ...new Set(
    TOKEN_READONLY_TOOLS.map((t) => MCP_CAPABILITIES[t]).filter((c): c is string => typeof c === "string"),
  ),
];

/** Constant-time comparison of a provided token against the shared secret. */
function matchesToken(provided: string | undefined, secret: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authenticate(req: NextRequest): Promise<McpActor> {
  const secret = process.env.LANE_INTERNAL_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const token = req.headers.get("x-mcp-token")?.trim();
  const presented = bearer || token;
  if (secret && presented) {
    // Retired (2026-10): the shared master secret presented directly, paired
    // with a self-asserted tenant/capability header, was cross-org privilege
    // escalation. It now authenticates nothing — present a per-tenant token.
    if (matchesToken(presented, secret)) {
      throw new DomainError(
        "Retired MCP credential — mint a per-tenant token for exactly one organisation instead of presenting the shared secret",
        401
      );
    }
    const orgId = verifyTenantToken(presented, secret);
    if (orgId) {
      return { label: "tenant-token", orgId, capabilities: TOKEN_MCP_CAPABILITIES };
    }
  }
  // In-app: the admin session cookie is a valid MCP credential.
  const ctx = await requireAuth(req);
  if (ctx.role === "ADMIN") return { label: `${ctx.name} [${ctx.role}]`, orgId: ctx.orgId, capabilities: Object.values(MCP_CAPABILITIES) };
  throw new DomainError(
    secret ? "Unauthorized — provide a valid per-tenant MCP token or admin session" : "Unauthorized — admin session required (set LANE_INTERNAL_SECRET for external clients)",
    401
  );
}

/* ── HTTP surface ───────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  // Discovery is authenticated: the tool inventory is only useful to callers who
  // can actually invoke the tools, and the response deliberately omits the
  // authentication scheme so it never advertises how to reach the endpoint.
  try {
    await authenticate(req);
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({
    server: "citizen-lane-mcp",
    protocol: "JSON-RPC 2.0 (POST)",
    tools: tools.map((t) => t.name),
  });
}

export async function POST(req: NextRequest) {
  // This route bypasses the shared `handler()` wrapper, so it must apply the
  // same-origin check itself: an admin session cookie is accepted as an MCP
  // credential below, and without this a cross-site page could POST a
  // state-changing `tools/call` (run_node → SSRF, run_workflow, dispatch_event)
  // riding that ambient cookie.
  try {
    assertSameOrigin(req);
  } catch {
    return Response.json({ error: "Cross-site request rejected" }, { status: 403 });
  }

  let body: RpcReq | RpcReq[];
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const handle = async (rpc: RpcReq): Promise<Response> => {
    if (rpc.jsonrpc !== "2.0" || !rpc.method) return rpcError(rpc.id ?? null, -32600, "Invalid Request");

    // initialize / ping need no auth (protocol handshake, no data exposed).
    // tools/list is authenticated: the tool inventory (names + input schemas)
    // is only useful to callers who can invoke the tools.
    if (rpc.method === "initialize") {
      return rpcResult(rpc.id ?? null, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "citizen-lane-mcp", version: "1.0.0" },
      });
    }
    if (rpc.method === "ping") return rpcResult(rpc.id ?? null, {});

    let actor: McpActor;
    try {
      actor = await authenticate(req);
    } catch (err) {
      const status = err instanceof DomainError ? err.status : 401;
      const message = err instanceof Error ? err.message : "Unauthorized";
      return Response.json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32001, message } }, { status });
    }

    // Authenticated, capability-filtered inventory: a caller only sees the
    // tools it may actually invoke (unknown/unmapped tools stay hidden).
    if (rpc.method === "tools/list") {
      const visible = tools.filter((t) => actor.capabilities.includes(MCP_CAPABILITIES[t.name] ?? ""));
      return rpcResult(rpc.id ?? null, { tools: visible });
    }

    if (rpc.method === "tools/call") {
      const name = String(rpc.params?.name ?? "");
      const args = (rpc.params?.arguments as Record<string, unknown>) ?? {};
      // Per-tenant abuse guard — token clients share nothing, sessions are per admin.
      const rl = hit(`mcp:call:${actor.orgId ?? actor.label}`, 120, 60_000);
      if (!rl.allowed) {
        return Response.json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32000, message: `Rate limit exceeded — retry in ${rl.retryAfterSec}s` } }, { status: 429 });
      }
      try {
        // Ponytail-S #2 (narrowed P1 wrap): READ-ONLY tools run inside the tenant
        // transaction so their reads enforce the RLS policy. MUTATING tools run
        // OUTSIDE any tx — their effects fan out to services, providers, and
        // external I/O that must never sit inside a 20s interactive tx (timeout
        // + Neon-HTTP hard-throw), and their threading is P3 with owning teams.
        // Their tenant checks are explicit orgId comparisons, unchanged.
        const MUTATING_TOOLS = new Set(["run_workflow", "run_node", "dispatch_event", "provision_hooks"]);
        const result = MUTATING_TOOLS.has(name)
          ? await callTool(name, args, actor, db)
          : await withTenantContext(actor.orgId ?? "", (tx) => callTool(name, args, actor, tx));
        return rpcResult(rpc.id ?? null, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool execution failed";
        return rpcResult(rpc.id ?? null, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
      }
    }

    return rpcError(rpc.id ?? null, -32601, `Method not found: ${rpc.method}`);
  };

  // Batch cap — a single POST cannot fan out unbounded parallel tool calls.
  if (Array.isArray(body)) {
    if (body.length > 10) return rpcError(null, -32600, "Batch too large (max 10 requests)");
    const responses = await Promise.all(body.filter((r) => r.id !== undefined && r.id !== null).map(handle));
    return responses.length === 1 ? responses[0] : Response.json(responses);
  }
  return handle(body);
}
