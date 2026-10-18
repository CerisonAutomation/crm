/**
 * Workflow graph validation — pure, Prisma-free.
 *
 * Lives in its own module (not `workflow-engine`, which touches the database) so
 * it can be unit-tested and so the template catalog can be validated without a
 * DB. `workflow-engine` re-exports `validateGraph` for existing call sites.
 */
import type { WfNode, WfEdge } from "./workflow-engine";

export const MAX_NODES = 40;
export const MAX_DEPTH = 30;

export function validateGraph(nodes: WfNode[], edges: WfEdge[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (nodes.length === 0) errors.push("Graph has no nodes");
  if (nodes.length > MAX_NODES) errors.push(`Graph exceeds maximum of ${MAX_NODES} nodes`);
  const triggers = nodes.filter((n) => n.pieceKey.startsWith("trigger."));
  if (triggers.length !== 1) errors.push(`Graph must have exactly one trigger node (found ${triggers.length})`);
  const keys = new Set(nodes.map((n) => n.key));
  if (keys.size !== nodes.length) errors.push("Duplicate node keys");
  for (const e of edges) {
    if (!keys.has(e.from) || !keys.has(e.to)) errors.push(`Edge ${e.from}→${e.to} references unknown node`);
  }
  // reachability from trigger
  if (triggers.length === 1) {
    const adj = new Map<string, string[]>();
    for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    const seen = new Set<string>();
    const stack = [triggers[0].key];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nxt of adj.get(cur) ?? []) stack.push(nxt);
    }
    for (const n of nodes) {
      if (!seen.has(n.key)) errors.push(`Node "${n.name}" is unreachable from the trigger`);
    }
    // illegal cycle check (DFS with recursion stack)
    const inStack = new Set<string>();
    const visit = (k: string, depth: number): void => {
      if (inStack.has(k)) { errors.push("Graph contains an illegal cycle"); return; }
      if (depth > MAX_DEPTH || seen.has(k)) return;
      inStack.add(k);
      for (const nxt of adj.get(k) ?? []) visit(nxt, depth + 1);
      inStack.delete(k);
    };
    visit(triggers[0].key, 0);
  }
  // approval nodes must declare an approving role
  for (const n of nodes) {
    if (n.pieceKey.startsWith("approval.") && !n.config?.role) {
      errors.push(`Approval node "${n.name}" must declare an approving role`);
    }
  }
  return { ok: errors.length === 0, errors };
}
