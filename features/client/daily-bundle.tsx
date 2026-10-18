"use client";

/**
 * DailyBundleCard — FS-11: at most one bundled update per day.
 *
 * Collapses a day of case activity into a single digest — progress percentage,
 * what's new (newest first, honestly truncated), what's due next and the
 * unread count — so the client gets one calm update instead of a notification
 * per event. The per-event fan-out still exists for staff; this is the client
 * read-side contract.
 */

import { format } from "date-fns";
import { CalendarClock, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { DailyBundle } from "@/features/rm/crm-projections";

const TONE_DOT: Record<string, string> = {
  gold: "bg-gold",
  red: "bg-destructive",
  green: "bg-olive",
  blue: "bg-sky",
  neutral: "bg-muted-foreground/40",
};

export function DailyBundleCard({ bundle, className }: { bundle: DailyBundle; className?: string }) {
  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">Today&apos;s update</CardTitle>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-4 w-4" aria-hidden />
            {bundle.date}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Progress value={bundle.progressPct} className="h-2 flex-1" aria-label={`Case progress ${bundle.progressPct} percent`} />
          <span className="text-sm font-semibold tabular-nums text-cobble-ink">{bundle.progressPct}%</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {bundle.whatsNew.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Inbox className="h-4 w-4" aria-hidden />
            No changes today — your case is exactly where you left it.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {bundle.whatsNew.map((item, i) => (
              <li key={`${item.timestamp}-${i}`} className="flex items-start gap-2.5">
                <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE_DOT[item.tone] ?? TONE_DOT.neutral)} />
                <div className="min-w-0">
                  <p className="text-sm text-cobble-ink">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.caseRef !== "—" ? `${item.caseRef} · ` : ""}
                    {format(new Date(item.timestamp), "HH:mm")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {bundle.truncated && (
          <p className="text-xs text-muted-foreground">Showing the latest {bundle.whatsNew.length} — the full history is on your timeline.</p>
        )}
        {bundle.dueNext.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Due next</p>
            <ul className="mt-1.5 space-y-1">
              {bundle.dueNext.map((task) => (
                <li key={task} className="text-sm text-iron-ink">· {task}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          One bundled update per day
          {bundle.unreadCount > 0 ? ` · ${bundle.unreadCount} unread` : ""} · progress and history stay available any time.
        </p>
      </CardContent>
    </Card>
  );
}
