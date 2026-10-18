/**
 * n8n graph compiler — the *workflows-only* half of the n8n bridge.
 *
 * The platform keeps its own always-on engine (src/lib/automation/*): events,
 * routines, the dispatcher and the run ledger are NOT exported and NOT
 * mirrored. What travels to n8n is the workflow graph itself — the pieces an
 * author composed in the Studio — so a self-hosted n8n instance can run the
 * same journeys, be edited by an integrator who prefers n8n, and hand work back
 * to the platform through its existing, authenticated MCP tool surface.
 *
 * Design rules, in order of importance:
 *
 * 1. **No dead endpoints.** Every action node compiles to an
 *    `httpRequest` that calls a route that already exists
 *    (`POST /api/mcp` → tool `run_node`), authenticated with a bearer token the
 *    platform already issues. Nothing in the compiled graph points at a future
 *    route.
 * 2. **Deterministic output.** Webhook paths, node ids and webhook ids are
 *    derived from the workflow/node keys, so compiling twice yields byte-equal
 *    JSON and re-importing does not duplicate webhooks or churn a diff.
 * 3. **Verified TypeVersions only.** The versions below were confirmed against
 *    the self-hosted instance this repo was built alongside (n8n 2.x, SQLite);
 *    a node type imported with a wrong typeVersion fails at activation, not at
 *    import, which is the failure mode this list exists to prevent.
 * 4. **No credentials in the artefact.** Connection details arrive through
 *    n8n's own environment (`CITIZEN_LANE_URL`, `CITIZEN_LANE_MCP_TOKEN`); the
 *    exported JSON carries no secret, no token and no account id.
 */
import { NODE_CATALOG } from "@/lib/nodes/catalog";
import { TEMPLATE_GRAPHS, templateGallery, type TemplateGraph } from "@/lib/services/workflow-templates";
import type { WfNode } from "@/lib/services/workflow-engine";

// ── Contract ────────────────────────────────────────────────────────────────

/** Env var n8n must define: the platform's public base URL (no trailing slash). */
export const APP_URL_VARIABLE = "$env.CITIZEN_LANE_URL";
/** Env var n8n must define: a `LANE_INTERNAL_SECRET`-scoped MCP bearer token. */
export const APP_TOKEN_VARIABLE = "$env.CITIZEN_LANE_MCP_TOKEN";
/** The platform route every mirrored action node calls back into. */
export const MCP_ENDPOINT = "/api/mcp";
/** The platform route n8n may call to start an app-side run. */
export const TRIGGER_ENDPOINT = "/api/n8n/triggers";

/**
 * The node types the platform compiles to, each with the typeVersion verified
 * against the self-hosted instance. Adding a node type means verifying it first.
 */
export const N8N_NODE_TYPES = {
  webhook: { type: "n8n-nodes-base.webhook", typeVersion: 2 },
  schedule: { type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2 },
  manual: { type: "n8n-nodes-base.manualTrigger", typeVersion: 1 },
  condition: { type: "n8n-nodes-base.if", typeVersion: 2 },
  wait: { type: "n8n-nodes-base.wait", typeVersion: 1.1 },
  http: { type: "n8n-nodes-base.httpRequest", typeVersion: 4.2 },
} as const;

export type N8nNodeType = (typeof N8N_NODE_TYPES)[keyof typeof N8N_NODE_TYPES]["type"];

export type N8nNode = {
  id: string;
  name: string;
  type: N8nNodeType;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  notes?: string;
  notesInFlow?: boolean;
  webhookId?: string;
};

export type N8nConnections = Record<
  string,
  { main: Array<Array<{ node: string; type: "main"; index: number }>> }
>;

export type N8nWorkflow = {
  name: string;
  nodes: N8nNode[];
  connections: N8nConnections;
  settings: { executionOrder: "v1" };
  pinData: Record<string, never>;
  tags: Array<{ name: string }>;
  /** Imported inactive, deliberately: activation is an operator decision. */
  active: false;
  /** Compiler metadata — n8n ignores unknown top-level keys. */
  meta: {
    source: "citizen-lane";
    templateKey: string;
    nodeCount: number;
    requiresApp: true;
  };
};

export type N8nBundle = {
  source: "citizen-lane";
  /** Where the artefact came from, so an operator can re-diff after a change. */
  endpoint: string;
  notes: readonly string[];
  workflows: N8nWorkflow[];
};

/**
 * The operator-facing caveats. Kept in the module (and served with the bundle)
 * rather than in a wiki: whoever imports the file needs them at that moment.
 */
export const N8N_IMPORT_NOTES: readonly string[] = [
  `Set ${APP_URL_VARIABLE} to this instance's base URL and ${APP_TOKEN_VARIABLE} to a bearer token minted from LANE_INTERNAL_SECRET before activating anything.`,
  `Action nodes call POST ${MCP_ENDPOINT} (MCP tool run_node), so the platform remains the only system that touches cases, documents, DHL, AI and the audit ledger.`,
  "Triggers are imported inactive and respond on receipt (responseMode onReceived); point the platform's n8n connector at the webhook path to close the loop.",
  "Human approval gates compile to a Wait (resume: webhook) node — approve from the platform and resume the waiting execution, or replace the node with your own approval channel.",
  `The app-side engine stays authoritative: POST ${TRIGGER_ENDPOINT} starts a run of a published workflow here instead of mirroring it.`,
];

// ── Deterministic identifiers ───────────────────────────────────────────────

/**
 * FNV-1a, four rounds over salted seeds → 32 hex chars. A tiny, dependency-free
 * hash is deliberate: the ids must be identical in the browser, in Node and in
 * a CI job that never loads `node:crypto`.
 */
function stableId(seed: string): string {
  let out = "";
  for (let round = 0; round < 4; round += 1) {
    let hash = 0x811c9dc5 ^ (round * 0x9e3779b9);
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(16).padStart(8, "0");
  }
  return out;
}

/** A URL/filename-safe slug of an arbitrary label. */
export function n8nSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workflow"
  );
}

/** The webhook path an n8n trigger for this piece listens on. */
export function webhookPath(workflowKey: string, pieceKey: string): string {
  return `citizen-lane/${n8nSlug(workflowKey.replace(/^tpl-/, ""))}/${n8nSlug(pieceKey.replace(/^trigger\./, ""))}`;
}

// ── Compilation ─────────────────────────────────────────────────────────────

type Compiled = Pick<N8nNode, "type" | "typeVersion" | "parameters" | "notes" | "webhookId">;

const notes = (pieceKey: string, extra?: string): string =>
  `Citizen Lane ${pieceKey}${extra ? ` — ${extra}` : ""}`;

/**
 * The call-back body every action node posts to the platform's MCP endpoint.
 * Written as one n8n expression so the config is embedded literally (never
 * interpolated into a shell or a URL) and the upstream item's fields arrive as
 * `context`.
 */
function runNodeBody(node: WfNode): string {
  const pieceKey = JSON.stringify(node.pieceKey);
  const config = JSON.stringify(node.config ?? {});
  return (
    '={{ JSON.stringify({ jsonrpc: "2.0", id: $execution.id, method: "tools/call",' +
    ` params: { name: "run_node", arguments: { pieceKey: ${pieceKey}, config: ${config}, context: $json } } }) }}`
  );
}

/** Compile one app piece into the n8n node that mirrors it. */
function compilePiece(node: WfNode, workflowKey: string): Compiled {
  const { pieceKey, config } = node;

  if (pieceKey === "trigger.manual") {
    return {
      ...N8N_NODE_TYPES.manual,
      parameters: {},
      notes: notes(pieceKey, "started by hand in n8n"),
    };
  }

  if (pieceKey === "trigger.schedule.due") {
    const cron = typeof config.cron === "string" && config.cron.trim() ? config.cron : "0 8 * * 1-5";
    return {
      ...N8N_NODE_TYPES.schedule,
      parameters: { rule: { interval: [{ field: "cronExpression", expression: cron }] } },
      notes: notes(pieceKey, `cron ${cron}`),
    };
  }

  if (pieceKey.startsWith("trigger.")) {
    const path = webhookPath(workflowKey, pieceKey);
    return {
      ...N8N_NODE_TYPES.webhook,
      parameters: {
        httpMethod: "POST",
        path,
        // Ack on receipt: the mirrored graph has no Respond-to-Webhook node to
        // call, and a hanging trigger would stall the platform's sender.
        responseMode: "onReceived",
        options: {},
      },
      webhookId: stableId(`${workflowKey}:${pieceKey}:webhook`),
      notes: notes(pieceKey, `POST /webhook/${path}`),
    };
  }

  if (pieceKey === "condition.field.equals" || pieceKey === "condition.field.exists") {
    const left = typeof config.left === "string" && config.left ? config.left : "field";
    const exists = pieceKey === "condition.field.exists";
    return {
      ...N8N_NODE_TYPES.condition,
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
          conditions: [
            {
              id: stableId(`${workflowKey}:${node.key}`),
              leftValue: `={{ $json[${JSON.stringify(left)}] }}`,
              ...(exists
                ? undefined : { rightValue: typeof config.value === "string" ? config.value : String(config.value ?? "") }),
              operator: exists
                ? { type: "string", operation: "exists", singleValue: true }
                : { type: "string", operation: "equals" },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
      notes: notes(pieceKey, exists ? `exists: ${left}` : `${left} equals ${String(config.value ?? "")}`),
    };
  }

  if (pieceKey === "delay.duration") {
    const minutes = Number(config.minutes ?? (Number(config.hours) || 0) * 60) || 60;
    return {
      ...N8N_NODE_TYPES.wait,
      parameters: { amount: minutes, unit: "minutes" },
      notes: notes(pieceKey, `${minutes} minutes`),
    };
  }

  // Waits that the platform owns (authority follow-up, cross-workflow waits) and
  // human approval gates both suspend until something external resumes them.
  if (pieceKey === "delay.authority_followup" || pieceKey === "wait.workflow" || pieceKey === "approval.human.gate") {
    return {
      ...N8N_NODE_TYPES.wait,
      parameters: { resume: "webhook" },
      notes: notes(
        pieceKey,
        pieceKey === "approval.human.gate"
          ? "human gate — approve on the platform, then resume this execution"
          : "platform-owned wait — resumed by the app when the waitpoint fires",
      ),
    };
  }

  // Everything else is a platform action (notify, email, WhatsApp, webhook, case
  // transition, request, DHL, AI compose, audit export). The platform executes
  // it; n8n only orchestrates.
  const url = `=${APP_URL_VARIABLE}${MCP_ENDPOINT}`;
  return {
    ...N8N_NODE_TYPES.http,
    parameters: {
      method: "POST",
      url,
      authentication: "none",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "content-type", value: "application/json" },
          { name: "authorization", value: `=Bearer ${APP_TOKEN_VARIABLE}` },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: runNodeBody(node),
      options: {},
    },
    notes: notes(pieceKey, "executed by the platform via MCP run_node"),
  };
}

/** Lay a graph out left-to-right in dependency order (stable, readable). */
function layout(graph: TemplateGraph): Map<string, [number, number]> {
  const incoming = new Map<string, number>();
  for (const n of graph.nodes) incoming.set(n.key, 0);
  for (const e of graph.edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);

  const depth = new Map<string, number>();
  const order = graph.nodes.map((n) => n.key);
  for (const key of order) depth.set(key, 0);
  for (let pass = 0; pass < order.length; pass += 1) {
    for (const e of graph.edges) {
      const next = Math.max(depth.get(e.to) ?? 0, (depth.get(e.from) ?? 0) + 1);
      if (next !== depth.get(e.to)) depth.set(e.to, next);
    }
  }
  const rows = new Map<number, number>();
  const positions = new Map<string, [number, number]>();
  for (const key of order) {
    const column = depth.get(key) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions.set(key, [240 + column * 260, 300 + row * 160]);
  }
  return positions;
}

/** Connections keyed by node NAME (n8n's own contract), in the app's edge order. */
function connect(graph: TemplateGraph, nameOf: Map<string, string>): N8nConnections {
  const connections: N8nConnections = {};
  const seen = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const from = nameOf.get(edge.from);
    const to = nameOf.get(edge.to);
    if (!from || !to || from === to) continue;
    const already = seen.get(from) ?? new Set<string>();
    if (already.has(to)) continue;
    already.add(to);
    seen.set(from, already);
    // A condition node has two outputs (true|false); the app models a single
    // successor, so it wires to the true branch.
    const output = 0;
    const entry = (connections[from] ??= { main: [[], []] });
    entry.main[output].push({ node: to, type: "main", index: 0 });
  }
  for (const [from, entry] of Object.entries(connections)) {
    entry.main = entry.main.filter((outputs) => outputs.length > 0);
    if (entry.main.length === 0) delete connections[from];
  }
  return connections;
}

/**
 * Compile one template graph into an importable n8n workflow.
 *
 * Node names are the app's node names (deduplicated) — an operator comparing the
 * studio canvas with the n8n canvas sees the same labels in the same order.
 */
export function compileWorkflow(
  workflowKey: string,
  graph: TemplateGraph,
  meta?: { name?: string; description?: string },
): N8nWorkflow {
  const positions = layout(graph);
  const nameOf = new Map<string, string>();
  const used = new Map<string, number>();
  for (const node of graph.nodes) {
    const base = node.name?.trim() || node.pieceKey;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    nameOf.set(node.key, seen === 0 ? base : `${base} (${seen + 1})`);
  }

  const nodes: N8nNode[] = graph.nodes.map((node) => {
    const compiled = compilePiece(node, workflowKey);
    const name = nameOf.get(node.key);
    if (!name) throw new Error(`node ${node.key} lost its name`);
    const position = positions.get(node.key) ?? [240, 300];
    const catalog = NODE_CATALOG.find((c) => c.pieceKey === node.pieceKey);
    return {
      id: stableId(`${workflowKey}:${node.key}`),
      name,
      type: compiled.type,
      typeVersion: compiled.typeVersion,
      position,
      parameters: compiled.parameters,
      notes: `${compiled.notes ?? notes(node.pieceKey)}${catalog ? ` · ${catalog.category}` : ""}`,
      notesInFlow: false,
      ...(compiled.webhookId ? { webhookId: compiled.webhookId } : undefined),
    };
  });

  return {
    name: meta?.name?.trim() || workflowKey,
    nodes,
    connections: connect(graph, nameOf),
    settings: { executionOrder: "v1" },
    pinData: {},
    tags: [{ name: "citizen-lane" }],
    active: false,
    meta: {
      source: "citizen-lane",
      templateKey: workflowKey,
      nodeCount: nodes.length,
      requiresApp: true,
    },
  };
}

/** Template metadata (name/description) by key, from the gallery that authored them. */
function galleryIndex(): Map<string, { name: string; description: string }> {
  return new Map(templateGallery().map((t) => [t.key, { name: t.name, description: t.description }]));
}

/**
 * Compile every template (or a selected subset) into one import bundle.
 * An unknown key is a caller error, not a silently empty export.
 */
export function exportN8nBundle(keys?: readonly string[]): N8nBundle {
  const wanted = keys && keys.length > 0 ? [...keys] : Object.keys(TEMPLATE_GRAPHS);
  const unknown = wanted.filter((key) => !(key in TEMPLATE_GRAPHS));
  if (unknown.length > 0) throw new Error(`Unknown workflow template(s): ${unknown.join(", ")}`);

  const gallery = galleryIndex();
  const workflows = wanted.map((key) => {
    const meta = gallery.get(key);
    return compileWorkflow(key, TEMPLATE_GRAPHS[key], meta ? { name: meta.name, description: meta.description } : undefined);
  });

  return { source: "citizen-lane", endpoint: TRIGGER_ENDPOINT, notes: N8N_IMPORT_NOTES, workflows };
}

/** The filename an operator should save a compiled workflow under. */
export function n8nFileName(workflow: N8nWorkflow): string {
  return `${n8nSlug(workflow.name)}.n8n.json`;
}

/**
 * The manifest n8n (or an operator) needs to call back in: the triggers the
 * platform can raise, and the endpoint that starts an app-side run.
 */
export function triggerManifest(): {
  endpoint: string;
  transport: string;
  auth: string;
  triggers: Array<{ pieceKey: string; name: string; outputs: string[] }>;
} {
  return {
    endpoint: TRIGGER_ENDPOINT,
    transport: "POST application/json",
    auth: "Authorization: Bearer <n8n connector API key, or INTERNAL_AUTOMATION_TOKEN>",
    triggers: NODE_CATALOG.filter((n) => n.category === "Trigger").map((n) => ({
      pieceKey: n.pieceKey,
      name: n.name,
      outputs: n.outputs,
    })),
  };
}
