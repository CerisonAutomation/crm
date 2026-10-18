/**
 * Database adapter selection — pure, Prisma-free logic.
 * The app defaults to Neon's serverless driver; CI and other plain-Postgres
 * environments opt into the standard pg driver via DB_DRIVER=pg.
 */

export type DbAdapterKind = "neon" | "pg";

/**
 * Returns "pg" only when DB_DRIVER is explicitly "pg".
 * Any other value (including undefined, "neon", or anything else) yields "neon".
 * This is intentional: we never infer the adapter from the URL string.
 */
export function selectDbAdapterKind(env: { DB_DRIVER?: string }): DbAdapterKind {
  return env.DB_DRIVER === "pg" ? "pg" : "neon";
}

/**
 * True only where $transaction exists (pg driver). Neon-HTTP rejects
 * interactive transactions, so tx-needing paths must branch on this instead
 * of hard-throwing there. Shared by queue.ts (own local copy predates this)
 * and workflow-engine run/key linking.
 */
export function supportsInteractiveTx(env: { DB_DRIVER?: string } = process.env as { DB_DRIVER?: string }): boolean {
  return selectDbAdapterKind(env) === "pg";
}