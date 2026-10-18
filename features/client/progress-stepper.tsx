"use client";

/**
 * ProgressStepper — evidence-driven, 5-stage application progress.
 *
 * Stage mapping is derived honestly from the REAL case state machine
 * (prisma/schema.prisma + src/lib/domain/states.ts CASE_STATES):
 *
 *   1 Profile   — ONBOARDING, DATA_SUBMITTED, DATA_APPROVED, SERVICE_SELECTED, SERVICE_APPROVED
 *   2 Documents — DOCS_REQUESTED
 *   3 Review    — IN_PROGRESS (dossier being prepared / reviewed for the authority)
 *   4 Authority — DISPATCHED, FOLLOW_UP
 *   5 Decision  — APPROVED_IN_PRINCIPLE, COMPLETED
 *
 * A stage is only ever rendered complete when the case status genuinely
 * supports it. For cancelled cases the furthest stage actually reached
 * (from the real status history) is shown, with nothing marked done beyond
 * the evidence.
 */

import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/brand/ui";

export type StageInfo = {
  /** Stage the case is currently in (1–5). */
  current: number;
  /** All stages ≤ this number are genuinely completed. */
  completedUpTo: number;
};

const STAGES = [1, 2, 3, 4, 5] as const;

const STATUS_STAGE: Record<string, number> = {
  ONBOARDING: 1,
  DATA_SUBMITTED: 1,
  DATA_APPROVED: 1,
  SERVICE_SELECTED: 1,
  SERVICE_APPROVED: 1,
  DOCS_REQUESTED: 2,
  IN_PROGRESS: 3,
  DISPATCHED: 4,
  FOLLOW_UP: 4,
  APPROVED_IN_PRINCIPLE: 5,
  COMPLETED: 5,
};

type TimelineLike = ReadonlyArray<{ from: string | null; to: string }>;

export function stageInfoFor(
  status: string,
  timeline: TimelineLike,
  openRequests: number
): StageInfo {
  if (status === "CANCELLED") {
    // Evidence-driven: derive the furthest stage the case actually reached.
    const seen = [
      status,
      ...timeline.flatMap((t) => [t.from, t.to] as const),
    ].filter((s): s is string => typeof s === "string");
    const furthest = seen.reduce(
      (max, s) => Math.max(max, STATUS_STAGE[s] ?? 1),
      1
    );
    return { current: furthest, completedUpTo: Math.max(0, furthest - 1) };
  }

  if (status === "COMPLETED") return { current: 5, completedUpTo: 5 };
  if (status === "APPROVED_IN_PRINCIPLE")
    return { current: 5, completedUpTo: 4 };

  const stage = STATUS_STAGE[status] ?? 1;
  // IN_PROGRESS with open requests means the document stage is still live —
  // don't advertise "Review" until the requested documents have landed.
  if (stage === 3 && openRequests > 0) return { current: 2, completedUpTo: 1 };
  return { current: stage, completedUpTo: Math.max(0, stage - 1) };
}

export function ProgressStepper({
  info,
  className,
  onStageClick,
}: {
  info: StageInfo;
  className?: string;
  onStageClick?: (stage: number) => void;
}) {
  const { t } = useI18n();
  const labels = [
    t("clx.stageProfile"),
    t("clx.stageDocuments"),
    t("clx.stageReview"),
    t("clx.stageAuthority"),
    t("clx.stageDecision"),
  ];

  return (
    <section
      aria-label={t("clx.progressEyebrow")}
      className={cn(
        "rounded-md border border-border bg-card p-4 md:p-6",
        className
      )}
    >
      <Eyebrow>{t("clx.progressEyebrow")}</Eyebrow>
      <ol className="mt-4 flex items-start">
        {STAGES.map((stage, i) => {
          const done = stage <= info.completedUpTo;
          const active = !done && stage === info.current;
          return (
            <li
              key={stage}
              aria-current={active ? "step" : undefined}
              className="relative flex flex-1 flex-col items-center text-center"
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[-50%] top-4 h-px w-full",
                    stage - 1 <= info.completedUpTo ? "bg-gold" : "bg-border"
                  )}
                />
              )}
              {done && onStageClick ? (
                <button
                  type="button"
                  onClick={() => onStageClick(stage)}
                  title={`${labels[i]} — done, review`}
                  aria-label={`${labels[i]} — done, review`}
                  className={cn(
                    "relative z-10 flex h-8 min-h-8 w-8 min-w-8 items-center justify-center rounded-full border text-[11px] font-semibold hover:ring-2 hover:ring-gold/50",
                    "border-gold bg-gold text-cobble-ink"
                  )}
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <span
                  aria-hidden="true"
                  title={labels[i]}
                  className={cn(
                    "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-semibold",
                    done && "border-gold bg-gold text-cobble-ink",
                    active &&
                      "border-cobble bg-cobble text-[#F5F1EA] ring-4 ring-gold/25",
                    !done &&
                      !active &&
                      "border-border bg-card text-muted-foreground"
                  )}
                >
                  {done ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    stage
                  )}
                </span>
              )}
              <span
                className={cn(
                  "mt-2 text-[9px] uppercase leading-tight tracking-[0.06em] sm:text-[10px] sm:tracking-[0.14em]",
                  active
                    ? "font-semibold text-cobble-ink"
                    : done
                    ? "text-iron-ink"
                    : "text-muted-foreground"
                )}
              >
                {labels[i]}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
