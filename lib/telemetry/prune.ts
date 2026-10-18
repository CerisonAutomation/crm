/**
 * Telemetry retention — deletes product-telemetry rows older than the
 * retention window (default 14 days). Never throws: callers treat this as
 * best-effort housekeeping (ingest fires it probabilistically; the admin
 * panel exposes an on-demand "Prune now").
 */
import { db } from "@/lib/db";

export const TELEMETRY_RETENTION_DAYS = 14;

export async function pruneTelemetry(retainedDays: number = TELEMETRY_RETENTION_DAYS): Promise<number> {
  const days =
    Number.isFinite(retainedDays) && retainedDays > 0
      ? Math.min(365, Math.floor(retainedDays))
      : TELEMETRY_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 86400000);
  const res = await db.telemetryEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}
