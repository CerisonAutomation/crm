/**
 * SLA breach-forecast strip - pure domain (Hexagonal, Prisma-free).
 *
 * The strip answers one question per clock: how close is it to breach?
 * Remaining time is exactly `deadlineAt - now - pauseAccrualMs` - the
 * deadline the service stores, minus now, minus paused time banked but not
 * yet shifted into the deadline (see resumeSLA: deadline shifts forward by
 * the paused span on resume; while paused the accrual is carried here so the
 * forecast stays honest).
 *
 * No DB, no Date.now() inside the band function (now is injected), no
 * framework imports - safe to call from any render or test.
 */

/** Forecast band for one clock. DUE_SOON is the amber chip. */
export type SlaRiskBand =
  | "BREACHED"
  | "DUE_SOON"
  | "ON_TRACK"
  | "PAUSED"
  | "CLOSED";

/** Minimal clock view the strip needs - project any SLAClock into this. */
export interface ForecastClockInput {
  id: string;
  name?: string | null;
  /** Stored deadline (already shifted by past pauses on resume). */
  deadlineAt: Date | string | number;
  /** Raw service status: ACTIVE | PAUSED | MET | BREACHED | ... */
  status?: string | null;
  /**
   * Paused time banked but not yet shifted into deadlineAt (>= 0).
   * Non-finite / negative values are treated as 0.
   */
  pauseAccrualMs?: number | null;
}

/** Amber window: clocks breaching within 48h are DUE_SOON. */
export const DUE_SOON_WINDOW_MS = 48 * 3_600_000;

function toTime(v: Date | string | number): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return new Date(v).getTime();
}

function accrualMs(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Pure remaining time: deadlineAt minus now minus pauseAccrualMs.
 * Negative means already past the (accrual-adjusted) deadline.
 */
export function remainingMs(
  clock: ForecastClockInput,
  now: Date | number = new Date()
): number {
  const nowMs = now instanceof Date ? now.getTime() : now;
  return toTime(clock.deadlineAt) - nowMs - accrualMs(clock.pauseAccrualMs);
}

const CLOSED_STATUSES: ReadonlySet<string> = new Set([
  "MET",
  "COMPLETED",
  "CANCELLED",
]);

/**
 * Pure risk band. Status gates first (a PAUSED clock is frozen, a MET /
 * COMPLETED / CANCELLED clock is closed), then the remaining-time rule.
 * A stored BREACHED status always reports BREACHED.
 */
export function riskBand(
  clock: ForecastClockInput,
  now: Date | number = new Date()
): SlaRiskBand {
  const status = (clock.status ?? "ACTIVE").toUpperCase();
  if (status === "PAUSED") return "PAUSED";
  if (status === "BREACHED") return "BREACHED";
  if (CLOSED_STATUSES.has(status)) return "CLOSED";
  const left = remainingMs(clock, now);
  if (!Number.isFinite(left)) return "ON_TRACK";
  if (left <= 0) return "BREACHED";
  if (left <= DUE_SOON_WINDOW_MS) return "DUE_SOON";
  return "ON_TRACK";
}

/** Amber-chip descriptor for a band - the strip renders tone, not raw text. */
export interface RiskChip {
  band: SlaRiskBand;
  label: string;
  /** red = breached, amber = due soon, green = on track, grey = frozen/closed. */
  tone: "red" | "amber" | "green" | "grey";
}

export function chipForBand(band: SlaRiskBand): RiskChip {
  switch (band) {
    case "BREACHED":
      return { band, label: "Breaching", tone: "red" };
    case "DUE_SOON":
      return { band, label: "Due soon", tone: "amber" };
    case "PAUSED":
      return { band, label: "Paused", tone: "grey" };
    case "CLOSED":
      return { band, label: "Closed", tone: "grey" };
    default:
      return { band: "ON_TRACK", label: "On track", tone: "green" };
  }
}

export interface ClockFilter {
  /** Keep only these bands (omitted/empty = all bands). */
  bands?: readonly SlaRiskBand[] | null;
  /** Case-insensitive substring over id + name. */
  query?: string | null;
}

/**
 * Pure clocks filter for the strip (band subset + text query).
 * Never mutates the input array.
 */
export function filterForecastClocks<T extends ForecastClockInput>(
  clocks: readonly T[],
  filter: ClockFilter = {},
  now: Date | number = new Date()
): T[] {
  const bands =
    filter.bands && filter.bands.length > 0 ? new Set(filter.bands) : null;
  const q = (filter.query ?? "").trim().toLowerCase();
  return clocks.filter((c) => {
    if (bands && !bands.has(riskBand(c, now))) return false;
    if (q) {
      const hay = String(c.id) + " " + String(c.name ?? "");
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

/** One-tap strip presets. NEEDS_ATTENTION = BREACHED + DUE_SOON. */
export type ForecastQuickFilter =
  | "ALL"
  | "NEEDS_ATTENTION"
  | "BREACHED"
  | "DUE_SOON";

export function applyQuickFilter<T extends ForecastClockInput>(
  clocks: readonly T[],
  quick: ForecastQuickFilter,
  now: Date | number = new Date()
): T[] {
  switch (quick) {
    case "NEEDS_ATTENTION":
      return filterForecastClocks(
        clocks,
        { bands: ["BREACHED", "DUE_SOON"] },
        now
      );
    case "BREACHED":
      return filterForecastClocks(clocks, { bands: ["BREACHED"] }, now);
    case "DUE_SOON":
      return filterForecastClocks(clocks, { bands: ["DUE_SOON"] }, now);
    default:
      return [...clocks];
  }
}
