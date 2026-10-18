/**
 * Node registry barrel — server-side.
 * Binds catalog metadata to executors and exposes the lookup used by the
 * workflow engine. Client code imports catalog.ts directly (no server deps).
 */
export * from "./catalog";
export { EXECUTORS } from "./executors";
export type { Executor, ExecutorResult, RunContext } from "./executors";

import { NODE_CATALOG, type NodeMeta } from "./catalog";
import { EXECUTORS, type Executor } from "./executors";

/** Every node as { meta, executor } — the full registry. */
export function registry(): Array<{ meta: NodeMeta; executor: Executor | undefined }> {
  return NODE_CATALOG.map((meta) => ({ meta, executor: EXECUTORS[meta.pieceKey] }));
}

export function getExecutor(pieceKey: string): Executor | undefined {
  return EXECUTORS[pieceKey];
}
