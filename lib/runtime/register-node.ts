/**
 * Node-runtime boot — everything the instrumentation hook does on the Node
 * server:
 *  1. Evaluate the deployment contract (non-fatal; the same report surfaces on
 *     /api/health).
 *  2. Start the reminder sweeper and the in-app automation scheduler so both
 *     drive themselves without an external cron — on local dev / Docker only
 *     (on Vercel the unified /api/cron/tick route drives them).
 *  3. Install the process guards that give a stray async error a chance to
 *     reach the telemetry ledger, then exit non-zero so the process is
 *     replaced rather than serving from an unsafe state.
 *
 * Why this is a separate module: `src/instrumentation.ts` is compiled for BOTH
 * the Node and the Edge runtime. Any Node-only API referenced lexically in that
 * entry — here `process.on` and `process.exit` — trips Turbopack's "A Node.js
 * API is used … which is not supported in the Edge Runtime" warning even when
 * it sits behind a runtime guard, because the check is lexical, not
 * value-flow. Next.js' documented pattern is to guard in the entry and import
 * the Node body dynamically, which keeps those APIs out of the Edge bundle.
 */
import { reportError } from "@/lib/errors";

/** Run the Node-only boot sequence. Called once, from `register()`. */
export async function registerNode(): Promise<void> {
  // Evaluate the deployment contract once at boot. Non-fatal by design: a
  // crash-looping function is worse than one serving with a flagged gap, and the
  // same report is exposed on /api/health for humans and uptime checks.
  const { assertProductionReady } = await import("@/lib/deployment");
  assertProductionReady();

  // On Vercel the unified /api/cron/tick route drives every scheduler (Fluid
  // Compute freezes in-process timers between invocations and scales to zero).
  // Keep the in-process schedulers for local dev / Docker only.
  if (!process.env.VERCEL) {
    const { ensureReminderSweeper } = await import("@/lib/services/reminders");
    ensureReminderSweeper();

    const { startAutomationScheduler } = await import("@/lib/automation/queue");
    startAutomationScheduler();
  }

  // Resilience guard — log stray unhandled promise rejections (typically from
  // fire-and-forget tasks) with full detail instead of letting one take the
  // server down.
  if (typeof process.on === "function") {
    process.on("unhandledRejection", (reason) => {
      reportError(reason, { scope: "unhandledRejection" });
      void import("@/lib/telemetry/errors")
        .then(({ captureServerError }) => captureServerError(reason, { scope: "unhandledRejection" }))
        .catch(() => undefined);
    });

    // Capture, then CRASH. The handler exists only so the error reaches the
    // ledger; it deliberately does not swallow the failure — after the write
    // resolves (or a 2s ceiling, whichever comes first) the process exits
    // non-zero and is replaced rather than serving from an unsafe state.
    process.on("uncaughtException", (err) => {
      reportError(err, { scope: "uncaughtException" });
      const bail = () => process.exit(1);
      const ceiling = setTimeout(bail, 2000);
      void import("@/lib/telemetry/errors")
        .then(({ captureServerError }) => captureServerError(err, { scope: "uncaughtException" }))
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(ceiling);
          bail();
        });
    });
  }
}
