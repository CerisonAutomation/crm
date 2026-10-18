/**
 * Demo-data reset — restores the canonical sandbox dataset in-process.
 *
 * The seed scripts (`prisma/seed*.ts`) are the single source of truth for what
 * the demo looks like; this service just runs them in order so the admin
 * console's "Reset demo data" action can never drift from `pnpm db:seed`.
 *
 * Seeds are loaded with dynamic `import()` so their top-level PrismaClient is
 * never constructed just because this module was touched. Refuses in production:
 * the dataset plants well-known accounts with one shared password, which must
 * never reach a real deployment.
 */
import { disconnectSeedClient } from "@/prisma/seed-client";
import { db } from "@/lib/db";
import { audit } from "@/lib/api-helpers";

export type DemoResetResult = {
  ok: boolean;
  /** Row counts after the reset — the admin console shows these as proof. */
  counts: {
    users: number;
    cases: number;
    documents: number;
    requests: number;
    notifications: number;
    auditEvents: number;
  };
};

export type DemoActor = { id: string; label: string; orgId: string };

export async function resetDemoData(actor: DemoActor, correlationId?: string): Promise<DemoResetResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo-data reset is unavailable in production.");
  }

  // Load the seeds lazily — each builds a PrismaClient at import time.
    const [{ seedBase }, { seedDemoFull }, { seedDemoExtra }, { seedDemoGaps }] =
      await Promise.all([
        import("@/prisma/seed"),
        import("@/prisma/seed-demo-full"),
        import("@/prisma/seed-demo-extra"),
        import("@/prisma/seed-demo-gaps"),
      ]);
  
    // Order matters: base (identity + case spine) → full (everything else) →
    // extra (contacts/CRM/runs/webhooks) → gaps (remaining user-visible models).
    // Each pass is idempotent.
    await seedBase();
    await seedDemoFull();
    await seedDemoExtra();
    await seedDemoGaps();
    await disconnectSeedClient();
  
    const [users, cases, documents, requests, notifications, auditEvents] =
      await Promise.all([
        db.user.count(),
        db.case.count(),
        db.document.count(),
        db.documentRequest.count(),
        db.notification.count(),
        db.auditEvent.count(),
      ]);
  
    await audit({
      orgId: actor.orgId,
      actorId: actor.id,
      actorLabel: actor.label,
      action: "demo.reset",
      target: "sandbox demo dataset",
      after: { users, cases, documents, requests, notifications },
      correlationId,
    });
  
    return {
      ok: true,
      counts: { users, cases, documents, requests, notifications, auditEvents },
    };
}
