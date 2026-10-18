/**
 * Next.js instrumentation hook — runs once per server process.
 *
 * This file is compiled for BOTH the Node and the Edge runtime, so it stays a
 * thin dispatcher and references no Node-only API. All of the actual boot work
 * (deployment-contract check, reminder sweeper, in-app automation scheduler,
 * and the crash-telemetry process guards) lives in @/lib/runtime/register-node
 * and is imported ONLY on the Node runtime. Keeping `process.on` / `process.exit`
 * out of this entry is what avoids Turbopack's "Node.js API used in the Edge
 * Runtime" warning — see that module's header.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNode } = await import("@/lib/runtime/register-node");
  await registerNode();
}
