/**
 * page-registry — the single source of truth for every page/tab in the app.
 *
 * Each page is a self-contained module with its own metadata: label, icon,
 * roles, section, and a lazy-loaded component. The registry is consumed by
 * the navigation system, the view router, and the page manager UI.
 *
 * Zenith Vibe Engineering: modular, enable/disable, customizable.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowRightLeft,
  BookOpen,
  Bot,
  Building2,
  Calendar,
  CheckSquare,
  CloudOff,
  ContactRound,
  Copy,
  FileJson,
  FileText,
  Flag,
  GitMerge,
  Globe,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  MailQuestion,
  MessageSquare,
  Mic,
  Package,
  Paperclip,
  Puzzle,
  Receipt,
  RotateCcw,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Target,
  UserCheck,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";
import type { StringKey } from "@/lib/i18n";
import type { View } from "@/lib/store";
import type { AdminSub, NavSection } from "@/lib/nav";

/** A single page/tab module — self-contained with all metadata. */
export type PageModule = {
  view: View;
  labelKey: StringKey;
  icon: LucideIcon;
  roles: string[];
  section: NavSection;
  sub?: AdminSub;
  essential?: boolean;
  description?: string;
  /** Lazy-loaded component — keeps the shell bundle small. */
  component: () => Promise<any>;
};

/**
 * The complete page registry. Every in-app view is listed here.
 * Public/auth views (landing, login, signup, etc.) are NOT included —
 * they render outside the authenticated shell and are not "pages/tabs".
 */
export const PAGE_REGISTRY: PageModule[] = [
  // ── CLIENT ──────────────────────────────────────────────────────────────
  {
    view: "client-apply",
    labelKey: "nav.myApplication",
    icon: LayoutDashboard,
    roles: ["CLIENT"],
    section: "client",
    essential: true,
    description: "Start or manage an application",
    component: () =>
      import("@/features/client/client-apply").then((m) => m.ClientApply),
  },
  {
    view: "client-dashboard",
    labelKey: "nav.caseDashboard",
    icon: ShieldCheck,
    roles: ["CLIENT"],
    section: "client",
    essential: true,
    description: "Your progress and next steps",
    component: () =>
      import("@/features/client/client-portal").then((m) => m.ClientDashboard),
  },
  {
    view: "client-onboarding",
    labelKey: "nav.onboarding",
    icon: FileText,
    roles: ["CLIENT"],
    section: "client",
    description: "Profile and onboarding wizard",
    component: () =>
      import("@/features/client/client-portal").then((m) => m.ClientOnboarding),
  },

  // ── STAFF ──────────────────────────────────────────────────────────────
  {
    view: "rm-queue",
    labelKey: "nav.caseQueue",
    icon: LayoutDashboard,
    roles: ["RM", "SENIOR_RM", "AUDITOR"],
    section: "staff",
    essential: true,
    description: "Prioritised client work",
    component: () =>
      import("@/features/rm/rm-console").then((m) => m.RmQueue),
  },
  {
    view: "crm",
    labelKey: "nav.crm",
    icon: ContactRound,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    essential: true,
    description: "People, tasks, and activity",
    component: () =>
      import("@/features/crm/crm-workspace").then((m) => m.CrmWorkspace),
  },
  {
    view: "accounts",
    labelKey: "nav.accounts",
    icon: Building2,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    essential: true,
    description: "Organisations and relationships",
    component: () =>
      import("@/features/crm/accounts-workspace").then(
        (m) => m.AccountsWorkspace,
      ),
  },
  {
    view: "potentials",
    labelKey: "nav.potentials",
    icon: Target,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    description: "Potential client engagements",
    component: () =>
      import("@/features/crm/potentials-workspace").then(
        (m) => m.PotentialsWorkspace,
      ),
  },
  {
    view: "sales-orders",
    labelKey: "nav.salesOrders",
    icon: ShoppingCart,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    description: "Sales orders and transactions",
    component: () =>
      import("@/features/crm/sales-orders-workspace").then(
        (m) => m.SalesOrdersWorkspace,
      ),
  },
  {
    view: "products",
    labelKey: "nav.products",
    icon: Package,
    roles: ["RM", "SENIOR_RM", "ADMIN"],
    section: "staff",
    description: "Products and services",
    component: () =>
      import("@/features/crm/products-workspace").then(
        (m) => m.ProductsWorkspace,
      ),
  },
  {
    view: "teams",
    labelKey: "nav.teams",
    icon: UsersRound,
    roles: ["ADMIN", "RM", "SENIOR_RM"],
    section: "staff",
    essential: true,
    description: "Team management and messaging",
    component: () =>
      import("@/features/teams/teams-view").then((m) => m.TeamsView),
  },
  {
    view: "studio-runs",
    labelKey: "nav.runInspector",
    icon: LayoutTemplate,
    roles: ["RM", "SENIOR_RM", "AUDITOR"],
    section: "staff",
    description: "Workflow run inspector",
    component: () =>
      import("@/features/studio/workflow-studio").then((m) => m.StudioRuns),
  },

  // ── ADMIN ──────────────────────────────────────────────────────────────
  {
    view: "admin-dashboard",
    labelKey: "nav.overview",
    icon: LayoutDashboard,
    roles: ["ADMIN"],
    section: "admin",
    essential: true,
    description: "Organisation health and priorities",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminDashboard),
  },
  {
    view: "admin-users",
    labelKey: "nav.users",
    icon: Users,
    roles: ["ADMIN"],
    section: "admin",
    essential: true,
    description: "Users and access management",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminUsers),
  },
  {
    view: "admin-ops",
    labelKey: "nav.operations",
    icon: Activity,
    roles: ["ADMIN", "SENIOR_RM"],
    section: "admin",
    essential: true,
    description: "Operational controls",
    component: () =>
      import("@/features/admin/ops-panel").then((m) => m.AdminOps),
  },
  {
    view: "admin-records",
    labelKey: "nav.records",
    icon: FileText,
    roles: ["ADMIN"],
    section: "admin",
    description: "Business records",
    component: () =>
      import("@/features/admin/records-panel").then((m) => m.AdminRecords),
  },
  {
    view: "admin-audit",
    labelKey: "nav.audit",
    icon: ScrollText,
    roles: ["ADMIN", "AUDITOR"],
    section: "admin",
    essential: true,
    description: "Audit trail and compliance",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminAudit),
  },
  {
    view: "admin-automation",
    labelKey: "nav.automation",
    icon: Bot,
    roles: ["ADMIN", "SENIOR_RM"],
    section: "admin",
    sub: "automation",
    description: "Automation workflows",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminAutomation),
  },
  {
    view: "admin-automation",
    labelKey: "admin.integrations",
    icon: Puzzle,
    roles: ["ADMIN"],
    section: "admin",
    sub: "integrations",
    description: "Integration management",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminIntegrations),
  },
  {
    view: "admin-business",
    labelKey: "nav.business",
    icon: Building2,
    roles: ["ADMIN"],
    section: "admin",
    description: "Business settings",
    component: () =>
      import("@/features/admin/business-settings").then((m) => m.AdminBusiness),
  },
  {
    view: "admin-settings",
    labelKey: "nav.platformSettings",
    icon: SlidersHorizontal,
    roles: ["ADMIN"],
    section: "admin",
    essential: true,
    description: "Platform settings",
    component: () =>
      import("@/features/admin/platform-settings").then(
        (m) => m.AdminPlatformSettings,
      ),
  },
  {
    view: "admin-telemetry",
    labelKey: "nav.telemetry",
    icon: Activity,
    roles: ["ADMIN"],
    section: "admin",
    description: "Telemetry and monitoring",
    component: () =>
      import("@/features/admin/telemetry-panel").then((m) => m.AdminTelemetry),
  },
  {
    view: "admin-pieces",
    labelKey: "nav.pieces",
    icon: Puzzle,
    roles: ["ADMIN"],
    section: "admin",
    description: "Content pieces",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminPieces),
  },
  {
    view: "admin-notifications",
    labelKey: "nav.notificationCentre",
    icon: MailQuestion,
    roles: ["ADMIN"],
    section: "admin",
    description: "Notification centre",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminNotifications),
  },
  {
    view: "admin-flags",
    labelKey: "nav.featureFlags",
    icon: Flag,
    roles: ["ADMIN"],
    section: "admin",
    description: "Feature flags",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminFlags),
  },
  {
    view: "admin-programmes",
    labelKey: "nav.programmes",
    icon: Globe,
    roles: ["ADMIN"],
    section: "admin",
    description: "Programme management",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminProgrammes),
  },
  {
    view: "admin-templates",
    labelKey: "nav.templates",
    icon: MailQuestion,
    roles: ["ADMIN"],
    section: "admin",
    description: "Template management",
    component: () =>
      import("@/features/admin/admin-console").then((m) => m.AdminTemplates),
  },
  {
    view: "admin-news-scan",
    labelKey: "nav.newsScan",
    icon: Globe,
    roles: ["ADMIN", "SENIOR_RM"],
    section: "admin",
    description: "News scanning",
    component: () =>
      import("@/features/admin/news-scan-panel").then((m) => m.AdminNewsScan),
  },
  {
    view: "admin-parties",
    labelKey: "nav.parties",
    icon: Users,
    roles: ["ADMIN"],
    section: "admin",
    description: "Party management",
    component: () =>
      import("@/features/admin/parties-panel").then((m) => m.PartiesPanel),
  },
  {
    view: "admin-duplicates",
    labelKey: "nav.duplicates",
    icon: Copy,
    roles: ["ADMIN"],
    section: "admin",
    description: "Duplicate detection",
    component: () =>
      import("@/features/admin/duplicates-panel").then((m) => m.DuplicatesPanel),
  },
  {
    view: "admin-merge-ledger",
    labelKey: "nav.mergeLedger",
    icon: GitMerge,
    roles: ["ADMIN"],
    section: "admin",
    description: "Merge ledger",
    component: () =>
      import("@/features/admin/merge-ledger-panel").then(
        (m) => m.MergeLedgerPanel,
      ),
  },
  {
    view: "admin-work-items",
    labelKey: "nav.workItems",
    icon: CheckSquare,
    roles: ["ADMIN"],
    section: "admin",
    description: "Work items",
    component: () =>
      import("@/features/admin/work-items-panel").then((m) => m.WorkItemsPanel),
  },
  {
    view: "admin-kyc-checks",
    labelKey: "nav.kycChecks",
    icon: ShieldCheck,
    roles: ["ADMIN"],
    section: "admin",
    description: "KYC checks",
    component: () =>
      import("@/features/admin/kyc-checks-panel").then((m) => m.KycChecksPanel),
  },
  {
    view: "admin-quotes",
    labelKey: "nav.quotes",
    icon: FileText,
    roles: ["ADMIN"],
    section: "admin",
    description: "Quotes",
    component: () =>
      import("@/features/admin/quotes-panel").then((m) => m.QuotesPanel),
  },
  {
    view: "admin-refunds",
    labelKey: "nav.refunds",
    icon: RotateCcw,
    roles: ["ADMIN"],
    section: "admin",
    description: "Refunds",
    component: () =>
      import("@/features/admin/refunds-panel").then((m) => m.RefundsPanel),
  },
  {
    view: "admin-handoffs",
    labelKey: "nav.handoffs",
    icon: ArrowRightLeft,
    roles: ["ADMIN"],
    section: "admin",
    description: "Handoffs",
    component: () =>
      import("@/features/admin/handoffs-panel").then((m) => m.HandoffsPanel),
  },
  {
    view: "admin-human-tasks",
    labelKey: "nav.humanTasks",
    icon: UserCheck,
    roles: ["ADMIN"],
    section: "admin",
    description: "Human tasks",
    component: () =>
      import("@/features/admin/human-tasks-panel").then(
        (m) => m.HumanTasksPanel,
      ),
  },
  {
    view: "admin-provider-receipts",
    labelKey: "nav.providerReceipts",
    icon: Receipt,
    roles: ["ADMIN"],
    section: "admin",
    description: "Provider receipts",
    component: () =>
      import("@/features/admin/provider-receipts-panel").then(
        (m) => m.ProviderReceiptsPanel,
      ),
  },
  {
    view: "admin-citations",
    labelKey: "nav.citations",
    icon: BookOpen,
    roles: ["ADMIN"],
    section: "admin",
    description: "Citations",
    component: () =>
      import("@/features/admin/citations-panel").then((m) => m.CitationsPanel),
  },
  {
    view: "admin-prompts",
    labelKey: "nav.prompts",
    icon: MessageSquare,
    roles: ["ADMIN"],
    section: "admin",
    description: "AI prompts",
    component: () =>
      import("@/features/admin/prompts-panel").then((m) => m.PromptsPanel),
  },
  {
    view: "admin-poll-connections",
    labelKey: "nav.pollConnections",
    icon: Activity,
    roles: ["ADMIN"],
    section: "admin",
    description: "Poll connections",
    component: () =>
      import("@/features/admin/poll-connections-panel").then(
        (m) => m.PollConnectionsPanel,
      ),
  },
  {
    view: "admin-availability",
    labelKey: "nav.availability",
    icon: Calendar,
    roles: ["ADMIN"],
    section: "admin",
    description: "Availability",
    component: () =>
      import("@/features/admin/availability-panel").then(
        (m) => m.AvailabilityPanel,
      ),
  },
  {
    view: "admin-voice",
    labelKey: "nav.voice",
    icon: Mic,
    roles: ["ADMIN"],
    section: "admin",
    description: "Voice settings",
    component: () =>
      import("@/features/admin/voice-panel").then((m) => m.VoicePanel),
  },
  {
    view: "admin-business-settings",
    labelKey: "nav.businessSettings",
    icon: Settings,
    roles: ["ADMIN"],
    section: "admin",
    description: "Business settings",
    component: () =>
      import("@/features/admin/business-settings-panel").then(
        (m) => m.BusinessSettingsPanel,
      ),
  },
  {
    view: "admin-form-schemas",
    labelKey: "nav.formSchemas",
    icon: FileJson,
    roles: ["ADMIN"],
    section: "admin",
    description: "Form schemas",
    component: () =>
      import("@/features/admin/form-schemas-panel").then(
        (m) => m.FormSchemasPanel,
      ),
  },
  {
    view: "admin-attachments",
    labelKey: "nav.attachments",
    icon: Paperclip,
    roles: ["ADMIN"],
    section: "admin",
    description: "Attachments",
    component: () =>
      import("@/features/admin/attachments-panel").then(
        (m) => m.AttachmentsPanel,
      ),
  },
  {
    view: "admin-mcp",
    labelKey: "nav.mcp",
    icon: Puzzle,
    roles: ["ADMIN"],
    section: "admin",
    description: "MCP server",
    component: () =>
      import("@/features/admin/mcp-panel").then((m) => m.McpPanel),
  },
  {
    view: "admin-offline",
    labelKey: "nav.offline",
    icon: CloudOff,
    roles: ["ADMIN"],
    section: "admin",
    description: "Offline mode",
    component: () =>
      import("@/features/admin/offline-panel").then((m) => m.OfflinePanel),
  },
  {
    view: "admin-webhook-inbox",
    labelKey: "nav.webhookInbox",
    icon: Inbox,
    roles: ["ADMIN"],
    section: "admin",
    description: "Webhook inbox",
    component: () =>
      import("@/features/admin/webhook-inbox-panel").then(
        (m) => m.WebhookInboxPanel,
      ),
  },
  {
    view: "admin-conversation-inbox",
    labelKey: "nav.conversationInbox",
    icon: MessageSquare,
    roles: ["ADMIN"],
    section: "admin",
    description: "Conversation inbox",
    component: () =>
      import("@/features/admin/conversation-inbox-panel").then(
        (m) => m.ConversationInboxPanel,
      ),
  },
  {
    view: "admin-bookings",
    labelKey: "nav.bookings",
    icon: Calendar,
    roles: ["ADMIN"],
    section: "admin",
    description: "Bookings",
    component: () =>
      import("@/features/admin/bookings-panel").then((m) => m.BookingsPanel),
  },
  {
    view: "admin-reminders",
    labelKey: "nav.reminders",
    icon: Calendar,
    roles: ["ADMIN"],
    section: "admin",
    description: "Reminders",
    component: () =>
      import("@/features/admin/reminders-panel").then((m) => m.RemindersPanel),
  },
  {
    view: "admin-triage",
    labelKey: "nav.triage",
    icon: CheckSquare,
    roles: ["ADMIN"],
    section: "admin",
    description: "Triage",
    component: () =>
      import("@/features/admin/triage-panel").then((m) => m.TriagePanel),
  },
  {
    view: "studio-workflows",
    labelKey: "nav.studio",
    icon: Workflow,
    roles: ["ADMIN"],
    section: "admin",
    description: "Workflow studio",
    component: () =>
      import("@/features/studio/workflow-studio").then((m) => m.StudioWorkflows),
  },
  {
    view: "pages-list",
    labelKey: "nav.pages",
    icon: Globe,
    roles: ["ADMIN"],
    section: "admin",
    description: "Lane pages",
    component: () =>
      import("@/features/pages/lane-pages").then((m) => m.PagesList),
  },

  // ── LIBRARY (common) ──────────────────────────────────────────────────
  {
    view: "pages-explore",
    labelKey: "nav.pagesExplore",
    icon: BookOpen,
    roles: ["CLIENT", "RM", "SENIOR_RM", "AUDITOR", "ADMIN"],
    section: "library",
    essential: true,
    description: "The Citizen Lane Journal",
    component: () =>
      import("@/features/pages/pages-explorer").then((m) => m.PagesExplore),
  },
  {
    view: "settings",
    labelKey: "nav.settings",
    icon: Settings,
    roles: ["CLIENT", "RM", "SENIOR_RM", "AUDITOR", "ADMIN"],
    section: "library",
    essential: true,
    description: "Profile and workspace preferences",
    component: () =>
      import("@/features/settings/settings-view").then((m) => m.SettingsView),
  },
];

/** Lookup: view → page module (first match wins for shared views like admin-automation). */
export const PAGE_MAP: Map<View, PageModule> = new Map(
  PAGE_REGISTRY.map((p) => [p.view, p]),
);

/** All unique views in the registry. */
export const REGISTRY_VIEWS: View[] = [...new Set(PAGE_REGISTRY.map((p) => p.view))];

/** Get the page module for a view. */
export function getPageModule(view: View): PageModule | undefined {
  return PAGE_MAP.get(view);
}

/** Get all page modules for a role. */
export function getPagesForRole(role: string): PageModule[] {
  return PAGE_REGISTRY.filter((p) => p.roles.includes(role));
}

/** Get all page modules for a section. */
export function getPagesForSection(section: NavSection): PageModule[] {
  return PAGE_REGISTRY.filter((p) => p.section === section);
}
