"use client";

/**
 * Page Shell — URL-synchronized shell with nuqs for shareable URLs.
 * Based on app-shell.tsx with view/adminPanel state moved to URL params.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useApp, defaultViewFor, type View } from "@/lib/store";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import {
  NAV,
  SECTION_ORDER,
  AUDIENCE_TAG_KEYS,
  ROLE_LABEL_KEYS,
  sectionHeading,
  isNavActive,
  isItemActive,
  canOpen,
  type AdminSub,
  type NavItem,
} from "@/lib/nav";
import { PassportSeal, Wordmark } from "@/components/brand/devices";
import { LocaleSwitcher } from "@/features/shell/locale-switcher";
import { BrandLoader, SandboxChip } from "@/components/brand/ui";
import { NotificationPrefsDialog } from "@/features/shell/notification-prefs-dialog";
import {
  CommandPalette,
  PaletteTriggerButton,
} from "@/features/shell/command-palette";
import { ViewBreadcrumb } from "@/features/shell/breadcrumb";
import { HelpDialog } from "@/features/shell/help-dialog";
import { ShortcutsDialog } from "@/features/shell/keyboard/shortcuts-dialog";
import { useKeyboardShortcuts } from "@/features/shell/keyboard/adapters/useKeyboardShortcuts";
import { GettingStarted } from "@/features/shell/getting-started";
import { CallCenter } from "@/features/calls/call-center";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Bell,
  BellRing,
  LogOut,
  SlidersHorizontal,
  CircleHelp,
  X,
  Sparkles,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  Keyboard,
} from "lucide-react";
import { VoiceControl } from "@/components/voice/voice-control";
import { PushToTalk } from "@/components/voice/push-to-talk";
import type { VoiceIntent } from "@/lib/ai/voice";
import { trackView } from "@/lib/telemetry/client";
import type { ChatWarmState } from "@/lib/ai/browser/warm";
import {
  applyPreferences,
  bindSystemTheme,
  readPreferences,
  setPreferences,
  usePreferences,
} from "@/lib/ui-mode";
import { surfaceForView } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useViewState, useAdminPanelState } from "@/lib/url-state";

/* Views load on demand — each console/builder is its own chunk. */
const viewLoading = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <BrandLoader size={112} />
  </div>
);

const AiConsole = dynamic(
  () => import("@/features/ai/ai-console").then((m) => m.AiConsole),
  { ssr: false, loading: () => null },
);

const ClientOnboarding = dynamic(
  () =>
    import("@/features/client/client-portal").then((m) => m.ClientOnboarding),
  { loading: viewLoading },
);
const ClientApply = dynamic(
  () => import("@/features/client/client-apply").then((m) => m.ClientApply),
  { loading: viewLoading },
);
const ClientDashboard = dynamic(
  () =>
    import("@/features/client/client-portal").then((m) => m.ClientDashboard),
  { loading: viewLoading },
);
const RmQueue = dynamic(
  () => import("@/features/rm/rm-console").then((m) => m.RmQueue),
  { loading: viewLoading },
);
const RmCaseDetail = dynamic(
  () => import("@/features/rm/rm-console").then((m) => m.RmCaseDetail),
  { loading: viewLoading },
);
const CrmWorkspace = dynamic(
  () => import("@/features/crm/crm-workspace").then((m) => m.CrmWorkspace),
  { loading: viewLoading },
);
const AccountsWorkspace = dynamic(
  () => import("@/features/crm/accounts-workspace").then((m) => m.AccountsWorkspace),
  { loading: viewLoading },
);
const PotentialsWorkspace = dynamic(
  () => import("@/features/crm/potentials-workspace").then((m) => m.PotentialsWorkspace),
  { loading: viewLoading },
);
const SalesOrdersWorkspace = dynamic(
  () => import("@/features/crm/sales-orders-workspace").then((m) => m.SalesOrdersWorkspace),
  { loading: viewLoading },
);
const ProductsWorkspace = dynamic(
  () => import("@/features/crm/products-workspace").then((m) => m.ProductsWorkspace),
  { loading: viewLoading },
);
const SettingsView = dynamic(
  () => import("@/features/settings/settings-view").then((m) => m.SettingsView),
  { loading: viewLoading },
);
const AdminDashboard = dynamic(
  () => import("@/features/admin/admin-console").then((m) => m.AdminDashboard),
  { loading: viewLoading },
);
const AdminUsers = dynamic(
  () => import("@/features/admin/admin-console").then((m) => m.AdminUsers),
  { loading: viewLoading },
);
const AdminOps = dynamic(
  () => import("@/features/admin/ops-panel").then((m) => m.AdminOps),
  { loading: viewLoading },
);
const AdminRecords = dynamic(
  () => import("@/features/admin/records-panel").then((m) => m.AdminRecords),
  { loading: viewLoading },
);
const AdminAudit = dynamic(
  () => import("@/features/admin/admin-console").then((m) => m.AdminAudit),
  { loading: viewLoading },
);
const AdminPieces = dynamic(
  () => import("@/features/admin/admin-console").then((m) => m.AdminPieces),
  { loading: viewLoading },
);
const AdminNotifications = dynamic(
  () =>
    import("@/features/admin/admin-console").then((m) => m.AdminNotifications),
  { loading: viewLoading },
);
const AdminFlags = dynamic(
  () => import("@/features/admin/admin-console").then((m) => m.AdminFlags),
  { loading: viewLoading },
);
const AdminProgrammes = dynamic(
  () => import("@/features/admin/admin-console").then((m) => m.AdminProgrammes),
  { loading: viewLoading },
);
const AdminTemplates = dynamic(
  () => import("@/features/admin/admin-console").then((m) => m.AdminTemplates),
  { loading: viewLoading },
);
const AdminNewsScan = dynamic(
  () => import("@/features/admin/news-scan-panel").then((m) => m.AdminNewsScan),
  { loading: viewLoading },
);
const AdminAutomation = dynamic(
  () => import("@/features/admin/admin-console").then((m) => m.AdminAutomation),
  { loading: viewLoading },
);
const AdminIntegrations = dynamic(
  () =>
    import("@/features/admin/admin-console").then((m) => m.AdminIntegrations),
  { loading: viewLoading },
);
const AdminBusiness = dynamic(
  () =>
    import("@/features/admin/business-settings").then((m) => m.AdminBusiness),
  { loading: viewLoading },
);
const AdminTelemetry = dynamic(
  () =>
    import("@/features/admin/telemetry-panel").then((m) => m.AdminTelemetry),
  { loading: viewLoading },
);
const AdminPlatformSettings = dynamic(
  () =>
    import("@/features/admin/platform-settings").then(
      (m) => m.AdminPlatformSettings,
    ),
  { loading: viewLoading },
);
const PartiesPanel = dynamic(
  () => import("@/features/admin/parties-panel").then((m) => m.PartiesPanel),
  { loading: viewLoading },
);
const DuplicatesPanel = dynamic(
  () =>
    import("@/features/admin/duplicates-panel").then((m) => m.DuplicatesPanel),
  { loading: viewLoading },
);
const MergeLedgerPanel = dynamic(
  () =>
    import("@/features/admin/merge-ledger-panel").then(
      (m) => m.MergeLedgerPanel,
    ),
  { loading: viewLoading },
);
const WorkItemsPanel = dynamic(
  () =>
    import("@/features/admin/work-items-panel").then((m) => m.WorkItemsPanel),
  { loading: viewLoading },
);
const KycChecksPanel = dynamic(
  () =>
    import("@/features/admin/kyc-checks-panel").then((m) => m.KycChecksPanel),
  { loading: viewLoading },
);
const QuotesPanel = dynamic(
  () => import("@/features/admin/quotes-panel").then((m) => m.QuotesPanel),
  { loading: viewLoading },
);
const RefundsPanel = dynamic(
  () => import("@/features/admin/refunds-panel").then((m) => m.RefundsPanel),
  { loading: viewLoading },
);
const HandoffsPanel = dynamic(
  () => import("@/features/admin/handoffs-panel").then((m) => m.HandoffsPanel),
  { loading: viewLoading },
);
const HumanTasksPanel = dynamic(
  () =>
    import("@/features/admin/human-tasks-panel").then((m) => m.HumanTasksPanel),
  { loading: viewLoading },
);
const ProviderReceiptsPanel = dynamic(
  () =>
    import("@/features/admin/provider-receipts-panel").then(
      (m) => m.ProviderReceiptsPanel,
    ),
  { loading: viewLoading },
);
const CitationsPanel = dynamic(
  () =>
    import("@/features/admin/citations-panel").then((m) => m.CitationsPanel),
  { loading: viewLoading },
);
const PromptsPanel = dynamic(
  () => import("@/features/admin/prompts-panel").then((m) => m.PromptsPanel),
  { loading: viewLoading },
);
const PollConnectionsPanel = dynamic(
  () =>
    import("@/features/admin/poll-connections-panel").then(
      (m) => m.PollConnectionsPanel,
    ),
  { loading: viewLoading },
);
const AvailabilityPanel = dynamic(
  () =>
    import("@/features/admin/availability-panel").then(
      (m) => m.AvailabilityPanel,
    ),
  { loading: viewLoading },
);
const VoicePanel = dynamic(
  () => import("@/features/admin/voice-panel").then((m) => m.VoicePanel),
  { loading: viewLoading },
);
const BusinessSettingsPanel = dynamic(
  () =>
    import("@/features/admin/business-settings-panel").then(
      (m) => m.BusinessSettingsPanel,
    ),
  { loading: viewLoading },
);
const FormSchemasPanel = dynamic(
  () =>
    import("@/features/admin/form-schemas-panel").then(
      (m) => m.FormSchemasPanel,
    ),
  { loading: viewLoading },
);
const AttachmentsPanel = dynamic(
  () =>
    import("@/features/admin/attachments-panel").then(
      (m) => m.AttachmentsPanel,
    ),
  { loading: viewLoading },
);
const McpPanel = dynamic(
  () => import("@/features/admin/mcp-panel").then((m) => m.McpPanel),
  { loading: viewLoading },
);
const BookingsPanel = dynamic(
  () => import("@/features/admin/bookings-panel").then((m) => m.BookingsPanel),
  { loading: viewLoading },
);
const RemindersPanel = dynamic(
  () =>
    import("@/features/admin/reminders-panel").then((m) => m.RemindersPanel),
  { loading: viewLoading },
);
const TriagePanel = dynamic(
  () => import("@/features/admin/triage-panel").then((m) => m.TriagePanel),
  { loading: viewLoading },
);
const OfflinePanel = dynamic(
  () => import("@/features/admin/offline-panel").then((m) => m.OfflinePanel),
  { loading: viewLoading },
);
const WebhookInboxPanel = dynamic(
  () =>
    import("@/features/admin/webhook-inbox-panel").then(
      (m) => m.WebhookInboxPanel,
    ),
  { loading: viewLoading },
);
const ConversationInboxPanel = dynamic(
  () =>
    import("@/features/admin/conversation-inbox-panel").then(
      (m) => m.ConversationInboxPanel,
    ),
  { loading: viewLoading },
);
const StudioWorkflows = dynamic(
  () =>
    import("@/features/studio/workflow-studio").then((m) => m.StudioWorkflows),
  { loading: viewLoading },
);
const StudioDetail = dynamic(
  () => import("@/features/studio/workflow-studio").then((m) => m.StudioDetail),
  { loading: viewLoading },
);
const StudioRuns = dynamic(
  () => import("@/features/studio/workflow-studio").then((m) => m.StudioRuns),
  { loading: viewLoading },
);
const PagesList = dynamic(
  () => import("@/features/pages/lane-pages").then((m) => m.PagesList),
  { loading: viewLoading },
);
const PagesEditor = dynamic(
  () => import("@/features/pages/lane-pages").then((m) => m.PagesEditor),
  { loading: viewLoading },
);
const TeamsView = dynamic(
  () => import("@/features/teams/teams-view").then((m) => m.TeamsView),
  { loading: viewLoading },
);
const ProcedureFlow = dynamic(
  () =>
    import("@/features/procedure/procedure-flow").then((m) => m.ProcedureFlow),
  { loading: viewLoading },
);

function currentTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: "dark" | "light") {
  setPreferences({ theme });
}

function applyScroll(direction: "top" | "bottom" | "up" | "down") {
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
  if (direction === "top") window.scrollTo({ top: 0, behavior });
  else if (direction === "bottom")
    window.scrollTo({ top: document.body.scrollHeight, behavior });
  else
    window.scrollBy({
      top: (direction === "down" ? 1 : -1) * window.innerHeight * 0.8,
      behavior,
    });
}

function isTabVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}

export function PageShell() {
  const { session, logout, activeCaseId } = useApp();
  const { view, setView } = useViewState();
  const { panel: adminPanel, setPanel: setAdminPanel } = useAdminPanelState();
  const { t, setLocale } = useI18n();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTab, setAiTab] = useState<"assistant" | "research">("assistant");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [teamsUnread, setTeamsUnread] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [chatWarm, setChatWarm] = useState<ChatWarmState>("idle");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [verifyDismissed, setVerifyDismissed] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const { mode } = usePreferences(session?.role ?? null);
  const simple = mode === "simple";

  const allowedViews = useMemo(
    () =>
      new Set(
        NAV.filter((n) => n.roles.includes(session?.role ?? "")).map(
          (n) => n.view,
        ),
      ),
    [session?.role],
  );

  const items = useMemo(() => {
    const roleItems = NAV.filter((n) => n.roles.includes(session?.role ?? ""));
    return simple && !showAllTools
      ? roleItems.filter((n) => n.essential)
      : roleItems;
  }, [session?.role, simple, showAllTools]);

  const hasHiddenTools = useMemo(() => {
    if (!simple || showAllTools) return false;
    return NAV.some(
      (n) => n.roles.includes(session?.role ?? "") && !n.essential,
    );
  }, [session?.role, simple, showAllTools]);

  const viewTitle = useMemo(() => {
    const match = items.find(
      (n) =>
        n.view === view &&
        (n.view !== "admin-automation" ||
          (n.sub ?? "automation") === adminPanel),
    );
    return match ? t(match.labelKey) : t("common.appName");
  }, [items, view, adminPanel, t]);

  useEffect(() => {
    document.title = `${viewTitle} · ${t("common.appName")}`;
  }, [viewTitle, t]);

  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current === view) return;
    prevView.current = view;
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [view]);

  const handleVoiceIntent = useCallback(
    (intent: VoiceIntent) => {
      switch (intent.kind) {
        case "navigate": {
          if (allowedViews.has(intent.view as View)) {
            if (intent.view === "admin-automation" && intent.sub)
              setAdminPanel(intent.sub);
            setView(intent.view as View);
          } else {
            toast({
              title: t("voice.notAllowed"),
              description: intent.label,
              variant: "destructive",
            });
          }
          break;
        }
        case "home": {
          if (session) setView(defaultViewFor(session));
          break;
        }
        case "open_ai": {
          setAiTab("assistant");
          setAiOpen(true);
          break;
        }
        case "run_research": {
          setAiTab("research");
          setAiOpen(true);
          break;
        }
        case "search": {
          if (allowedViews.has("rm-queue")) setView("rm-queue");
          else if (allowedViews.has("client-dashboard"))
            setView("client-dashboard");
          toast({ title: t("voice.searching"), description: intent.query });
          break;
        }
        case "help": {
          setHelpOpen(true);
          break;
        }
        case "open_palette": {
          setPaletteOpen(true);
          break;
        }
        case "open_notifications": {
          if (allowedViews.has("admin-notifications"))
            setView("admin-notifications");
          else window.dispatchEvent(new CustomEvent("cl:open-notifications"));
          break;
        }
        case "mark_all_read": {
          window.dispatchEvent(new CustomEvent("cl:mark-all-read"));
          break;
        }
        case "toggle_theme": {
          applyTheme(currentTheme() === "dark" ? "light" : "dark");
          break;
        }
        case "switch_locale": {
          setLocale(intent.locale);
          break;
        }
        case "scroll": {
          applyScroll(intent.direction);
          break;
        }
        case "go_back": {
          window.history.back();
          break;
        }
        case "close": {
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
          break;
        }
        case "logout": {
          void logout();
          break;
        }
        default:
          break;
      }
    },
    [allowedViews, session, setView, setAdminPanel, setLocale, t, logout],
  );

  useEffect(() => {
    applyPreferences(readPreferences());
    bindSystemTheme();
  }, []);

  useEffect(() => {
    let alive = true;
    let cancel: (() => void) | null = null;
    void import("@/lib/ai/browser/warm")
      .then((m) => {
        if (!alive) return;
        const handle = m.scheduleIdleChatWarm({
          onState: (s) => {
            if (alive) setChatWarm(s);
          },
        });
        cancel = handle.cancel;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      try {
        if (cancel) cancel();
      } catch {
        /* cancel never throws */
      }
    };
  }, []);

  useEffect(() => {
    const onOpenHelp = () => setHelpOpen(true);
    window.addEventListener("cl:open-help", onOpenHelp);
    return () => window.removeEventListener("cl:open-help", onOpenHelp);
  }, []);

  useEffect(() => {
    if (session) trackView(view, { role: session.role });
  }, [view, session]);

  const teamsRole = session?.role ?? null;
  const teamsUserId = session?.id ?? null;
  useEffect(() => {
    if (
      !teamsUserId ||
      (teamsRole !== "ADMIN" && teamsRole !== "RM" && teamsRole !== "SENIOR_RM")
    )
      return;
    let cancelled = false;
    const loadUnread = () => {
      api
        .teams()
        .then((res) => {
          if (!cancelled)
            setTeamsUnread(res.teams.reduce((n, tm) => n + tm.unread, 0));
        })
        .catch(() => undefined);
    };
    void Promise.resolve().then(loadUnread);
    const timer = setInterval(() => {
      if (isTabVisible()) void loadUnread();
    }, 30_000);
    const onVisible = () => {
      if (isTabVisible()) void loadUnread();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [teamsRole, teamsUserId]);

  const sessionId = session?.id ?? null;

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (typeof window === "undefined" || !sessionId) {
        setVerifyDismissed(false);
        return;
      }
      try {
        setVerifyDismissed(
          window.localStorage.getItem(`cl.verify.dismissed:${sessionId}`) ===
            "1",
        );
      } catch {
        setVerifyDismissed(false);
      }
    });
  }, [sessionId]);

  function dismissVerify() {
    if (sessionId) {
      try {
        window.localStorage.setItem(`cl.verify.dismissed:${sessionId}`, "1");
      } catch {
        /* private mode — hide for this session only */
      }
    }
    setVerifyDismissed(true);
  }

  const openAdminAutomation = useCallback(
    (sub: AdminSub) => {
      setAdminPanel(sub);
      setView("admin-automation");
    },
    [setView, setAdminPanel],
  );

  const shortcutActions = useMemo<
    Record<string, { handler: () => void; enabled?: boolean }>
  >(
    () => ({
      search: { handler: () => setPaletteOpen(true) },
      help: { handler: () => setShortcutsOpen(true) },
      "nav-home": {
        handler: () => {
          if (session) setView(defaultViewFor(session));
        },
      },
      "nav-cases": {
        handler: () => setView("rm-queue"),
        enabled: allowedViews.has("rm-queue"),
      },
      "nav-crm": {
        handler: () => setView("crm"),
        enabled: allowedViews.has("crm"),
      },
      "nav-teams": {
        handler: () => setView("teams"),
        enabled: allowedViews.has("teams"),
      },
      "nav-settings": {
        handler: () => setView("settings"),
        enabled: allowedViews.has("settings"),
      },
    }),
    [session, setView, allowedViews],
  );
  useKeyboardShortcuts({ actions: shortcutActions });

  if (!session) return null;

  const navigate = (n: NavItem) => {
    if (n.view === "admin-automation") setAdminPanel(n.sub ?? "automation");
    setView(n.view);
  };

  const MOBILE_PRIMARY_COUNT = 3;
  const mobilePrimary = items.slice(0, MOBILE_PRIMARY_COUNT);
  const hasMore = items.length > MOBILE_PRIMARY_COUNT;

  return (
    <div
      className="min-h-screen flex flex-col bg-background"
      data-surface={surfaceForView(view)}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-gold focus:px-4 focus:py-2 focus:text-sm focus:text-cobble-ink"
      >
        {t("common.skipToContent")}
      </a>
      <span
        className="sr-only"
        data-testid="chat-warm-state"
        data-warm={chatWarm}
        aria-live="polite"
      >
        {chatWarm === "cached"
          ? "On-device AI ready from cache"
          : chatWarm === "ready"
            ? "On-device AI ready"
            : chatWarm === "warming"
              ? "Preparing on-device AI in the background"
              : chatWarm === "idle"
                ? "On-device AI idle"
                : "On-device AI unavailable"}
      </span>
      <header className="lg:hidden sticky top-0 z-40 bg-cobble text-[#F5F1EA] px-4 min-h-16 flex items-center justify-between pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={() => {
            if (session) setView(defaultViewFor(session));
            window.scrollTo({ top: 0 });
          }}
          className="-ml-1 flex min-w-0 items-center gap-2 rounded-sm px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          aria-label={t("nav.home")}
        >
          <PassportSeal size={40} />
          <span className="font-editorial truncate tracking-[0.2em] text-sm uppercase">
            Citizen Lane
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <PaletteTriggerButton
            tone="dark"
            onClick={() => setPaletteOpen(true)}
            ariaLabel={t("palette.openAria")}
          />
          <LocaleSwitcher tone="dark" />
          <NotificationBell />
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            className="on-cobble-dim hover:text-[#F5F1EA] hover:bg-[#16324A] min-h-11 min-w-11"
            aria-label={t("nav.signOut")}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden lg:flex flex-col w-64 bg-cobble text-[#E8E2D6] fixed inset-y-0 left-0 z-40">
          <button
            type="button"
            onClick={() => {
              if (session) setView(defaultViewFor(session));
              window.scrollTo({ top: 0 });
            }}
            className="h-16 flex items-center gap-3 px-5 border-b border-[#24405A] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
            aria-label={t("nav.home")}
          >
            <PassportSeal size={40} />
            <Wordmark tone="light" size="sm" />
          </button>
          <nav
            aria-label="Primary"
            className="flex-1 px-3 py-4 overflow-y-auto"
          >
            {SECTION_ORDER.map((section) => {
              const sectionItems = items.filter((n) => n.section === section);
              if (sectionItems.length === 0) return null;
              return (
                <div key={section}>
                  <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8B9EB2]">
                    {sectionHeading(section, session?.name, t)}
                  </p>
                  <div className="space-y-0.5">
                    {sectionItems.map((n) => (
                      <button
                        key={`${n.view}-${n.labelKey}`}
                        onClick={() => navigate(n)}
                        aria-current={
                          isItemActive(n, view, adminPanel) ? "page" : undefined
                        }
                        className={cn(
                          "group w-full flex items-center gap-3 rounded px-3 py-2.5 text-sm transition-all duration-200 text-left",
                          isItemActive(n, view, adminPanel)
                            ? "bg-[#1B3A54] text-[#F5F1EA] font-semibold"
                            : "on-cobble-dim hover:bg-[#16324A] hover:text-[#F5F1EA] hover:translate-x-0.5",
                        )}
                      >
                        <span
                          className={cn(
                            "transition-transform duration-200",
                            !isItemActive(n, view, adminPanel) &&
                              "group-hover:scale-110",
                          )}
                        >
                          <n.icon className="h-4 w-4" />
                        </span>
                        {t(n.labelKey)}
                        {n.view === "teams" && teamsUnread > 0 && (
                          <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-cobble-ink">
                            {teamsUnread > 9 ? "9+" : teamsUnread}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {(hasHiddenTools || showAllTools) && (
              <button
                type="button"
                onClick={() => setShowAllTools((v) => !v)}
                aria-expanded={showAllTools}
                className="mt-3 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.14em] text-[#8B9EB2] transition-colors hover:bg-[#16324A] hover:text-[#F5F1EA]"
              >
                {showAllTools ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                {showAllTools ? t("nav.hideExtraTools") : t("nav.showAllTools")}
              </button>
            )}
          </nav>
          <div className="border-t border-[#24405A] p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center text-gold-ink font-editorial">
                {session.name
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{session.name}</p>
                <p className="text-[10px] uppercase tracking-[0.12em] text-gold-ink truncate">
                  {t(ROLE_LABEL_KEYS[session.role] ?? "role.CLIENT")}
                </p>
                <p className="text-[9px] uppercase tracking-[0.14em] text-gold-ink/70 truncate">
                  {t(AUDIENCE_TAG_KEYS[session.role] ?? "audience.MEMBER")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                className="on-cobble-dim hover:text-[#F5F1EA] hover:bg-[#16324A]"
                aria-label={t("nav.signOut")}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
          <header className="hidden lg:block h-16 border-b border-border/70 bg-card/70 backdrop-blur sticky top-0 z-30">
            <div className="h-full px-8 flex items-center justify-end gap-3">
              <PaletteTriggerButton
                tone="light"
                onClick={() => setPaletteOpen(true)}
                ariaLabel={t("palette.openAria")}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShortcutsOpen(true)}
                className="text-iron-ink hover:bg-muted min-h-11 min-w-11"
                aria-label={t("shortcuts.openAria")}
                title={t("shortcuts.openAria")}
              >
                <Keyboard className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setHelpOpen(true)}
                className="text-iron-ink hover:bg-muted min-h-11 min-w-11"
                aria-label={t("help.title")}
                title={t("help.title")}
              >
                <CircleHelp className="h-4 w-4" />
              </Button>
              <LocaleSwitcher tone="light" />
              <NotificationBell />
              <span className="h-6 w-[1px] bg-border mx-1" />
              <p className="text-sm text-iron-ink">{session.email}</p>
            </div>
          </header>

          <main
            id="main"
            ref={mainRef}
            tabIndex={-1}
            className="flex-1 scroll-mt-16"
          >
            <ViewBreadcrumb />
            {session.role === "CLIENT" && view === "client-dashboard" && (
              <GettingStarted
                role="CLIENT"
                width="content"
                onOpenAdminAutomation={openAdminAutomation}
              />
            )}
            {(session.role === "RM" || session.role === "SENIOR_RM") &&
              view === "rm-queue" && (
                <GettingStarted
                  role="RM"
                  onOpenAdminAutomation={openAdminAutomation}
                />
              )}
            {session.role === "ADMIN" && view === "admin-dashboard" && (
              <GettingStarted
                role="ADMIN"
                onOpenAdminAutomation={openAdminAutomation}
              />
            )}
            {!session.emailVerifiedAt && !verifyDismissed && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/40 bg-gold/5 px-5 py-2 text-xs text-iron-ink">
                <span>{t("auth.verifyPending")}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setView("verify-email")}
                    className="font-semibold text-gold-ink hover:underline"
                  >
                    {t("auth.verifyAction")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("common.close")}
                    onClick={dismissVerify}
                    className="inline-flex h-5 w-5 items-center justify-center text-iron-ink transition-colors hover:text-cobble-ink"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
            <ViewRouter adminSub={adminPanel} />
          </main>

          <footer className="mt-auto border-t border-border/60 bg-card">
            <div className="px-5 md:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                {t("shell.footerNote")}
              </p>
              <div className="flex items-center gap-2">
                <SandboxChip label={t("shell.sandbox")} />
                <span className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground">
                  {t("common.tagline")}
                </span>
              </div>
            </div>
          </footer>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenAdminAutomation={openAdminAutomation}
      />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <button
        type="button"
        onClick={() => setAiOpen(true)}
        aria-label={t("ai.open")}
        title={t("ai.open")}
        className="fixed bottom-24 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-cobble text-gold-ink shadow-lg ring-1 ring-gold/40 transition-transform hover:scale-105 lg:bottom-6"
      >
        <Sparkles className="h-5 w-5" aria-hidden />
      </button>
      {aiOpen && (
        <AiConsole
          open={aiOpen}
          onOpenChange={setAiOpen}
          caseId={view === "rm-case" ? activeCaseId : null}
          initialTab={aiTab}
        />
      )}

      <PushToTalk
        onIntent={handleVoiceIntent}
        onOpenDialog={() => setVoiceOpen(true)}
      />
      <VoiceControl
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        onExecute={handleVoiceIntent}
      />
      <CallCenter />

      <nav
        aria-label="Primary mobile"
        className="lg:hidden sticky bottom-0 z-40 bg-cobble text-[#F5F1EA] grid grid-cols-4 border-t border-[#24405A] pb-[env(safe-area-inset-bottom)]"
      >
        {mobilePrimary.map((n) => (
          <button
            key={`m-${n.view}-${n.labelKey}`}
            onClick={() => navigate(n)}
            className={cn(
              "group flex flex-col items-center gap-1 py-3 text-[10px] uppercase tracking-wider transition-all duration-200 min-h-[56px] justify-center",
              isNavActive(view, n.view)
                ? "text-gold-ink"
                : "on-cobble-dim active:bg-[#16324A] active:text-[#F5F1EA]",
            )}
          >
            <span
              className={cn(
                "transition-transform duration-200",
                isNavActive(view, n.view)
                  ? "scale-110"
                  : "group-active:scale-95",
              )}
            >
              <n.icon className="h-4 w-4" />
            </span>
            <span
              className={cn(
                "transition-opacity duration-200",
                isNavActive(view, n.view) ? "opacity-100" : "opacity-80",
              )}
            >
              {t(n.labelKey)}
            </span>
            {n.view === "teams" && teamsUnread > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-cobble-ink">
                {teamsUnread > 9 ? "9+" : teamsUnread}
              </span>
            )}
          </button>
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className={cn(
              "group flex flex-col items-center gap-1 py-3 text-[10px] uppercase tracking-wider transition-all duration-200 min-h-[56px] justify-center",
              mobileMenuOpen
                ? "text-gold-ink"
                : "on-cobble-dim active:bg-[#16324A] active:text-[#F5F1EA]",
            )}
            aria-label={t("nav.menuOpenAria")}
            aria-expanded={mobileMenuOpen}
          >
            <span className="transition-transform duration-200 group-active:scale-95">
              <MoreHorizontal className="h-4 w-4" />
            </span>
            <span className="opacity-80">{t("nav.more")}</span>
          </button>
        )}
      </nav>

      <Drawer open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <DrawerContent className="bg-cobble text-[#F5F1EA] border-t border-[#24405A] max-h-[85vh]">
          <DrawerHeader className="text-left">
            <div className="mb-1 flex items-center gap-3" aria-hidden="true">
              <PassportSeal size={40} />
              <Wordmark tone="light" size="sm" />
            </div>
            <DrawerTitle className="font-editorial text-lg">
              {t("nav.menuTitle")}
            </DrawerTitle>
            <DrawerDescription className="on-cobble-dim text-xs">
              {t("nav.menuHint")}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-8">
            {SECTION_ORDER.map((section) => {
              const sectionItems = items.filter((n) => n.section === section);
              if (sectionItems.length === 0) return null;
              return (
                <div key={section} className="mt-4">
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8B9EB2]">
                    {sectionHeading(section, session?.name, t)}
                  </p>
                  <div className="space-y-0.5">
                    {sectionItems.map((n) => (
                      <button
                        key={`drawer-${n.view}-${n.labelKey}`}
                        onClick={() => {
                          setMobileMenuOpen(false);
                          navigate(n);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded px-3 py-2.5 text-sm text-left transition-colors",
                          isItemActive(n, view, adminPanel)
                            ? "bg-[#1B3A54] text-[#F5F1EA] font-semibold"
                            : "on-cobble-dim hover:bg-[#16324A] hover:text-[#F5F1EA]",
                        )}
                      >
                        <n.icon className="h-4 w-4" />
                        {t(n.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function ViewRouter({ adminSub }: { adminSub: AdminSub }) {
  const view = useViewState().view;
  const role = useApp((s) => s.session?.role);
  const viewKey = `${view}-${adminSub}`;
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={viewKey}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className="page-enter"
      >
        {renderView(view, role, adminSub)}
      </motion.div>
    </AnimatePresence>
  );
}

function roleHome(role: string | undefined) {
  if (role === "ADMIN") return <AdminDashboard />;
  if (role === "CLIENT") return <ClientOnboarding />;
  return <RmQueue />;
}

function renderView(view: View, role: string | undefined, adminSub: AdminSub) {
  if (!canOpen(view, role)) return roleHome(role);
  switch (view) {
    case "client-onboarding":
      return <ClientOnboarding />;
    case "client-apply":
      return <ClientApply />;
    case "client-dashboard":
      return <ClientDashboard />;
    case "rm-queue":
      return <RmQueue />;
    case "rm-case":
      return <RmCaseDetail />;
    case "crm":
      return <CrmWorkspace />;
    case "accounts":
      return <AccountsWorkspace />;
    case "potentials":
      return <PotentialsWorkspace />;
    case "sales-orders":
      return <SalesOrdersWorkspace />;
    case "products":
      return <ProductsWorkspace />;
    case "settings":
      return <SettingsView />;
    case "admin-dashboard":
      return <AdminDashboard />;
    case "admin-users":
      return <AdminUsers />;
    case "admin-ops":
      return <AdminOps />;
    case "admin-records":
      return <AdminRecords />;
    case "admin-audit":
      return <AdminAudit />;
    case "admin-pieces":
      return <AdminPieces />;
    case "admin-notifications":
      return <AdminNotifications />;
    case "admin-flags":
      return <AdminFlags />;
    case "admin-programmes":
      return <AdminProgrammes />;
    case "admin-templates":
      return <AdminTemplates />;
    case "admin-news-scan":
      return <AdminNewsScan />;
    case "admin-business":
      return <AdminBusiness />;
    case "admin-settings":
      return <AdminPlatformSettings />;
    case "admin-telemetry":
      return <AdminTelemetry />;
    case "admin-automation":
      return adminSub === "integrations" && role === "ADMIN" ? (
        <AdminIntegrations />
      ) : (
        <AdminAutomation />
      );
    case "admin-parties":
      return <PartiesPanel />;
    case "admin-duplicates":
      return <DuplicatesPanel />;
    case "admin-merge-ledger":
      return <MergeLedgerPanel />;
    case "admin-work-items":
      return <WorkItemsPanel />;
    case "admin-kyc-checks":
      return <KycChecksPanel />;
    case "admin-quotes":
      return <QuotesPanel />;
    case "admin-refunds":
      return <RefundsPanel />;
    case "admin-handoffs":
      return <HandoffsPanel />;
    case "admin-human-tasks":
      return <HumanTasksPanel />;
    case "admin-provider-receipts":
      return <ProviderReceiptsPanel />;
    case "admin-citations":
      return <CitationsPanel />;
    case "admin-prompts":
      return <PromptsPanel />;
    case "admin-poll-connections":
      return <PollConnectionsPanel />;
    case "admin-availability":
      return <AvailabilityPanel />;
    case "admin-voice":
      return <VoicePanel />;
    case "admin-business-settings":
      return <BusinessSettingsPanel />;
    case "admin-form-schemas":
      return <FormSchemasPanel />;
    case "admin-attachments":
      return <AttachmentsPanel />;
    case "admin-mcp":
      return <McpPanel />;
    case "admin-bookings":
      return <BookingsPanel />;
    case "admin-reminders":
      return <RemindersPanel />;
    case "admin-triage":
      return <TriagePanel />;
    case "admin-offline":
      return <OfflinePanel />;
    case "admin-webhook-inbox":
      return <WebhookInboxPanel />;
    case "admin-conversation-inbox":
      return <ConversationInboxPanel />;
    case "studio-workflows":
      return <StudioWorkflows />;
    case "studio-detail":
      return <StudioDetail />;
    case "studio-runs":
      return <StudioRuns />;
    case "pages-list":
      return <PagesList />;
    case "pages-editor":
      return <PagesEditor />;
    case "teams":
      return <TeamsView />;
    case "procedure":
      return <ProcedureFlow />;
    default:
      return roleHome(role);
  }
}

function NotificationBell() {
  const { t } = useI18n();
  const session = useApp((s) => s.session);
  const setView = useViewState().setView;
  const setActiveCase = useApp((s) => s.setActiveCase);
  const [open, setOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof api.notifications>>["notifications"]
  >([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.notifications();
      setItems(res.notifications);
      setUnread(res.unread);
    } catch {
      /* silent — bell is non-critical */
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    const timer = setInterval(() => {
      if (isTabVisible()) void load();
    }, 15000);
    const onVisible = () => {
      if (isTabVisible()) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useLiveEvents({ notifications: () => void load(), ready: () => void load() });

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onMarkAll = () => {
      void (async () => {
        await api.markAllRead().catch(() => undefined);
        await load();
      })();
    };
    window.addEventListener("cl:open-notifications", onOpen);
    window.addEventListener("cl:mark-all-read", onMarkAll);
    return () => {
      window.removeEventListener("cl:open-notifications", onOpen);
      window.removeEventListener("cl:mark-all-read", onMarkAll);
    };
  }, [load]);

  async function markAll() {
    setBusy(true);
    await api.markAllRead().catch(() => undefined);
    await load();
    setBusy(false);
  }

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) load();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative min-h-11 min-w-11 lg:min-h-0 lg:min-w-0 on-cobble-dim hover:text-[#F5F1EA] hover:bg-[#16324A] lg:text-iron-ink lg:hover:bg-muted"
            aria-label={`${t("notifications.title")}${
              unread ? ` · ${unread}` : ""
            }`}
          >
            {unread > 0 ? (
              <BellRing className="h-4 w-4" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-gold text-cobble-ink text-[9px] font-bold flex items-center justify-center">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-80 max-h-96 overflow-y-auto"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <DropdownMenuLabel className="p-0">
              {t("notifications.title")}
            </DropdownMenuLabel>
            <button
              onClick={markAll}
              className="inline-flex min-h-6 items-center text-[11px] text-gold-ink hover:underline"
              disabled={busy}
            >
              {busy ? t("common.loading") : t("notifications.markAllRead")}
            </button>
          </div>
          <DropdownMenuSeparator />
          {items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/40 bg-gold/10">
                <Bell className="h-5 w-5 text-gold-ink" />
              </span>
              <p className="text-sm font-medium text-cobble-ink">
                {t("notifications.empty")}
              </p>
              <p className="text-xs text-muted-foreground">
                Document requests, status updates, and messages will appear
                here.
              </p>
            </div>
          )}
          {items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className={cn(
                "flex-col items-start gap-0.5 py-2.5 cursor-pointer",
                !n.readAt ? "font-semibold text-cobble-ink" : "text-iron-ink",
              )}
              onClick={async () => {
                if (!n.readAt) await api.markRead(n.id);
                if (n.caseId && session?.role !== "CLIENT")
                  setActiveCase(n.caseId);
                else setView(session ? defaultViewFor(session) : "login");
                load();
              }}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-sm",
                    !n.readAt
                      ? "font-semibold text-cobble-ink"
                      : "text-iron-ink",
                  )}
                >
                  {n.title}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  {n.category.toLowerCase()}
                </span>
              </div>
              <span className="text-xs text-muted-foreground line-clamp-2">
                {n.body}
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                {new Date(n.createdAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => {
              setOpen(false);
              setPrefsOpen(true);
            }}
          >
            <SlidersHorizontal
              className="mr-2 h-4 w-4 text-gold-ink"
              aria-hidden="true"
            />
            {t("notifications.preferences")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NotificationPrefsDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
    </>
  );
}
