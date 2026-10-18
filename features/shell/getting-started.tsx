"use client";
/**
 * Getting-started checklist — a dismissible card rendered by AppShell above the
 * role's home view (CLIENT → client-dashboard, RM/SENIOR_RM → rm-queue,
 * ADMIN → admin-dashboard). Every step's done state is computed from real
 * platform data (the same APIs those consoles already use) — no hardcoded
 * progress. Hidden entirely when dismissed or when every step is done.
 *
 * i18n note: the gs.*S1d/S2d strings carry a literal "{n}" placeholder that the
 * dictionary fill() (which expects {{var}}) deliberately leaves untouched — we
 * interpolate it here so the dictionaries stay untouched.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import { api, currentSessionToken } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Eyebrow } from "@/components/brand/ui";
import {
  CircleCheckBig, Circle, X, UserRound, FileUp, MessageCircle,
  FileSearch, MessageSquareReply, ArrowRightCircle, Workflow, UserPlus, Webhook,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type GettingStartedRole = "CLIENT" | "RM" | "ADMIN";

export type GettingStartedProps = {
  role: GettingStartedRole;
  /**
   * Match the checklist to the width of the view it sits above. The client
   * surfaces render in a narrow editorial column (`max-w-2xl`, client-portal's
   * PageWrap); the RM and admin consoles render full-bleed. Defaulting to the
   * wide console frame kept the client checklist full-width directly above a
   * narrow case dashboard, so the two cards' edges never lined up.
   */
  width?: "wide" | "content";
  /** Mirrors the shell's navigate() for the shared admin-automation view. */
  onOpenAdminAutomation: (sub: "automation" | "integrations") => void;
};

type Step = {
  id: string;
  icon: ReactNode;
  title: string;
  desc: string;
  done: boolean;
  go: () => void;
};

const dismissKey = (role: GettingStartedRole) => `cl-gs-dismissed-${role}`;

/** Dictionary values use the literal "{n}" — interpolate locally. */
const withN = (template: string, n: number) => template.replace("{n}", String(n));

/** Case statuses that mean an RM (or the workflow engine) advanced the case past intake. */
const ADVANCED_CASE_STATES = new Set([
  "DATA_APPROVED", "SERVICE_APPROVED", "DOCS_REQUESTED", "IN_PROGRESS",
  "DISPATCHED", "FOLLOW_UP", "APPROVED_IN_PRINCIPLE", "COMPLETED",
]);

export function GettingStarted({ role, width = "wide", onOpenAdminAutomation }: GettingStartedProps) {
  const { t } = useI18n();
  const setView = useApp((s) => s.setView);
  const setActiveCase = useApp((st) => st.setActiveCase);
  const session = useApp((s) => s.session);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    // Lazy init — this component only mounts client-side (session-gated), so a
    // direct localStorage read is safe and avoids a post-mount flash.
    try {
      if (typeof window === "undefined") return false;
      return window.localStorage.getItem(dismissKey(role)) === "1";
    } catch {
      return false;
    }
  });
  const [client, setClient] = useState<{ openRequests: number; sentMessages: boolean } | null>(null);
  const [rm, setRm] = useState<{ pendingDocs: number; advanced: boolean; pendingCaseId: string | null } | null>(null);
  const [admin, setAdmin] = useState<{ published: number; users: number; activeWebhooks: number | null } | null>(null);

  // Dismissal is per role: AppShell mounts this card only for one specific
  // role's home view, so the lazy initializer above is the single source —
  // no post-mount read needed (role never changes while mounted).

  useEffect(() => {
    let alive = true;
    (async () => {
      if (role === "CLIENT") {
        const { case: c } = await api.myCase().catch(() => ({ case: null }));
        if (!alive) return;
        const openRequests = c ? c.requests.filter((r) => r.status === "OPEN").length : 0;
        let sentMessages = false;
        if (c) {
          const m = await api.messages(c.id).catch(() => ({ messages: [] as Array<{ author: { role: string } }> }));
          if (!alive) return;
          sentMessages = m.messages.some((x) => x.author.role === "CLIENT");
        }
        setClient({ openRequests, sentMessages });
      } else if (role === "RM") {
        const res = await api.rmCases().catch(() => null);
        if (!alive) return;
        const rows = res?.cases ?? [];
        setRm({
          // Documents awaiting a decision = uploaded minus approved (queue payload).
          pendingDocs: rows.reduce((acc, r) => acc + Math.max(0, r.documentsTotal - r.documentsApproved), 0),
          /* The first case with anything unapproved, so the step below can OPEN
             that case. The old handler was `setView("rm-queue")` — and this card
             only mounts ON that view, so clicking it navigated to the page it was
             already on: a dead link on the one step whose whole job is "go review
             the documents waiting for you". */
          pendingCaseId: rows.find((r) => r.documentsTotal > r.documentsApproved)?.id ?? null,
          advanced: rows.some((r) => ADVANCED_CASE_STATES.has(r.status)),
        });
      } else {
              const [stats, usersRes, hooks] = await Promise.all([
                api.adminStats().catch(() => null),
                api.adminUsers().catch(() => null),
                api.webhookEndpoints().catch(() => null),
              ]);
              if (!alive) return;
              const endpoints = (hooks as { endpoints?: Array<{ active: boolean }> } | null)?.endpoints;
              setAdmin({
                published: (stats?.workflows ?? []).filter((w) => w.status === "PUBLISHED" && !w.disabled).length,
                users: usersRes?.users.length ?? 0,
                activeWebhooks: endpoints ? endpoints.filter((e) => e.active).length : null,
              });
            }
    })();
    return () => { alive = false; };
  }, [role]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey(role), "1");
    } catch { /* private mode — hide for this session only */ }
  }, [role]);

  if (dismissed) return null;

  const data = role === "CLIENT" ? client : role === "RM" ? rm : admin;
  if (!data) return null; // real counts only — no placeholder flash

  const profileComplete = Boolean(
    session?.firstName && session?.lastName && session?.dateOfBirth &&
    session?.nationality && session?.phone && session?.address &&
    session?.city && session?.country
  );

  const steps: Step[] = [];
  if (role === "CLIENT" && client) {
    steps.push(
      {
        id: "client-profile", icon: <UserRound className="h-4 w-4" aria-hidden="true" />,
        title: t("gs.clientS1"), desc: t("gs.clientS1d"), done: profileComplete,
        go: () => setView("client-onboarding"),
      },
      {
        id: "client-docs", icon: <FileUp className="h-4 w-4" aria-hidden="true" />,
        title: t("gs.clientS2"),
        desc: client.openRequests === 0 ? t("gs.clientS2done") : withN(t("gs.clientS2d"), client.openRequests),
        done: client.openRequests === 0,
        go: () => setView("client-dashboard"),
      },
      {
        id: "client-msg", icon: <MessageCircle className="h-4 w-4" aria-hidden="true" />,
        title: t("gs.clientS3"), desc: t("gs.clientS3d"), done: client.sentMessages,
        go: () => setView("client-dashboard"),
      },
    );
  } else if (role === "RM" && rm) {
    steps.push(
      {
        id: "rm-docs", icon: <FileSearch className="h-4 w-4" aria-hidden="true" />,
        title: t("gs.rmS1"), desc: withN(t("gs.rmS1d"), rm.pendingDocs), done: rm.pendingDocs === 0,
        go: () => (rm.pendingCaseId ? setActiveCase(rm.pendingCaseId!) : setView("rm-queue")),
      },
      {
        id: "rm-msg", icon: <MessageSquareReply className="h-4 w-4" aria-hidden="true" />,
        title: t("gs.rmS2"), desc: t("gs.rmS2d"), done: false, // message data is per-case — always navigable
        go: () => setView("rm-queue"),
      },
      {
        id: "rm-advance", icon: <ArrowRightCircle className="h-4 w-4" aria-hidden="true" />,
        title: t("gs.rmS3"), desc: t("gs.rmS3d"), done: rm.advanced,
        go: () => setView("rm-queue"),
      },
    );
  } else if (role === "ADMIN" && admin) {
    steps.push(
      {
        id: "admin-workflows", icon: <Workflow className="h-4 w-4" aria-hidden="true" />,
        title: t("gs.adminS1"), desc: t("gs.adminS1d"), done: admin.published > 0,
        go: () => setView("studio-workflows"),
      },
      {
        id: "admin-users", icon: <UserPlus className="h-4 w-4" aria-hidden="true" />,
        title: t("gs.adminS2"), desc: t("gs.adminS2d"), done: admin.users > 1,
        go: () => setView("admin-users"),
      },
      {
        id: "admin-automation", icon: <Webhook className="h-4 w-4" aria-hidden="true" />,
        title: t("gs.adminS3"), desc: t("gs.adminS3d"), done: (admin.activeWebhooks ?? 0) > 0,
        go: () => onOpenAdminAutomation("integrations"),
      },
    );
  }

  if (steps.length === 0 || steps.every((s) => s.done)) return null;

  const titleKey = role === "CLIENT" ? "gs.clientTitle" : role === "RM" ? "gs.rmTitle" : "gs.adminTitle";

  return (
    <div
      className={cn(
        "mx-auto w-full",
        // `content` mirrors client-portal's PageWrap (max-w-2xl, px-4/6) so the
        // checklist and the case dashboard share one column; `wide` is the
        // console frame the RM and admin dashboards use.
        width === "content" ? "max-w-2xl px-4 pt-8 md:px-6 md:pt-8" : "max-w-[1440px] px-5 pt-6 md:px-8 md:pt-8",
      )}
    >
      <section
        aria-label={t("gs.eyebrow")}
        className="relative rounded-lg border border-gold/40 bg-card p-4 shadow-sm md:p-6"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("gs.dismiss")}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-cobble-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <Eyebrow>{t("gs.eyebrow")}</Eyebrow>
        <h2 className="mt-1 font-editorial text-lg text-cobble-ink tracking-wide md:text-xl">{t(titleKey)}</h2>

        <ol className={cn("mt-4 grid min-w-0 gap-1", width === "wide" && "md:grid-cols-3 md:gap-3")}>
          {steps.map((s, i) => (
            <li key={s.id} className="min-w-0">
              <button
                type="button"
                onClick={s.done ? undefined : s.go}
                disabled={s.done}
                aria-label={s.title}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md border border-transparent px-3 py-3 text-left transition-colors min-h-11",
                  s.done ? "opacity-70" : "cursor-pointer hover:border-gold/40 hover:bg-gold/5"
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {s.done
                    ? <CircleCheckBig className="h-5 w-5 text-gold-ink" aria-hidden="true" />
                    : <Circle className="h-5 w-5 text-muted-foreground/40" aria-hidden="true" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold text-cobble-ink">
                    <span className="text-gold-ink">{s.icon}</span>
                    <span className="truncate">{s.title}</span>
                    <span className="text-[10px] font-normal uppercase tracking-[0.18em] text-muted-foreground/70">
                      {i + 1}/{steps.length}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{s.desc}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
