/**
 * Deployment contract — what this app requires, and where it is running.
 *
 * `env.ts` is a *lenient reader*: every key has a fallback so a local sandbox
 * boots with an empty `.env`. That is correct for development and wrong for
 * production, where a missing AUTH_SECRET silently degrades the whole system
 * instead of stopping it. This module supplies the missing half: a single,
 * declarative statement of what a real deployment needs, evaluated on demand.
 *
 * Nothing here throws at import time. `deploymentReport()` returns findings and
 * the callers decide the policy:
 *   - `assertProductionReady()` — used at boot on a serverless host; logs hard
 *     problems loudly. It does NOT exit, because a crash-looping function on
 *     Vercel is a worse outcome than one serving with a degraded feature, and
 *     the report is also surfaced through /api/health for humans to see.
 *   - /api/health — exposes the same report so a deployment's readiness is
 *     observable without reading logs.
 *
 * Server-only: reads process.env and must never reach a client bundle.
  */
 
 import { KNOWN_STORAGE_DRIVERS } from "@/lib/storage";
 
 export type Severity = "blocker" | "warning";

export type Finding = {
  key: string;
  severity: Severity;
  /** What breaks, concretely. */
  impact: string;
  /** How to fix it. */
  remedy: string;
};

export type DeploymentReport = {
  host: "vercel" | "netlify" | "lambda" | "self-hosted";
  serverless: boolean;
  /** The storage + database backends actually selected for this host. */
  storageDriver: string;
  readiness: "ready" | "degraded" | "not-ready";
  findings: Finding[];
};

const has = (k: string): boolean => Boolean(process.env[k]?.trim());

/** Serverless hosts: ephemeral, read-only filesystem outside /tmp. */
export function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function host(): DeploymentReport["host"] {
  if (process.env.VERCEL) return "vercel";
  if (process.env.NETLIFY) return "netlify";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return "lambda";
  return "self-hosted";
}

/** The storage driver the storage port will select, mirroring its own logic. */
function effectiveStorageDriver(): string {
  const explicit = process.env.STORAGE_DRIVER?.trim();
  if (explicit) return explicit;
  return isServerless() ? "vercel" : "local";
}

/**
 * Evaluate the deployment against what this build actually needs.
 *
 * Only requirements that are genuinely load-bearing are listed. A var that has a
 * safe, documented default (TURN_*, VAPID_*) is deliberately NOT here —
 * flagging a working configuration as broken trains people to ignore the report.
 */
export function deploymentReport(): DeploymentReport {
  const findings: Finding[] = [];
  const serverless = isServerless();
  const storageDriver = effectiveStorageDriver();

  // ── Database ────────────────────────────────────────────────────────────
  if (!has("DATABASE_URL")) {
    findings.push({
      key: "DATABASE_URL",
      severity: "blocker",
      impact: "Prisma has no datasource: every request that touches the database fails.",
      remedy: "Set DATABASE_URL to the Neon pooled connection string.",
    });
  }
  // ── Provider agreement ──────────────────────────────────────────────────
  // The datasource provider is a literal in schema.prisma (Prisma rejects env()
  // there), so a build generated against the wrong provider fails at the first
  // query with a confusing engine error. Point at the fix directly.
  const looksPostgres = (process.env.DATABASE_URL ?? "").startsWith("postgres");
  if (has("DATABASE_URL") && serverless && !looksPostgres) {
    findings.push({
      key: "DATABASE_URL",
      severity: "blocker",
      impact: "The URL is not a postgres:// connection string but this is a serverless host.",
      remedy: "Set DATABASE_URL to the Neon pooled connection string.",
    });
  }
  if (serverless && has("DATABASE_URL") && looksPostgres && !has("DIRECT_URL")) {
    findings.push({
      key: "DIRECT_URL",
      severity: "warning",
      impact: "Migrations have no direct connection: `prisma migrate` will fail against the pooler.",
      remedy: "Set DIRECT_URL to the Neon direct (non-pooled) connection string.",
    });
  }

  // ── Encryption key ──────────────────────────────────────────────────────
  // Without a stable key, every connector credential written under one key
  // becomes undecryptable the moment that key changes.
  if (!has("INTEGRATION_SECRET_KEY") && !has("AUTH_SECRET")) {
    findings.push({
      key: "INTEGRATION_SECRET_KEY",
      severity: serverless ? "blocker" : "warning",
      impact:
        "No stable encryption key. On a serverless host the key is derived from public deployment " +
        "values, so connector secrets are not meaningfully protected at rest.",
      remedy: "Set INTEGRATION_SECRET_KEY to a 32+ character random string (`openssl rand -hex 32`).",
    });
  } else if (has("INTEGRATION_SECRET_KEY") && (process.env.INTEGRATION_SECRET_KEY ?? "").trim().length < 16) {
    findings.push({
      key: "INTEGRATION_SECRET_KEY",
      severity: "warning",
      impact: "The encryption key is shorter than 16 characters and is brute-forceable.",
      remedy: "Replace it with at least 32 random characters.",
    });
  }
  if (!has("AUTH_SECRET") || (process.env.AUTH_SECRET ?? "").trim().length < 16) {
    findings.push({
      key: "AUTH_SECRET",
      severity: "blocker",
      impact: "Calendar (ICS) invite links fall back to a per-process secret and break after every restart.",
      remedy: "Set AUTH_SECRET to a long random string (>= 16 characters).",
    });
  }

  // ── Scheduled work ──────────────────────────────────────────────────────
  // On a serverless host the in-process schedulers are deliberately not started,
  // so the cron route is the ONLY thing that drives automation, reminders and
  // webhook retries. Unset CRON_SECRET makes that route fail closed — the jobs
  // simply never run, which is invisible without this check.
  if (serverless && !has("CRON_SECRET")) {
    findings.push({
      key: "CRON_SECRET",
      severity: "blocker",
      impact:
        "Scheduled work never runs: automation dispatch, reminder sweeps and webhook retries all stop " +
        "(the cron route fails closed without this secret).",
      remedy: "Set CRON_SECRET, and make sure vercel.json's cron path sends it as a bearer token.",
    });
  }

  // ── Blob storage ────────────────────────────────────────────────────────
  if (storageDriver === "s3") {
    for (const key of ["AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const) {
      if (!has(key)) {
        findings.push({
          key,
          severity: "blocker",
          impact: "Document upload and retrieval throw 'S3 storage is not configured'.",
          remedy: `Set ${key} for your S3-compatible storage provider.`,
        });
      }
    }
  } else if (storageDriver === "vercel") {
    for (const key of ["BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN"] as const) {
      if (!has(key)) {
        findings.push({
          key,
          severity: "blocker",
          impact: "Document upload and retrieval throw 'Vercel Blob storage is not configured'.",
          remedy: `Set ${key} from your Vercel project's Blob storage settings.`,
        });
      }
    }
  } else if (storageDriver === "local" && serverless) {
    findings.push({
      key: "STORAGE_DRIVER",
      severity: "blocker",
      impact: "Uploads are accepted and then discarded — the serverless filesystem does not persist.",
      remedy: "Set STORAGE_DRIVER=vercel (with BLOB_READ_WRITE_TOKEN and BLOB_STORE_ID).",
    });
  } else if (!KNOWN_STORAGE_DRIVERS.includes(storageDriver)) {
    // An unrecognised name used to match no branch here, so a typo'd or
    // placeholder STORAGE_DRIVER produced NO finding: every vault read and write
    // threw `Unknown storage driver`, yet readiness still reported "ready" —
    // the one failure mode this report exists to catch.
    findings.push({
      key: "STORAGE_DRIVER",
      severity: "blocker",
      impact: "The configured storage driver is not one this build implements, so every document upload, letter render and recording save fails.",
      remedy: `Set STORAGE_DRIVER to one of: ${KNOWN_STORAGE_DRIVERS.join(", ")}.`,
    });
  }

  // ── Internal call origin ────────────────────────────────────────────────
  // Background work calls the app's own API. Loopback is the fallback and does
  // not exist on a serverless host, so every such call fails silently.
  if (serverless && !has("APP_INTERNAL_BASE") && !has("VERCEL_URL")) {
    findings.push({
      key: "APP_INTERNAL_BASE",
      severity: "warning",
      impact: "Background tasks fall back to http://127.0.0.1:3000, which does not exist on a serverless host.",
      remedy: "Set APP_INTERNAL_BASE to the deployment's own origin.",
    });
  }

  // ── Web push (optional, but half-configured is a trap) ──────────────────
  const vapidPrivate = has("VAPID_PRIVATE_KEY");
  const vapidPublic = has("VAPID_PUBLIC_KEY") || has("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  if (vapidPrivate !== vapidPublic) {
    findings.push({
      key: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY",
      severity: "warning",
      impact: "Push is half-configured: sendPush() throws when both halves are not present.",
      remedy: "Set both keys, or neither (push is then simply disabled).",
    });
  }

  const blockers = findings.filter((f) => f.severity === "blocker").length;
  return {
    host: host(),
    serverless,
    storageDriver,
    readiness: blockers > 0 ? "not-ready" : findings.length > 0 ? "degraded" : "ready",
    findings,
  };
}

/**
 * Log the deployment report once. Called from the instrumentation hook.
 * Deliberately non-fatal — see the module note.
 */
export function assertProductionReady(): DeploymentReport {
  const report = deploymentReport();
  if (report.readiness === "ready") return report;

  const label = report.readiness === "not-ready" ? "NOT READY" : "DEGRADED";
  console.error(`[deployment] ${label} on ${report.host} (storage=${report.storageDriver})`);
  for (const f of report.findings) {
    console.error(`[deployment] ${f.severity.toUpperCase()} ${f.key}: ${f.impact} → ${f.remedy}`);
  }
  return report;
}
