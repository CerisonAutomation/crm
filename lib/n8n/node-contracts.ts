/**
 * Node contracts for n8n operations.
 * Defines typed execution contracts for n8n workflow operations following patterns from cl-nodes.txt.
 */

export type NodeCategory = "Trigger" | "Logic" | "Communication" | "CRM" | "Approval" | "AI" | "Compliance";

export type NodeFieldType = "text" | "textarea" | "number" | "select" | "boolean";

export type NodeField = {
  key: string;
  label: string;
  type: NodeFieldType;
  options?: string[];
  placeholder?: string;
  help?: string;
  required?: boolean;
};

export type NodeMeta = {
  pieceKey: string;
  name: string;
  category: NodeCategory;
  description: string;
  fields: NodeField[];
  /** Context keys this node writes (surfaced in the studio as "outputs"). */
  outputs: string[];
};

/**
 * Which credential an executor may use. `none` = pure/context-only.
 */
export type NodeAuthScope = "none" | "org-secret" | "user";

/**
 * Replay semantics of a node (R3):
 * - "idempotent" — re-execution is safe (pure logic, reads, notifications
 *   keyed by run+node); the engine may replay the recorded output.
 * - "at-least-once" — side effects may duplicate on retry (email, webhook,
 *   DHL booking); callers must tolerate or dedupe downstream.
 */
export type NodeIdempotencyKind = "idempotent" | "at-least-once";

export type NodeContract = {
  /** Contract version of this node (for graph-vs-catalog drift detection). */
  version: number;
  /** Credential scope the executor runs under. */
  auth: NodeAuthScope;
  /** Replay semantics (see NodeIdempotencyKind). */
  idempotency: NodeIdempotencyKind;
  /** Per-execution timeout budget in ms (engine races the executor). */
  timeoutMs: number;
};

/**
 * Default timeout budget for a node execution (a hung webhook/AI call must
 * not pin a run). Single-sourced from configuration so the contract and the
 * enforcement budget can never drift apart.
 */
export const DEFAULT_NODE_TIMEOUT_MS = 30_000; // 30 seconds
export const SHORT_NODE_TIMEOUT_MS = 5_000;   // 5 seconds for pure operations

/**
 * Nodes whose executors touch org-scoped secrets or external side effects.
 */
export const N8N_ORG_SECRET_PIECES: ReadonlySet<string> = new Set([
  "n8n.workflows",           // Get workflows list (read-only, but may expose secrets in responses)
  "n8n.workflow",            // Get workflow detail (may expose node configs with secrets)
  "n8n.executions",          // Get executions list (may expose execution data)
  "n8n.execution",           // Get execution detail (may expose outputs/errors with sensitive data)
  "n8n.testWorkflow",        // Test workflow (may trigger side effects)
  "n8n.toggleWorkflow",      // Toggle workflow (changes state)
]);

/**
 * Side-effecting nodes: replay may duplicate the effect (at-least-once).
 */
export const N8N_AT_LEAST_ONCE_PIECES: ReadonlySet<string> = new Set([
  "n8n.testWorkflow",        // Testing triggers actual execution
  "n8n.toggleWorkflow",      // Changing workflow state
]);

/**
 * Node catalog — pure metadata for every n8n operation node.
 * 
 * This file is CLIENT-SAFE (no server imports): the n8n workflow manager
 * imports it directly to understand operation characteristics, and the
 * backend registry binds the same pieceKeys to their implementations.
 */
export const N8N_NODE_CATALOG: NodeMeta[] = [
  // ── Workflow Operations ──
  {
    pieceKey: "n8n.workflows",
    name: "Get Workflows List",
    category: "Communication",
    description: "Retrieves a list of workflows from the n8n instance",
    fields: [],
    outputs: ["workflows", "count"],
  },
  {
    pieceKey: "n8n.workflow",
    name: "Get Workflow Detail",
    category: "Communication",
    description: "Retrieves detailed information about a specific workflow",
    fields: [
      { key: "workflowId", label: "Workflow ID", type: "text", placeholder: "e.g. 1abc2d3e4f5g6h7i8j9k0l", required: true },
    ],
    outputs: ["workflow", "nodes", "connections"],
  },
  {
    pieceKey: "n8n.executions",
    name: "Get Executions List",
    category: "Communication",
    description: "Retrieves a list of executions from the n8n instance",
    fields: [],
    outputs: ["executions", "count"],
  },
  {
    pieceKey: "n8n.execution",
    name: "Get Execution Detail",
    category: "Communication",
    description: "Retrieves detailed information about a specific execution",
    fields: [
      { key: "executionId", label: "Execution ID", type: "text", placeholder: "e.g. 2def3g4h5i6j7k8l9m0n1o", required: true },
    ],
    outputs: ["execution", "output", "error"],
  },
  {
    pieceKey: "n8n.testWorkflow",
    name: "Test Workflow",
    category: "AI",
    description: "Tests a workflow with a payload",
    fields: [
      { key: "workflowId", label: "Workflow ID", type: "text", placeholder: "e.g. 3ghi4j5k6l7m8n9o0p1q2r", required: true },
      { key: "payload", label: "Test Payload", type: "textarea", placeholder: '{"key": "value"}', required: true },
    ],
    outputs: ["success", "output", "error"],
  },
  {
    pieceKey: "n8n.toggleWorkflow",
    name: "Toggle Workflow Active State",
    category: "Approval",
    description: "Activates or deactivates a workflow",
    fields: [
      { key: "workflowId", label: "Workflow ID", type: "text", placeholder: "e.g. 4jkl5l6m7n8o9p0q1r2s3t", required: true },
      { key: "active", label: "Active State", type: "boolean", required: true },
    ],
    outputs: ["success", "message"],
  },
];

/**
 * Effective execution contract for a pieceKey. Pure + deterministic so the
 * engine can enforce timeout/auth/idempotency without a database round-trip.
 */
export function n8nNodeContractFor(pieceKey: string): NodeContract {
  const trigger = pieceKey.startsWith("trigger.");
  return {
    version: 1,
    auth: N8N_ORG_SECRET_PIECES.has(pieceKey) ? "org-secret" : "none",
    // Operations that trigger side effects or modify state are not idempotent
    idempotency: N8N_AT_LEAST_ONCE_PIECES.has(pieceKey) ? "at-least-once" : "idempotent",
    // External calls get the full budget; pure operations fail fast.
    timeoutMs: N8N_ORG_SECRET_PIECES.has(pieceKey) || pieceKey.startsWith("n8n.") 
      ? DEFAULT_NODE_TIMEOUT_MS 
      : SHORT_NODE_TIMEOUT_MS,
  };
}