"use client";
/**
 * Admin quick actions — six one-tap tiles for the most common admin flows,
 * rendered on the admin dashboard. Tile hints are derived from the platform
 * stats the dashboard already loads (never fabricated); navigation mirrors the
 * console's established setView pattern.
 */
import { useApp, type View } from "@/lib/store";
import { useI18n, type StringKey } from "@/lib/i18n";
import { Eyebrow } from "@/components/brand/ui";
import { Card } from "@/components/ui/card";
import {
  Globe, LayoutDashboard, ScrollText, UserPlus, Webhook, Workflow, type LucideIcon,
} from "lucide-react";

/** Numbers surfaced in tile hints — all from the dashboard's real adminStats payload. */
export type QuickActionStats = {
  users: number;
  activeCases: number;
  auditEvents: number;
  publishedPages: number;
  publishedWorkflows: number;
  draftWorkflows: number;
};

type QuickTile = {
  view: View;
  labelKey: StringKey;
  icon: LucideIcon;
  hint: (s: QuickActionStats) => string;
};

const TILES: QuickTile[] = [
  {
    view: "studio-workflows",
    labelKey: "admq.qWorkflow",
    icon: Workflow,
    hint: (s) =>
      s.publishedWorkflows + s.draftWorkflows === 0
        ? "No workflows yet — author the first in the studio"
        : `${s.publishedWorkflows} published · ${s.draftWorkflows} in draft`,
  },
  {
    view: "admin-users",
    labelKey: "admq.qUser",
    icon: UserPlus,
    hint: (s) => `${s.users} ${s.users === 1 ? "user" : "users"} · roles, sessions, status`,
  },
  {
    view: "pages-list",
    labelKey: "admq.qPage",
    icon: Globe,
    hint: (s) =>
      s.publishedPages === 0
        ? "No published pages yet — open the builder"
        : `${s.publishedPages} published ${s.publishedPages === 1 ? "page" : "pages"} · drafts in the builder`,
  },
  {
    view: "admin-automation",
    labelKey: "admq.qWebhook",
    icon: Webhook,
    // adminSub (Automation vs Integrations panel) lives in app-shell.tsx local
    // state — the sidebar's navigate() is its only writer. setView is the
    // console's established navigation primitive (dashboard QUICK_LINKS and
    // settings-view navigate to admin-automation the same way); the Automation
    // panel is this view's default sub.
    hint: () => "event bus, connectors & signed webhooks",
  },
  {
    view: "admin-audit",
    labelKey: "admq.qAudit",
    icon: ScrollText,
    hint: (s) => `${s.auditEvents} ${s.auditEvents === 1 ? "event" : "events"} · append-only trail`,
  },
  {
    view: "rm-queue",
    labelKey: "admq.qQueue",
    icon: LayoutDashboard,
    hint: (s) => `${s.activeCases} active ${s.activeCases === 1 ? "case" : "cases"} · RM desk`,
  },
];

export function QuickActions({ stats }: { stats: QuickActionStats }) {
  const setView = useApp((s) => s.setView);
  const { t } = useI18n();

  return (
    <Card className="gap-0 rounded-md border-border p-6">
      <Eyebrow>{t("admq.quick")}</Eyebrow>
      <h3 className="mt-1 font-editorial text-lg text-cobble-ink">Common tasks, one tap away</h3>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          const hint = tile.hint(stats);
          return (
            <button
              key={`${tile.view}-${tile.labelKey}`}
              type="button"
              onClick={() => setView(tile.view)}
              aria-label={`${t(tile.labelKey)} — ${hint}`}
              className="group flex min-h-[76px] flex-col items-start gap-2 rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-gold/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gold/40 bg-gold/10 transition-colors group-hover:bg-gold/20"
                aria-hidden="true"
              >
                <Icon className="h-4.5 w-4.5 text-gold-ink" />
              </span>
              <span className="w-full">
                <span className="block text-sm font-semibold text-cobble-ink">{t(tile.labelKey)}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
