// DASH — northstar metric core (Prisma-free, pure, import anywhere).
//
// Northstar: cases-to-submission days — median + p90 wall time from case
// creation to first authority submission, over submitted cases only.
// Unsubmitted cases count toward volume, never toward speed (counting them
// as zero would fake the number down; counting them as infinity would fake
// it up). Empty input fails closed: nulls, never vacuous-zero.
//
// Exportable: toCsv renders the same spans operators see in the dashboard so
// the number is auditable without third-party trackers (TEL annex).

export type CaseSpan = {
  caseId: string;
  createdAtMs: number;
  submittedAtMs: number | null;
};

export type NorthstarStats = {
  total: number;
  submitted: number;
  medianDays: number | null;
  p90Days: number | null;
};

const MS_PER_DAY = 86_400_000;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) throw new Error("offline: quantile of empty set");
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

export function northstarStats(spans: CaseSpan[]): NorthstarStats {
  const days = spans
    .filter((s) => s.submittedAtMs !== null && s.submittedAtMs >= s.createdAtMs)
    .map((s) => ((s.submittedAtMs as number) - s.createdAtMs) / MS_PER_DAY)
    .sort((a, b) => a - b);
  if (days.length === 0) {
    return {
      total: spans.length,
      submitted: 0,
      medianDays: null,
      p90Days: null,
    };
  }
  return {
    total: spans.length,
    submitted: days.length,
    medianDays: quantile(days, 0.5),
    p90Days: quantile(days, 0.9),
  };
}

/** Auditable export — header + one row per case, days blank when unsubmitted. */
export function northstarCsv(spans: CaseSpan[]): string {
  const rows = ["caseId,createdAt,submittedAt,daysToSubmission"];
  for (const s of spans) {
    const days =
      s.submittedAtMs !== null && s.submittedAtMs >= s.createdAtMs
        ? ((s.submittedAtMs - s.createdAtMs) / MS_PER_DAY).toFixed(2)
        : "";
    rows.push(
      `${s.caseId},${new Date(s.createdAtMs).toISOString()},${
        s.submittedAtMs !== null ? new Date(s.submittedAtMs).toISOString() : ""
      },${days}`
    );
  }
  return rows.join("\n");
}
