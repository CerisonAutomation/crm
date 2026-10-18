/**
 * nav — the single source of truth for in-app navigation.
 *
 * The sidebar (app-shell) and the command palette both consume this config,
 * so a destination added here appears in both at once. Icons are lucide
 * COMPONENT references (`icon: LayoutDashboard`), rendered by the consumers
 * as `<Item.icon className="h-4 w-4" />`.
 *
 * Type-only imports from `@/lib/store` / `@/lib/i18n` keep this module free
 * of runtime cycles: the store may import `canOpen`/`rememberRecent` from
 * here without pulling React, icons or the store itself into a cycle.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ContactRound,
  Bot,
  BookOpen,
  Building2,
  Flag,
  Globe,
  LayoutDashboard,
  LayoutTemplate,
  FileText,
  MailQuestion,
  Puzzle,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  UsersRound,
  Workflow,
  Search,
  Copy,
  GitMerge,
  CheckSquare,
  RotateCcw,
  ArrowRightLeft,
  UserCheck,
  Receipt,
  MessageSquare,
  Radio,
  Calendar,
  Mic,
  FileJson,
  Paperclip,
  CloudOff,
  Inbox,
  Target,
  ShoppingCart,
  Package,
} from "lucide-react";
import type { StringKey } from "@/lib/i18n";
import type { View } from "@/lib/store";

export type NavSection = "client" | "staff" | "admin" | "library";
/** Which panel the shared admin-automation view renders (URL `panel=` param). */
export type AdminSub = "automation" | "integrations";
export type NavItem = {
  view: View;
  labelKey: StringKey;
  icon: LucideIcon;
  roles: string[];
  section: NavSection;
  sub?: AdminSub;
  /**
   * Everyday destinations, shown in Simple mode. Items without it still exist
   * and still work — Simple mode collapses them behind a "More tools" group
   * rather than hiding them, so the full app stays reachable either way.
   */
  essential?: boolean;
};

export const NAV: NavItem[] = [
  // PRIVATE CLIENT
  // "Start my application" opens the APPLY HUB, not the wizard: the hub
  // lists every route the firm files, shows where the client's own case
  // stands, and highlights what the desk is waiting on. The wizard is one
  // step in from there (and remains the landing view for a client who has
  // not submitted yet — see `defaultViewFor`).
  {
    view: "client-apply",
    labelKey: "nav.myApplication",
    icon: LayoutDashboard,
    roles: ["CLIENT"],
    section: "client",
    essential: true,
  },
  {
    view: "client-dashboard",
    labelKey: "nav.caseDashboard",
    icon: ShieldCheck,
    roles: ["CLIENT"],
    section: "client",
    essential: true,
  },
  // STAFF DESK — builders (Workflow Studio, Lane Pages) are ADMIN-ONLY;
  // staff get the read-only Run Inspector for observability.
  {
    view: "rm-queue",
    labelKey: "nav.caseQueue",
    icon: LayoutDashboard,
    roles: ["RM", "SENIOR_RM", "AUDITOR"],
    section: "staff",
    essential: true,
  },
  {
    view: "crm",
    labelKey: "nav.crm",
    icon: ContactRound,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    essential: true,
  },
  {
    view: "accounts",
    labelKey: "nav.accounts",
    icon: Building2,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    essential: true,
  },
  {
    view: "potentials",
    labelKey: "nav.potentials",
    icon: Target,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    essential: false,
  },
  {
    view: "sales-orders",
    labelKey: "nav.salesOrders",
    icon: ShoppingCart,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    essential: false,
  },
  {
    view: "products",
    labelKey: "nav.products",
    icon: Package,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    essential: false,
  },
  {
    view: "teams",
    labelKey: "nav.teams",
    icon: UsersRound,
    roles: ["ADMIN", "RM", "SENIOR_RM"],
    section: "staff",
    essential: true,
  },
  {
    view: "studio-runs",
    labelKey: "nav.runInspector",
    icon: LayoutTemplate,
    roles: ["RM", "SENIOR_RM", "AUDITOR"],
    section: "staff",
  },
  // ADMINISTRATION
  {
    view: "admin-dashboard",
    labelKey: "nav.overview",
    icon: LayoutDashboard,
    roles: ["ADMIN"],
    section: "admin",
    essential: true,
  },
  {
    view: "admin-users",
    labelKey: "nav.users",
    icon: Users,
    roles: ["ADMIN"],
    section: "admin",
    essential: true,
  },
  {
    view: "admin-ops",
    labelKey: "nav.operations",
    icon: Activity,
    roles: ["ADMIN", "SENIOR_RM"],
    section: "admin",
    essential: true,
  },
  {
    view: "admin-records",
    labelKey: "nav.records",
    icon: FileText,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "rm-queue",
    labelKey: "nav.caseQueue",
    icon: LayoutDashboard,
    roles: ["ADMIN"],
    section: "admin",
    essential: true,
  },
  {
    view: "studio-workflows",
    labelKey: "nav.studio",
    icon: Workflow,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "pages-list",
    labelKey: "nav.pages",
    icon: Globe,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-pieces",
    labelKey: "nav.pieces",
    icon: Puzzle,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-notifications",
    labelKey: "nav.notificationCentre",
    icon: MailQuestion,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-flags",
    labelKey: "nav.featureFlags",
    icon: Flag,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-programmes",
    labelKey: "nav.programmes",
    icon: Globe,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-templates",
    labelKey: "nav.templates",
    icon: MailQuestion,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-news-scan",
    labelKey: "nav.newsScan",
    icon: Search,
    roles: ["ADMIN", "SENIOR_RM"],
    section: "admin",
  },
  {
    view: "admin-automation",
    labelKey: "nav.automation",
    icon: Bot,
    roles: ["ADMIN", "SENIOR_RM"],
    section: "admin",
    sub: "automation",
  },
  {
    view: "admin-automation",
    labelKey: "admin.integrations",
    icon: Puzzle,
    roles: ["ADMIN"],
    section: "admin",
    sub: "integrations",
  },
  {
    view: "admin-business",
    labelKey: "nav.business",
    icon: Building2,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-settings",
    labelKey: "nav.platformSettings",
    icon: SlidersHorizontal,
    roles: ["ADMIN"],
    section: "admin",
    essential: true,
  },
  {
    view: "admin-telemetry",
    labelKey: "nav.telemetry",
    icon: Activity,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-audit",
    labelKey: "nav.audit",
    icon: ScrollText,
    roles: ["ADMIN", "AUDITOR"],
    section: "admin",
    essential: true,
  },
  {
    view: "admin-parties",
    labelKey: "nav.parties",
    icon: Users,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-duplicates",
    labelKey: "nav.duplicates",
    icon: Copy,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-merge-ledger",
    labelKey: "nav.mergeLedger",
    icon: GitMerge,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-work-items",
    labelKey: "nav.workItems",
    icon: CheckSquare,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-kyc-checks",
    labelKey: "nav.kycChecks",
    icon: ShieldCheck,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-quotes",
    labelKey: "nav.quotes",
    icon: FileText,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-refunds",
    labelKey: "nav.refunds",
    icon: RotateCcw,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-handoffs",
    labelKey: "nav.handoffs",
    icon: ArrowRightLeft,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-human-tasks",
    labelKey: "nav.humanTasks",
    icon: UserCheck,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-provider-receipts",
    labelKey: "nav.providerReceipts",
    icon: Receipt,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-citations",
    labelKey: "nav.citations",
    icon: BookOpen,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-prompts",
    labelKey: "nav.prompts",
    icon: MessageSquare,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-poll-connections",
    labelKey: "nav.pollConnections",
    icon: Radio,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-availability",
    labelKey: "nav.availability",
    icon: Calendar,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-voice",
    labelKey: "nav.voice",
    icon: Mic,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-business-settings",
    labelKey: "nav.businessSettings",
    icon: Settings,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-form-schemas",
    labelKey: "nav.formSchemas",
    icon: FileJson,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-attachments",
    labelKey: "nav.attachments",
    icon: Paperclip,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-mcp",
    labelKey: "nav.mcp",
    icon: Puzzle,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-offline",
    labelKey: "nav.offline",
    icon: CloudOff,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-webhook-inbox",
    labelKey: "nav.webhookInbox",
    icon: Inbox,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "admin-conversation-inbox",
    labelKey: "nav.conversationInbox",
    icon: MessageSquare,
    roles: ["ADMIN"],
    section: "admin",
  },
  {
    view: "studio-runs",
    labelKey: "nav.runInspector",
    icon: LayoutTemplate,
    roles: ["ADMIN"],
    section: "admin",
  },
  // LIBRARY — common section, visible to every signed-in role
  {
    view: "pages-explore",
    labelKey: "nav.pagesExplore",
    icon: BookOpen,
    roles: ["CLIENT", "RM", "SENIOR_RM", "AUDITOR", "ADMIN"],
    section: "library",
    essential: true,
  },
  {
    view: "settings",
    labelKey: "nav.settings",
    icon: Settings,
    roles: ["CLIENT", "RM", "SENIOR_RM", "AUDITOR", "ADMIN"],
    section: "library",
    essential: true,
  },
];

export const SECTION_LABEL_KEYS: Record<NavSection, StringKey> = {
  client: "nav.section.client",
  staff: "nav.section.staff",
  admin: "nav.section.admin",
  library: "nav.section.library",
};

/**
 * Heading for a section in the signed-in menu.
 *
 * The CLIENT section is the applicant's own area, so it is titled with their
 * name rather than the generic word "Client" — "Amelia Hartmann › My
 * application" reads as a place, where "Client › My application" reads as a
 * category. The role itself is still stated in the account card, so nothing is
 * lost. Staff sections keep their desk label (the name would be equally true
 * but less useful with many colleagues sharing the desk).
 */
export function sectionHeading(
  section: NavSection,
  name: string | null | undefined,
  translate: (key: StringKey) => string,
): string {
  const named = name?.trim();
  if (section === "client" && named) return named;
  return translate(SECTION_LABEL_KEYS[section]);
}

export const SECTION_ORDER: NavSection[] = [
  "client",
  "staff",
  "admin",
  "library",
];

export const AUDIENCE_TAG_KEYS: Record<string, StringKey> = {
  // ADMIN must not reuse `role.ADMIN` here: the sidebar prints the role label and
  // the audience tag on consecutive lines, so sharing a key rendered
  // "Administrator" twice. The audience tag is the desk, not the role.
  ADMIN: "audience.MEMBER",
  RM: "role.STAFF",
  SENIOR_RM: "role.STAFF",
  AUDITOR: "role.STAFF",
  CLIENT: "audience.CLIENT",
};

export const ROLE_LABEL_KEYS: Record<string, StringKey> = {
  CLIENT: "role.CLIENT",
  RM: "role.RM",
  SENIOR_RM: "role.SENIOR_RM",
  ADMIN: "role.ADMIN",
  AUDITOR: "role.AUDITOR",
};

/** Active state incl. detail-view highlighting (detail views highlight their list). */
export function isNavActive(current: View, target: View): boolean {
  if (current === target) return true;
  if (current === "rm-case" && target === "rm-queue") return true;
  if (current === "studio-detail" && target === "studio-workflows") return true;
  if (current === "pages-editor" && target === "pages-list") return true;
  return false;
}

/** Active state for a nav item — admin-automation is shared by two panels (Automation / Integrations). */
export function isItemActive(
  n: NavItem,
  view: View,
  adminSub: AdminSub,
): boolean {
  if (n.view !== "admin-automation") return isNavActive(view, n.view);
  if (view !== "admin-automation") return false;
  return n.sub === "integrations"
    ? adminSub === "integrations"
    : adminSub !== "integrations";
}

/** Views rendered outside the authenticated shell — mirrors page.tsx PUBLIC_VIEWS. */
const PUBLIC_VIEWS: ReadonlySet<View> = new Set<View>([
  "landing",
  "login",
  "signup",
  "forgot-password",
  "reset-password",
  "verify-email",
  "magic-link",
  "guided",
  "pages-explore",
  "pages-reader",
  "procedure",
]);

/** Detail views inherit the role scope of the list that owns them. */
const DETAIL_OWNER: Partial<Record<View, View>> = {
  "rm-case": "rm-queue",
  "studio-detail": "studio-workflows",
  "pages-editor": "pages-list",
  // The onboarding wizard is not a nav destination, but it is CLIENT-only by
  // nature (it files the caller's own case) — without an owner the URL gate
  // bounces a CLIENT deep link to the dashboard and ?view=client-onboarding
  // is reachable only in-app. Inheriting the dashboard scope keeps the
  // wrong-role guarantee (guests still route to login, staff still bounce).
  "client-onboarding": "client-dashboard",
  // Bookings / reminders / triage panels render in ViewRouter but are not
  // sidebar destinations — ADMIN-only by nature, inheriting the dashboard scope.
  "admin-bookings": "admin-dashboard",
  "admin-reminders": "admin-dashboard",
  "admin-triage": "admin-dashboard",
};

/**
 * May `role` open `view`? Public views are always openable; every app view is
 * exactly the roles its NAV items list; detail views resolve to their list
 * parent first (rm-case → RM/SENIOR_RM/AUDITOR/ADMIN, studio-detail and
 * pages-editor → ADMIN). A missing role (guest) may only open public views.
 *
 * This is the gate for URL deep links, Back/Forward restoration and palette
 * recents: the address bar can name a destination the role was never handed,
 * and the wrong-role screen must never render.
 */
export function canOpen(view: View, role: string | null | undefined): boolean {
  if (PUBLIC_VIEWS.has(view)) return true;
  const owner = DETAIL_OWNER[view] ?? view;
  const wanted = role ?? "";
  return NAV.some((n) => n.view === owner && n.roles.includes(wanted));
}

/* ── Recent palette destinations (localStorage, `cl.recent`) ─────────────── */

export type RecentEntry = { view: View; sub?: AdminSub };

const RECENT_KEY = "cl.recent";
const RECENT_MAX = 5;

/**
 * Recent destinations from localStorage — newest first, deduped, capped at 5,
 * NAV destinations only (the only rows the palette can reopen). Never throws:
 * private mode / blocked storage simply yields no recents.
 */
export function readRecents(): RecentEntry[] {
  if (globalThis.window === undefined) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentEntry[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const view = (entry as { view?: unknown }).view;
      const subRaw = (entry as { sub?: unknown }).sub;
      if (typeof view !== "string" || !NAV.some((n) => n.view === view))
        continue;
      const sub: AdminSub | undefined =
        view === "admin-automation" &&
        (subRaw === "automation" || subRaw === "integrations")
          ? subRaw
          : undefined;
      const key = `${view}|${sub ?? ""}`;
      if (out.some((e) => `${e.view}|${e.sub ?? ""}` === key)) continue;
      out.push(sub ? { view: view as View, sub } : { view: view as View });
      if (out.length >= RECENT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Record a destination in the recent list (moves it to the front, dedupes,
 * caps at 5). Guarded by try/catch for private mode — recents are best-effort
 * and must never break navigation.
 */
export function rememberRecent(entry: RecentEntry): void {
  // Only NAV destinations are re-openable from the palette.
  if (!NAV.some((n) => n.view === entry.view)) return;
  const normalized: RecentEntry =
    entry.view === "admin-automation" && entry.sub
      ? { view: entry.view, sub: entry.sub }
      : { view: entry.view };
  try {
    const rest = readRecents().filter(
      (e) =>
        !(
          e.view === normalized.view && (e.sub ?? "") === (normalized.sub ?? "")
        ),
    );
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([normalized, ...rest].slice(0, RECENT_MAX)),
    );
  } catch {
    /* private mode — recents are best-effort */
  }
}
