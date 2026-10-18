// DASH — DORA metrics core (Prisma-free, pure, import anywhere).
//
// Four keys, computed from deploys + incidents operators already record:
// deployment frequency, change lead time, change-fail rate, restore time.
// Bands follow the DORA research program (elite/high/medium/low); inputs are
// plain arrays so the dashboard, the audit-bundle export, and tests share one
// implementation. Empty input fails closed with nulls, never vacuous-elite.

export type FrequencyBand = "elite" | "high" | "medium" | "low";

export type DoraStats = {
  deploys: number;
  perDay: number | null;
  frequencyBand: FrequencyBand | null;
  leadTimeMedianHours: number | null;
  leadTimeP90Hours: number | null;
  changeFailRate: number | null;
  restoreMedianHours: number | null;
};

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return (
    sorted[base] + rest * ((sorted[base + 1] ?? sorted[base]) - sorted[base])
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  return quantile(
    [...values].sort((a, b) => a - b),
    0.5
  );
}

function p90(values: number[]): number | null {
  if (values.length === 0) return null;
  return quantile(
    [...values].sort((a, b) => a - b),
    0.9
  );
}

export function frequencyBand(perDay: number): FrequencyBand {
  if (perDay >= 1) return "elite"; // on-demand / daily+
  if (perDay >= 1 / 7) return "high"; // weekly+
  if (perDay >= 1 / 30) return "medium"; // monthly+
  return "low";
}

export function doraStats(input: {
  /** Deploy timestamps (ms). */
  deploysMs: number[];
  /** Window the deploys are counted over (days, > 0). */
  windowDays: number;
  /** Commit-to-prod lead times (hours) per change. */
  leadTimeHours: number[];
  /** Failed deploys needing fix/rollback. */
  failedDeploys: number;
  /** Restore times for failed deploys (hours). */
  restoreHours: number[];
}): DoraStats {
  const deploys = input.deploysMs.length;
  const perDay = input.windowDays > 0 ? deploys / input.windowDays : null;
  const failed = Math.min(input.failedDeploys, deploys);
  return {
    deploys,
    perDay,
    frequencyBand: perDay === null ? null : frequencyBand(perDay),
    leadTimeMedianHours: median(input.leadTimeHours),
    leadTimeP90Hours: p90(input.leadTimeHours),
    changeFailRate: deploys === 0 ? null : failed / deploys,
    restoreMedianHours: median(input.restoreHours),
  };
}
