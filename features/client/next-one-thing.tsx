"use client";

/**
 * Next-One-Thing hero card — the client's single most pressing open item.
 *
 * Ranking lives in the pure domain module (`@/lib/domain/next-one-thing`);
 * this component only fetches open RFI threads, derives booking gaps from
 * props, and renders the deep-link CTA the ranking returns. The CTA
 * navigates through `onNavigate` so the portal owns tab + scroll behaviour.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileUp,
  MessageCircleQuestion,
} from "lucide-react";
import { get } from "@/lib/api-client";
import { slaOverdueHours, type RfiThread } from "@/lib/domain/rfi";
import {
  rankNextOneThing,
  type NextBookingGap,
  type NextDocRequest,
  type NextOneThingKind,
} from "@/lib/domain/next-one-thing";
import { Button } from "@/components/ui/button";

export type NextThingTab = "overview" | "messages";

const KIND_ICON: Record<NextOneThingKind, typeof FileUp> = {
  RFI: MessageCircleQuestion,
  DOCUMENT: FileUp,
  BOOKING: CalendarClock,
  ALL_CLEAR: CheckCircle2,
};

export function NextOneThingCard({
  caseId,
  requests,
  gaps,
  onNavigate,
}: {
  caseId: string;
  requests: NextDocRequest[];
  gaps: NextBookingGap[];
  onNavigate: (tab: NextThingTab, anchor: string) => void;
}) {
  const [threads, setThreads] = useState<RfiThread[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await get<{ threads: RfiThread[] }>(
          "/api/cases/" + caseId + "/rfi"
        );
        if (alive) setThreads(res.threads);
      } catch {
        if (alive) setThreads([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [caseId]);

  const next = useMemo(() => {
    const now = new Date();
    return rankNextOneThing(
      {
        rfis: threads.map((t) => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          slaDueAt: t.slaDueAt,
          overdueHours: slaOverdueHours(t, now),
        })),
        requests,
        gaps,
      },
      now
    );
  }, [threads, requests, gaps]);

  const Icon = KIND_ICON[next.kind];

  function handleCta() {
    if (next.kind === "RFI") onNavigate("messages", "rfi-threads");
    else if (next.kind === "DOCUMENT")
      onNavigate("overview", "requested-documents");
    else if (next.kind === "BOOKING")
      onNavigate("messages", "clx-panel-messages");
    else onNavigate("overview", "clx-progress");
  }

  return (
    <section
      aria-label="Next one thing"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-none border border-gold/50 bg-gold/[0.07] p-5 md:p-6"
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold/20 text-gold-ink"
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
          Next one thing
        </p>
        <p className="mt-0.5 truncate font-medium text-cobble-ink">
          {next.title}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{next.reason}</p>
      </div>
      <Button size="sm" onClick={handleCta} className="shrink-0">
        {next.cta.label}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </section>
  );
}
