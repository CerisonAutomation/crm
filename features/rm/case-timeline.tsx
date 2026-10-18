"use client";

/**
 * CaseTimeline — the audit-linked unified feed for one case.
 *
 * Renders CaseTimelineEvent rows (see crm-projections.ts) with the full
 * projection contract visible: actor + role, source, timestamp,
 * correlationId and the recorded state transition. Rows carrying an
 * auditEventId show an "audit-linked" badge — the feed and the audit trail
 * converge here instead of living in two places. Staff-only rows are withheld
 * from CLIENT / PARTNER viewers (field-level visibility, enforced again on
 * the server — this is a display rule, not the access control).
 */

import { useState } from "react";
import { format } from "date-fns";
import { ArrowRight, Fingerprint, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CaseTimelineEvent,
  TimelineTone,
  ViewerRole,
} from "@/features/rm/crm-projections";

const TONE_DOT: Record<TimelineTone, string> = {
  gold: "bg-gold",
  red: "bg-destructive",
  green: "bg-olive",
  blue: "bg-sky",
  neutral: "bg-muted-foreground/40",
};

function AuditBadge({ auditEventId }: { auditEventId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={auditEventId}
      aria-label={copied ? "Audit id copied" : `Copy audit id ${auditEventId}`}
      onClick={() => {
        void navigator.clipboard?.writeText(auditEventId).then(
          () => setCopied(true),
          () => undefined
        );
        window.setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex min-h-6 min-w-6 items-center gap-1 rounded font-medium text-olive-ink hover:underline"
    >
      <ShieldCheck className="h-3 w-3" aria-hidden />
      {copied ? "copied" : "audit-linked"}
    </button>
  );
}

function shortCorrelation(id: string | null): string | null {
  if (!id) return null;
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export function CaseTimeline({
  events,
  viewerRole = "RM",
  className,
}: {
  events: CaseTimelineEvent[];
  viewerRole?: ViewerRole;
  className?: string;
}) {
  const external = viewerRole === "CLIENT" || viewerRole === "PARTNER";
  const visible = external
    ? events.filter((e) => e.visibility !== "staff")
    : events;

  if (visible.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-border bg-card p-6 text-center",
          className
        )}
      >
        <p className="text-sm text-muted-foreground">
          No timeline entries yet — activity will appear here as it happens.
        </p>
      </div>
    );
  }

  return (
    <ol
      className={cn(
        "relative space-y-0 border-l-2 border-border pl-0",
        className
      )}
      aria-label="Case timeline"
    >
      {visible.map((event) => (
        <li key={event.id} className="relative pb-5 pl-6 last:pb-0">
          <span
            aria-hidden
            className={cn(
              "absolute -left-[7px] top-1 h-3 w-3 rounded-full ring-2 ring-background",
              TONE_DOT[event.tone]
            )}
          />
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-sm font-medium text-cobble-ink">
              {event.displayTitle}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {event.actor.label}
              {event.actor.role ? ` · ${event.actor.role}` : ""}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide">
              {event.source}
            </span>
            <time dateTime={event.timestamp}>
              {format(new Date(event.timestamp), "d MMM yyyy, HH:mm")}
            </time>
            {event.transition && (
              <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                {event.transition.from ?? "∅"}
                <ArrowRight className="h-3 w-3" aria-hidden />
                {event.transition.to}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
            {event.correlationId && (
              <span
                className="inline-flex items-center gap-1 font-mono"
                title={event.correlationId}
              >
                <Fingerprint className="h-3 w-3" aria-hidden />
                {shortCorrelation(event.correlationId)}
              </span>
            )}
            {event.auditEventId && (
              <AuditBadge auditEventId={event.auditEventId} />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
