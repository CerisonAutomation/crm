"use client";
/**
 * Admin Console — six admin views: dashboard, users, audit, pieces/connections,
 * notification centre, feature flags. Desktop-first, editorial Citizen Lane style.
 */
import {
  checkAutomationAlerts,
  getActiveAutomationAlerts,
  acknowledgeAutomationAlert,
} from "@/lib/services/alerts-client";
import { Fragment, useEffect, useState } from "react";
import { format } from "date-fns";
import { api } from "@/lib/api-client";
import { useApp, type View } from "@/lib/store";
import { platformCaseStatusLabel } from "@/lib/settings/registry";
import { usePlatformSettings } from "@/lib/settings/client";
import { FEATURE_DEFAULTS, FEATURE_NOTES } from "@/lib/settings/feature-flags";
import {
  Eyebrow,
  SectionTitle,
  StateBadge,
  StatusBadge,
  Spinner,
  SandboxChip,
} from "@/components/brand/ui";
import { useI18n, type StringKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  useApiData,
  LoadingBlock,
  ErrorBlock,
} from "@/components/brand/data-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TypedConfirmDialog } from "@/components/brand/typed-confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTable, createColumnHelper } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useDebouncedCallback } from "@/hooks";
import { toast } from "@/hooks/use-toast";
import { showUndoToast } from "@/hooks/use-undo-toast";
import { cn } from "@/lib/utils";
import { WebhooksPanel } from "@/features/admin/webhooks-panel";
import { AutopilotPanel } from "@/features/admin/autopilot-panel";
import { QuickActions } from "@/features/admin/quick-actions";
import { N8nWorkflowManager } from "./n8n-workflow-manager";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Download,
  Flag,
  Globe,
  KeyRound,
  MailQuestion,
  Pencil,
  Plus,
  Puzzle,
  RefreshCcw,
  ScrollText,
  ShieldAlert,
  Trash2,
  UserPlus,
  Zap,
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Columns3,
  MoreHorizontal,
  Eye,
  Filter,
  Mail,
  MailPlus,
  Send,
  Table2,
  type LucideIcon,
} from "lucide-react";

// ──────────────────────────────────────────────────────────── shared helpers

type AdminStats = Awaited<ReturnType<typeof api.adminStats>>;
type AdminUser = Awaited<ReturnType<typeof api.adminUsers>>["users"][number];
type AuditEvent = Awaited<ReturnType<typeof api.audit>>["events"][number];
type PieceRow = Awaited<ReturnType<typeof api.pieces>>["pieces"][number];
type ConnectionRow = Awaited<
  ReturnType<typeof api.connections>
>["connections"][number];
type NotificationLog = Awaited<
  ReturnType<typeof api.notificationLogs>
>["logs"][number];
type DlqRow = Awaited<ReturnType<typeof api.notificationLogs>>["dlq"][number];
type FlagRow = Awaited<ReturnType<typeof api.flags>>["flags"][number];
type AdminProgrammeRow = Awaited<
  ReturnType<typeof api.adminProgrammes>
>["programmes"][number];
type MessageTemplateRow = Awaited<
  ReturnType<typeof api.templates>
>["templates"][number];
type AutomationStatus = Awaited<ReturnType<typeof api.automationStatus>>;

const ROLES = ["CLIENT", "RM", "SENIOR_RM", "ADMIN", "AUDITOR"] as const;

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd MMM HH:mm");
  } catch {
    return "—";
  }
}

function fmtDay(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd MMM yyyy");
  } catch {
    return "—";
  }
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function AdminHeader({
  eyebrow,
  title,
  desc,
  actions,
  titleAs,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  actions?: React.ReactNode;
  titleAs?: "h1" | "h2";
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <SectionTitle as={titleAs} className="mt-1.5">
          {title}
        </SectionTitle>
        {desc && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {desc}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">{children}</div>;
}

/** Honest empty state — brand icon chip + one-liner + optional CTA. Never fake data. */
type InlineEmptyProps = {
  icon: LucideIcon;
  message: string;
  ctaLabel?: string;
  onCta?: () => void;
  className?: string;
};

function InlineEmpty({
  icon: Icon,
  message,
  ctaLabel,
  onCta,
  className,
}: InlineEmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-4 py-8 text-center",
        className,
      )}
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/40 bg-gold/10"
        aria-hidden="true"
      >
        <Icon className="h-5 w-5 text-gold-ink" />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>
      {ctaLabel && onCta && (
        <Button variant="outline" size="sm" onClick={onCta}>
          {ctaLabel} <ArrowRight className="ml-1.5 h-3.5 w-3.5 text-gold-ink" />
        </Button>
      )}
    </div>
  );
}

/** Zero-row empty state for tables — keeps the header context, replaces bare emptiness. */
function TableEmptyRow({
  colSpan,
  ...rest
}: InlineEmptyProps & { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="p-0">
        <InlineEmpty {...rest} />
      </TableCell>
    </TableRow>
  );
}

const DATA_CLASS_TONES: Record<string, "neutral" | "sky" | "amber" | "red"> = {
  PUBLIC: "neutral",
  INTERNAL: "sky",
  PII: "amber",
  RESTRICTED: "red",
};

// ──────────────────────────────────────────────────────────── dashboard

const KPI_ITEMS: Array<{ key: string; labelKey?: StringKey; label?: string }> =
  [
    { key: "users", labelKey: "admin.users" },
    { key: "activeCases", label: "Active cases" },
    { key: "failedRuns", label: "Failed runs" },
    { key: "waitingRuns", label: "Waiting approvals" },
    { key: "dlq", label: "Dead letters" },
    { key: "auditEvents", label: "Audit events" },
    { key: "documents", label: "Documents" },
    { key: "publishedPages", label: "Published pages" },
  ];

/** CSV business-intelligence reports served by /api/admin/reports/export. */
const REPORTS = [
  {
    key: "cases",
    label: "Case pipeline",
    desc: "Stage, cycle time, RM load and document health per case",
  },
  {
    key: "rm-load",
    label: "RM load",
    desc: "Active caseload, P1 count and overdue requests per staff member",
  },
  {
    key: "funnel",
    label: "Funnel & SLA",
    desc: "Cases and median age per stage, with overdue SLA counts",
  },
  {
    key: "programmes",
    label: "Programmes",
    desc: "Case mix, fees and complexity by programme",
  },
] as const;

export function AdminDashboard() {
  const setView = useApp((s) => s.setView);
  const { t } = useI18n();
  // Admin-editable status labels resolve settings-first, so the dashboard's
  // "Cases by status" list matches the queue after a rename.
  const { settings } = usePlatformSettings();
  const { data, error, loading, reload } = useApiData(() => api.adminStats());
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [demoResetOpen, setDemoResetOpen] = useState(false);
  const [demoResetBusy, setDemoResetBusy] = useState(false);

  async function runDemoReset() {
    setDemoResetBusy(true);
    try {
      const res = await api.resetDemoData();
      toast({
        title: t("admq.demoResetDone"),
        description: `${res.counts.users} users · ${res.counts.cases} cases · ${res.counts.documents} documents restored.`,
      });
      setDemoResetOpen(false);
      reload();
    } catch (e) {
      toast({
        title: t("admq.demoResetFail"),
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDemoResetBusy(false);
    }
  }

  async function exportReport(report: (typeof REPORTS)[number]["key"]) {
    setReportBusy(report);
    try {
      const csv = await api.reportExport(report);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `citizen-lane-${report}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Export ready",
        description: `citizen-lane-${report} downloaded.`,
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setReportBusy(null);
    }
  }

  if (loading)
    return (
      <PageShell>
        <AdminHeader
          titleAs="h1"
          eyebrow={t("nav.section.admin")}
          title={t("nav.overview")}
        />
        <LoadingBlock />
      </PageShell>
    );
  if (error || !data)
    return (
      <PageShell>
        <AdminHeader
          titleAs="h1"
          eyebrow={t("nav.section.admin")}
          title={t("nav.overview")}
        />
        <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} />
      </PageShell>
    );

  const stats = data.stats;
  const num = (k: string) => stats[k] ?? 0;
  const maxStatus = Math.max(1, ...data.casesByStatus.map((c) => c.count));
  const byStatus = [...data.casesByStatus].sort((a, b) => b.count - a.count);

  return (
    <PageShell>
      <AdminHeader
        titleAs="h1"
        eyebrow={t("nav.section.admin")}
        title={t("adm.overviewTitle")}
        desc={t("adm.overviewDesc")}
        actions={<SandboxChip label="Sandbox platform" />}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {KPI_ITEMS.map((k) => (
          <Card
            key={k.key}
            className="group gap-0 rounded-md border-border px-5 py-5 transition-all duration-200 hover:border-gold/60 hover:shadow-md hover:-translate-y-0.5"
          >
            <p className="font-editorial text-3xl tabular-nums text-cobble-ink transition-colors group-hover:text-gold-ink">
              {num(k.key)}
            </p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {k.labelKey ? t(k.labelKey) : k.label}
            </p>
          </Card>
        ))}
      </div>

      {/* Danger zone — rebuild the sandbox dataset from the canonical seeds. */}
      <Card className="mt-6 gap-0 rounded-md border-danger/40 bg-danger/5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>{t("admq.demoReset")}</Eyebrow>
            <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
              Restore the documented sandbox state
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Re-runs the canonical seed passes in order, overwriting drifted
              demo data. Admin-only and audit-logged.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDemoResetOpen(true)}
            disabled={demoResetBusy}
            className="shrink-0 border-danger/40 text-danger-ink hover:bg-danger/10 hover:text-danger-ink"
          >
            {demoResetBusy ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">{t("admq.demoReset")}</span>
          </Button>
        </div>
      </Card>

      <AlertDialog open={demoResetOpen} onOpenChange={setDemoResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admq.demoReset")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admq.demoResetConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={demoResetBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runDemoReset();
              }}
              disabled={demoResetBusy}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
            >
              {demoResetBusy ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                t("admq.demoReset")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Quick actions — six tiles into the most common admin flows (hints from live stats) */}
      <div className="mt-6">
        <QuickActions
          stats={{
            users: num("users"),
            activeCases: num("activeCases"),
            auditEvents: num("auditEvents"),
            publishedPages: num("publishedPages"),
            publishedWorkflows: data.workflows.filter(
              (w) => w.status === "PUBLISHED",
            ).length,
            draftWorkflows: data.workflows.filter(
              (w) => w.status !== "PUBLISHED",
            ).length,
          }}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Workflow health */}
        <Card className="min-w-0 gap-0 rounded-md border-border p-6">
          <Eyebrow>Workflow health</Eyebrow>
          <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
            Published &amp; draft workflows
          </h3>
          <div className="mt-4 max-h-64 space-y-3 overflow-y-auto pr-1">
            {data.workflows.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 py-2">
                <p className="text-sm text-muted-foreground">
                  No workflows yet — publish one to automate client journeys.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView("studio-workflows")}
                >
                  Open Workflow Studio{" "}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5 text-gold-ink" />
                </Button>
              </div>
            )}
            {data.workflows.map((w) => (
              <button
                key={w.id}
                onClick={() => setView("studio-workflows")}
                className="group flex w-full items-center justify-between gap-3 rounded border border-transparent px-2 py-2 text-left transition-all duration-200 hover:border-border hover:bg-muted/40 hover:translate-x-0.5 active:translate-x-0 active:scale-[0.99]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-cobble-ink group-hover:text-gold-ink transition-colors">
                    {w.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Version {w.currentVersion}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {w.disabled && <StatusBadge status="Disabled" tone="red" />}
                  <StateBadge state={w.status} />
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* Cases by status */}
        <Card className="min-w-0 gap-0 rounded-md border-border p-6">
          <Eyebrow>Cases by status</Eyebrow>
          <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
            Pipeline distribution
          </h3>
          <div className="mt-4 max-h-64 space-y-3 overflow-y-auto pr-1">
            {byStatus.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 py-2">
                <p className="text-sm text-muted-foreground">
                  No cases yet — new client applications appear here.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView("rm-queue")}
                >
                  Open case queue{" "}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5 text-gold-ink" />
                </Button>
              </div>
            )}
            {byStatus.map((c) => (
              <div key={c.status} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate text-sm text-iron-ink">
                  {platformCaseStatusLabel(settings, c.status)}
                </span>
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-gold"
                    style={{
                      width: `${Math.round((c.count / maxStatus) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm tabular-nums text-cobble-ink">
                  {c.count}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent audit */}
        <Card className="min-w-0 gap-0 rounded-md border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <Eyebrow>Recent audit</Eyebrow>
              <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
                Latest recorded actions
              </h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView("admin-audit")}
            >
              Open explorer <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="mt-4 max-h-64 space-y-2.5 overflow-y-auto pr-1">
            {data.recentAudit.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 py-2">
                <p className="text-sm text-muted-foreground">
                  No audit events recorded yet.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView("admin-audit")}
                >
                  Open audit explorer{" "}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5 text-gold-ink" />
                </Button>
              </div>
            )}
            {data.recentAudit.map((a) => (
              <div
                key={a.id}
                className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {/* overflow-wrap:anywhere — audit actions/targets are long
                      unbreakable tokens (workflow.run.x, run IDs); without it
                      their min-content forces the card (and the page) wider
                      than the viewport on mobile. */}
                  <span className="text-sm font-medium text-cobble-ink">
                    {truncate(a.action, 34)}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {truncate(a.target, 30)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs text-iron-ink">
                    {truncate(a.actorLabel, 22)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {fmtDate(a.createdAt)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* The "Jump to a console" grid that used to sit here duplicated the six
            Quick actions tiles above: Workflow Studio, Users, Audit, Automation,
            Lane Pages and the case queue all appeared in both. Two overlapping
            navigation grids gave the admin sixteen equally-weighted buttons with
            no signal about where to start, so the duplicate was removed and the
            sidebar remains the canonical way to reach every console. */}
      </div>

      {/* Reports — CSV business-intelligence export (org-scoped, audit.read-gated) */}
      <Card className="mt-6 gap-0 rounded-md border-border p-6">
        <Eyebrow>Reports</Eyebrow>
        <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
          Export business intelligence
        </h3>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Spreadsheet-ready CSVs scoped to your organisation — pipeline,
          workload, funnel SLA and programme mix.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {REPORTS.map((r) => (
            <div
              key={r.key}
              className="flex flex-col justify-between gap-3 rounded-md border border-border/70 bg-card/60 p-4"
            >
              <div>
                <p className="text-sm font-semibold text-cobble-ink">
                  {r.label}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {r.desc}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="justify-center"
                disabled={reportBusy !== null}
                onClick={() => void exportReport(r.key)}
              >
                <Download
                  className={cn(
                    "mr-2 h-4 w-4",
                    reportBusy === r.key && "animate-pulse",
                  )}
                />
                {reportBusy === r.key ? "Exporting…" : "Download CSV"}
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────── users

const ROLE_SCOPE: Record<string, string> = {
  CLIENT: "Own case, documents, requests and messages — no staff tooling.",
  RM: "All cases: approvals, document review, requests, dispatch and run approvals.",
  SENIOR_RM: "Full RM scope, plus workflow authoring, drafts and publishing.",
  ADMIN:
    "Complete platform administration — users, pieces, connections, flags, audit.",
  AUDITOR: "Read-only oversight of cases, workflows, runs and the audit trail.",
};

// audience grouping — ADMIN / STAFF (RM, SENIOR_RM, AUDITOR) / CLIENT
type Audience = "ALL" | "ADMIN" | "STAFF" | "CLIENT";

const STAFF_ROLES = new Set(["RM", "SENIOR_RM", "AUDITOR"]);

const AUDIENCE_FILTERS: Array<{ key: Audience; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "ADMIN", label: "Administrator" },
  { key: "STAFF", label: "Staff" },
  { key: "CLIENT", label: "Clients" },
];

const AUDIENCE_GROUPS: Array<{
  key: "ADMIN" | "STAFF" | "CLIENT";
  label: string;
}> = [
  { key: "ADMIN", label: "Administrator" },
  {
    key: "STAFF",
    label: "Staff — Relationship Managers, Senior RMs, Auditors",
  },
  { key: "CLIENT", label: "Clients" },
];

const ROLE_GROUPS: Array<{
  label: string;
  roles: Array<(typeof ROLES)[number]>;
}> = [
  { label: "Administrator", roles: ["ADMIN"] },
  { label: "Staff", roles: ["RM", "SENIOR_RM", "AUDITOR"] },
  { label: "Client", roles: ["CLIENT"] },
];

function audienceOf(role: string): "ADMIN" | "STAFF" | "CLIENT" {
  if (role === "ADMIN") return "ADMIN";
  return STAFF_ROLES.has(role) ? "STAFF" : "CLIENT";
}

/** Escalation tier → badge tone for dead-letter queue rows. */
function severityTone(severity: string): "red" | "amber" | "neutral" {
  if (severity === "CRITICAL") return "red";
  if (severity === "HIGH") return "amber";
  return "neutral";
}

export function AdminUsers() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApiData(() => api.adminUsers());
  const [roleChange, setRoleChange] = useState<{
    user: AdminUser;
    next: string;
  } | null>(null);
  const [statusChange, setStatusChange] = useState<{
    user: AdminUser;
    next: string;
  } | null>(null);
  const [revoke, setRevoke] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({
    name: "",
    email: "",
    role: "CLIENT",
    reason: "",
  });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>("ALL");

  const openRole = (user: AdminUser, next: string) => {
    setReason("");
    setRoleChange({ user, next });
  };
  const openStatus = (user: AdminUser, next: string) => {
    setReason("");
    setStatusChange({ user, next });
  };
  const openRevoke = (user: AdminUser) => {
    setReason("");
    setRevoke(user);
  };

  // audience grouping — counts per group + the filtered slice
  const users = data?.users ?? [];
  const audienceCounts: Record<Audience, number> = {
    ALL: users.length,
    ADMIN: 0,
    STAFF: 0,
    CLIENT: 0,
  };
  for (const u of users) audienceCounts[audienceOf(u.role)] += 1;
  const visibleUsers =
    audience === "ALL"
      ? users
      : users.filter((u) => audienceOf(u.role) === audience);

  async function confirmRole() {
    if (!roleChange || reason.trim().length < 3) return;
    const previousRole = roleChange.user.role;
    setBusyId(roleChange.user.id);
    try {
      await api.updateUser({
        id: roleChange.user.id,
        role: roleChange.next,
        reason: reason.trim(),
      });
      showUndoToast({
        title: "Role updated",
        description: `${roleChange.user.name} is now ${roleChange.next}.`,
        onUndo: async () => {
          try {
            await api.updateUser({
              id: roleChange.user.id,
              role: previousRole,
              reason: "Undo role change",
            });
            toast({
              title: "Role change undone",
              description: `${roleChange.user.name} reverted to ${previousRole}.`,
            });
          } catch {
            toast({
              title: "Undo failed",
              description: "Could not revert role change.",
              variant: "destructive",
            });
          }
        },
        undoLabel: "Undo",
        duration: 10_000,
      });
      setRoleChange(null);
      await reload();
    } catch (e) {
      toast({
        title: "Role change failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmStatus() {
    if (!statusChange || reason.trim().length < 3) return;
    setBusyId(statusChange.user.id);
    try {
      await api.updateUser({
        id: statusChange.user.id,
        status: statusChange.next,
        reason: reason.trim(),
      });
      toast({
        title:
          statusChange.next === "DEACTIVATED"
            ? "User deactivated"
            : "User reactivated",
        description: statusChange.user.name,
      });
      setStatusChange(null);
      await reload();
    } catch (e) {
      toast({
        title: "Status change failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRevoke() {
    if (!revoke || reason.trim().length < 3) return;
    setBusyId(revoke.id);
    try {
      const res = await api.revokeSessions(revoke.id, reason.trim());
      toast({
        title: "Sessions revoked",
        description: `${res.revoked} session(s) terminated for ${revoke.name}.`,
      });
      setRevoke(null);
      await reload();
    } catch (e) {
      toast({
        title: "Revoke failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function submitInvite() {
    if (
      !invite.name.trim() ||
      !invite.email.trim() ||
      invite.reason.trim().length < 3
    ) {
      toast({
        title: "Missing details",
        description: "Name, email and a reason are required.",
        variant: "destructive",
      });
      return;
    }
    setInviteBusy(true);
    try {
      const res = await api.inviteUser({
        name: invite.name.trim(),
        email: invite.email.trim(),
        role: invite.role,
        reason: invite.reason.trim(),
      });
      setInviteOpen(false);
      setTempPassword({ email: res.user.email, password: res.tempPassword });
      setInvite({ name: "", email: "", role: "CLIENT", reason: "" });
      await reload();
    } catch (e) {
      toast({
        title: "Invite failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setInviteBusy(false);
    }
  }

  function copyPassword() {
    if (!tempPassword) return;
    void navigator.clipboard?.writeText(tempPassword.password);
    toast({
      title: "Copied",
      description: "Temporary password copied to clipboard.",
    });
  }

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("nav.section.admin")}
        title={t("adm.usersTitle")}
        desc={t("adm.usersDesc")}
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" /> {t("admin.inviteUser")}
          </Button>
        }
      />

      {/* audience filter chips — ALL / ADMIN / STAFF / CLIENT with live counts */}
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("adm.filterAudience")}
      >
        {AUDIENCE_FILTERS.map((f) => (
          <Button
            key={f.key}
            variant="ghost"
            size="sm"
            aria-pressed={audience === f.key}
            onClick={() => setAudience(f.key)}
            className={cn(
              "h-8 rounded-full border px-3.5 text-[11px] font-semibold uppercase tracking-[0.14em]",
              audience === f.key
                ? "border-gold/60 bg-gold/15 text-amber-ink hover:bg-gold/20"
                : "border-border text-muted-foreground hover:text-cobble-ink",
            )}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums">{audienceCounts[f.key]}</span>
          </Button>
        ))}
      </div>

      {loading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} />
      ) : (
        <>
          <Card className="gap-0 rounded-md border-border p-0">
            <div className="overflow-x-auto">
              <DataTable
                columns={[
                  createColumnHelper<any>().accessor("name", {
                    header: "Name",
                    cell: ({ row }) => (
                      <TableCell className="text-sm font-medium text-cobble-ink">
                        {row.name}
                      </TableCell>
                    ),
                  }),
                  createColumnHelper<any>().accessor("email", {
                    header: "Email",
                    cell: ({ row }) => (
                      <TableCell className="text-sm text-muted-foreground truncate w-36">
                        {row.email}
                      </TableCell>
                    ),
                  }),
                  createColumnHelper<any>().accessor("role", {
                    header: "Role",
                    cell: ({ row }) => (
                      <TableCell>
                        <Badge
                          variant={
                            row.role === "ADMIN" ? "destructive" : "secondary"
                          }
                          className="text-xs"
                        >
                          {row.role}
                        </Badge>
                      </TableCell>
                    ),
                  }),
                  createColumnHelper<any>()
                    .accessor("status", {
                      header: "Status",
                      cell: ({ row }) => (
                        <TableCell>
                          <StateBadge state={row.status} />
                        </TableCell>
                      ),
                    }),
                  createColumnHelper<any>().accessor("lastSeenAt", {
                    header: "Last seen",
                    cell: ({ row }) => (
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {row.lastSeenAt ? fmtDay(row.lastSeenAt) : "Never"}
                      </TableCell>
                    ),
                  }),
                  createColumnHelper<any>().accessor("id", {
                    header: "Actions",
                    cell: ({ row }) => (
                      <TableCell className="text-right text-xs">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="p-1">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-[8rem]">
                            <DropdownMenuItem
                              onClick={() => void handleInviteUser(row.email)}
                              disabled={
                                inviting === row.id || !isEditionAllowed()
                              }
                            >
                              {inviting === row.id ? (
                                <Spinner className="mr-2 h-3 w-3" />
                              ) : (
                                <Mail className="mr-2 h-3 w-3" />
                              )}
                              Resend invite
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void handleDeleteUser(row.id)}
                              className="text-danger"
                              disabled={
                                deleting === row.id || !isEditionAllowed()
                              }
                            >
                              {deleting === row.id ? (
                                <Spinner className="mr-2 h-3 w-3" />
                              ) : (
                                <Trash2 className="mr-2 h-3 w-3" />
                              )}
                              Delete user
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    ),
                  }),
                ]}
                data={users}
                enableSorting={true}
                enablePagination={true}
                pageSize={usersPageSize}
                className="w-full"
                emptyMessage="No users yet"
              />
            </div>
          </Card>

          {/* Role matrix */}
          <Card className="mt-6 gap-0 rounded-md border-border p-6">
            <Eyebrow>Role matrix</Eyebrow>
            <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
              Capability scope by role
            </h3>
            <div className="mt-4 overflow-x-auto">
              <DataTable
                columns={[
                  createColumnHelper<any>().accessor("role", {
                    header: "Role",
                    cell: ({ row }) => row.replace("_", " "),
                  }),
                  createColumnHelper<any>().accessor("scope", {
                    header: "Scope",
                    cell: ({ row }) => ROLE_SCOPE[row],
                  }),
                ]}
                data={ROLES}
                enableSorting={false}
                enablePagination={false}
                className="w-full"
              />
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-ink" />
              Deny-by-default: any capability not explicitly listed for a role
              is refused at the API boundary — including for administrators of
              other organisations.
            </p>
          </Card>
        </>
      )}

      {/* Role change confirm */}
      <AlertDialog
        open={!!roleChange}
        onOpenChange={(o) => !o && setRoleChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Change role for {roleChange?.user.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              New role:{" "}
              <span className="font-semibold text-cobble-ink">
                {roleChange?.next.replace("_", " ")}
              </span>
              . The user&apos;s capabilities change immediately and the previous
              role is recorded in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="role-reason">Reason (required)</Label>
            <Textarea
              id="role-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("adm.roleReasonPh")}
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                reason.trim().length < 3 || busyId === roleChange?.user.id
              }
              onClick={(e) => {
                e.preventDefault();
                void confirmRole();
              }}
            >
              Confirm role change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Status change confirm */}
      <AlertDialog
        open={!!statusChange}
        onOpenChange={(o) => !o && setStatusChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusChange?.next === "DEACTIVATED"
                ? `Deactivate ${statusChange?.user.name}?`
                : `Reactivate ${statusChange?.user.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusChange?.next === "DEACTIVATED"
                ? "Deactivated users cannot sign in. Their cases and audit history are preserved."
                : "The user will be able to sign in again with their existing credentials."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="status-reason">Reason (required)</Label>
            <Textarea
              id="status-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("adm.acctStateReasonPh")}
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                reason.trim().length < 3 || busyId === statusChange?.user.id
              }
              onClick={(e) => {
                e.preventDefault();
                void confirmStatus();
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke sessions confirm */}
      <AlertDialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke all sessions for {revoke?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every active sign-in for this user is terminated immediately. They
              can sign in again if their account is active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="revoke-reason">Reason (required)</Label>
            <Textarea
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. suspected credential compromise"
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reason.trim().length < 3 || busyId === revoke?.id}
              onClick={(e) => {
                e.preventDefault();
                void confirmRevoke();
              }}
            >
              {t("admin.revokeSessions")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>
              A temporary password is generated and shown once after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Full name</Label>
              <Input
                id="invite-name"
                value={invite.name}
                onChange={(e) => setInvite({ ...invite, name: e.target.value })}
                placeholder="Anna Meier"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={invite.email}
                onChange={(e) =>
                  setInvite({ ...invite, email: e.target.value })
                }
                placeholder="anna@citizenlane.ch"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={invite.role}
                onValueChange={(v) => setInvite({ ...invite, role: v })}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={t("adm.inviteRole")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_GROUPS.map((g) => (
                    <SelectGroup key={g.label}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {g.roles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {ROLE_SCOPE[invite.role]}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-reason">Reason (required)</Label>
              <Textarea
                id="invite-reason"
                value={invite.reason}
                onChange={(e) =>
                  setInvite({ ...invite, reason: e.target.value })
                }
                placeholder={t("adm.acctCreateReasonPh")}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitInvite()} disabled={inviteBusy}>
              {inviteBusy && <Spinner className="mr-2 h-3.5 w-3.5" />} Create
              user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Temporary password dialog */}
      <Dialog
        open={!!tempPassword}
        onOpenChange={(o) => !o && setTempPassword(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>User created</DialogTitle>
            <DialogDescription>
              Temporary password for{" "}
              <span className="font-medium text-cobble-ink">
                {tempPassword?.email}
              </span>
              :
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-gold/50 bg-gold/10 px-4 py-3">
            <p className="select-all font-mono text-lg tracking-wider text-cobble-ink">
              {tempPassword?.password}
            </p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Share via a secure channel; shown once. The user is asked to change
            it at first sign-in.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={copyPassword}>
              {t("admin.copyPassword")}
            </Button>
            <Button onClick={() => setTempPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────── audit

export function AdminAudit() {
  const { t } = useI18n();
  // Rows per page comes from the platform settings (settings.governance.
  // auditPageSize); a stored value is merged over canon and the server applies
  // the same value, always capped at AUDIT_PAGE_SIZE_MAX. Reading it here keeps
  // the page count in step with the rows the API actually returns.
  const { settings } = usePlatformSettings();
  const auditPageSize = settings.governance.auditPageSize;
  const [actionQ, setActionQ] = useState("");
  const [actorQ, setActorQ] = useState("");
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const runAudit = useDebouncedCallback(
    (action: string, actor: string, p: number) => {
      setLoading(true);
      api
        .audit({
          action: action || undefined,
          actor: actor || undefined,
          page: p,
        })
        .then((r) => {
          setEvents(r.events);
          setTotal(r.total);
        })
        .catch((e: unknown) =>
          toast({
            title: "Audit query failed",
            description: e instanceof Error ? e.message : "Unknown error",
            variant: "destructive",
          }),
        )
        .finally(() => setLoading(false));
    },
    300,
  );

  useEffect(() => {
    runAudit(actionQ, actorQ, page);
  }, [actionQ, actorQ, page, runAudit]);

  const totalPages = Math.max(1, Math.ceil(total / auditPageSize));

  async function exportCsv() {
    setExporting(true);
    try {
      const csv = await api.auditExport();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "citizen-lane-audit.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Export ready",
        description: "citizen-lane-audit.csv downloaded.",
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("nav.section.admin")}
        title={t("adm.auditTitle")}
        desc={t("adm.auditDesc")}
        actions={
          <Button
            variant="outline"
            onClick={() => void exportCsv()}
            disabled={exporting}
          >
            <Download className="mr-2 h-4 w-4" />{" "}
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="audit-action">Action contains</Label>
          <Input
            id="audit-action"
            value={actionQ}
            placeholder="e.g. document."
            className="w-56"
            onChange={(e) => {
              setActionQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-actor">Actor contains</Label>
          <Input
            id="audit-actor"
            value={actorQ}
            placeholder="e.g. Meier"
            className="w-56"
            onChange={(e) => {
              setActorQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          {total} event{total === 1 ? "" : "s"} · page {page} of {totalPages} ·
          append-only · capped 500 rows per export
        </p>
      </div>

      <Card className="gap-0 rounded-md border-border p-0">
        <div className="overflow-x-auto">
          <DataTable
            columns={[
              createColumnHelper<any>().accessor("createdAt", {
                header: "Time",
                cell: ({ row }) => (
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {fmtDate(row.createdAt)}
                  </TableCell>
                ),
              }),
              createColumnHelper<any>().accessor("actorLabel", {
                header: "Actor",
                cell: ({ row }) => (
                  <TableCell className="text-sm text-cobble-ink">
                    {truncate(row.actorLabel, 24)}
                  </TableCell>
                ),
              }),
              createColumnHelper<any>().accessor("action", {
                header: "Action",
                cell: ({ row }) => (
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-gold/50 font-mono text-[10px] text-amber-ink"
                    >
                      {truncate(row.action, 24)}
                    </Badge>
                  </TableCell>
                ),
              }),
              createColumnHelper<any>().accessor("target", {
                header: "Target",
                cell: ({ row }) => (
                  <TableCell className="text-sm text-iron-ink">
                    {truncate(row.target, 26)}
                  </TableCell>
                ),
              }),
              createColumnHelper<any>().accessor("reason", {
                header: "Reason",
                cell: ({ row }) => (
                  <TableCell className="text-xs text-muted-foreground">
                    {truncate(row.reason, 40)}
                  </TableCell>
                ),
              }),
              createColumnHelper<any>().accessor("id", {
                header: "Change",
                cell: ({ row }) => (
                  <TableCell>
                    {!row.before && !row.after ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            aria-label={`Show state change for ${row.action}`}
                          >
                            before → after
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-96 max-h-80 overflow-y-auto"
                          align="end"
                        >
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            Before
                          </p>
                          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-iron-ink">
                            {parsePretty(row.before) ?? "(empty)"}
                          </pre>
                          <div className="my-3 h-px bg-border" />
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            After
                          </p>
                          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-cobble-ink">
                            {parsePretty(row.after) ?? "(empty)"}
                          </pre>
                          <p className="mt-3 text-[10px] text-muted-foreground">
                            Redacted server-side before display.
                          </p>
                        </PopoverContent>
                      </Popover>
                    )}
                  </TableCell>
                ),
              }),
            ]}
            data={events}
            enableSorting={true}
            enablePagination={false}
            className="w-full"
            emptyMessage={
              actionQ.trim() || actorQ.trim()
                ? "No audit events match the current filters."
                : "No audit events recorded yet — consequential actions appear here as the platform is used."
            }
          />
        </div>
      </Card>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </PageShell>
  );
}

function parsePretty(s: string | null): string | null {
  if (!s) return null;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

// ──────────────────────────────────────────────────────────── pieces & connections

export function AdminPieces() {
  const setView = useApp((s) => s.setView);
  const { t } = useI18n();
  const piecesApi = useApiData(() => api.pieces());
  const connApi = useApiData(() => api.connections());
  const [toggle, setToggle] = useState<{
    piece: PieceRow;
    next: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [rotating, setRotating] = useState<string | null>(null);

  async function confirmToggle() {
    if (!toggle) return;
    setBusy(true);
    try {
      await api.togglePiece(
        toggle.piece.key,
        toggle.next,
        reason.trim() || undefined,
      );
      toast({
        title: toggle.next ? "Piece enabled" : "Piece disabled",
        description: toggle.piece.name,
      });
      setToggle(null);
      setReason("");
      await piecesApi.reload();
    } catch (e) {
      toast({
        title: "Toggle failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function rotate(c: ConnectionRow) {
    setRotating(c.id);
    try {
      const res = (await api.rotateConnection(c.id)) as {
        connection?: { id: string; maskedHint: string };
      } | null;
      toast({
        title: t("admin.secretRotated"),
        description: res?.connection
          ? `New reference: ${res.connection.maskedHint}`
          : `${c.name} rotated.`,
      });
      await connApi.reload();
    } catch (e) {
      toast({
        title: "Rotation failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRotating(null);
    }
  }

  const soonThreshold = Date.now() + 30 * 86400000;

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("nav.section.admin")}
        title={t("adm.piecesTitle")}
        desc={t("adm.piecesDesc")}
      />

      {/* Piece allowlist */}
      <Eyebrow>Piece allowlist</Eyebrow>
      <h3 className="mb-3 mt-1 font-editorial text-lg text-cobble-ink">
        Pieces available to workflows
      </h3>
      {piecesApi.loading ? (
        <LoadingBlock />
      ) : piecesApi.error || !piecesApi.data ? (
        <ErrorBlock
          message={piecesApi.error ?? "Unknown error"}
          onRetry={piecesApi.reload}
        />
      ) : (
        <Card className="gap-0 rounded-md border-border p-0">
          <div className="overflow-x-auto">
            <DataTable
              columns={[
                createColumnHelper<any>().accessor("key", { header: "Key" }),
                createColumnHelper<any>().accessor("name", {
                  header: "Name",
                  cell: ({ row }) => (
                    <>
                      <p className="text-sm font-medium text-cobble-ink">
                        {row.name}
                      </p>
                      <p className="max-w-64 truncate text-xs text-muted-foreground">
                        {row.description}
                      </p>
                    </>
                  ),
                }),
                createColumnHelper<any>().accessor("category", {
                  header: "Category",
                  cell: ({ row }) => (
                    <Badge variant="outline" className="text-[10px]">
                      {row.category}
                    </Badge>
                  ),
                }),
                createColumnHelper<any>().accessor("dataClass", {
                  header: "Data class",
                  cell: ({ row }) => (
                    <StatusBadge
                      status={row.dataClass}
                      tone={DATA_CLASS_TONES[row.dataClass] ?? "neutral"}
                    />
                  ),
                }),
                createColumnHelper<any>().accessor("authReq", {
                  header: "Auth",
                  cell: ({ row }) => (
                    <TableCell className="text-xs text-muted-foreground">
                      {row.authReq}
                    </TableCell>
                  ),
                }),
                createColumnHelper<any>().accessor("enabled", {
                  header: "Enabled",
                  cell: ({ row }) => (
                    <TableCell className="text-right">
                      <Switch
                        checked={row.enabled}
                        aria-label={`Toggle piece ${row.name}`}
                        onCheckedChange={(next) => {
                          setReason("");
                          setToggle({ piece: row, next });
                        }}
                      />
                    </TableCell>
                  ),
                }),
              ]}
              data={piecesApi.data.pieces}
              enableSorting={true}
              enablePagination={false}
              className="w-full"
              emptyMessage="No pieces in the allowlist — the workflow palette would be empty."
            />
          </div>
        </Card>
      )}

      {/* Connections vault */}
      <div className="mt-10">
        <Eyebrow>Connections vault</Eyebrow>
        <h3 className="mb-3 mt-1 font-editorial text-lg text-cobble-ink">
          Encrypted integration credentials
        </h3>
        {connApi.loading ? (
          <LoadingBlock />
        ) : connApi.error || !connApi.data ? (
          <ErrorBlock
            message={connApi.error ?? "Unknown error"}
            onRetry={connApi.reload}
          />
        ) : (
          <Card className="gap-0 rounded-md border-border p-0">
            <div className="overflow-x-auto">
              <DataTable
                columns={[
                  createColumnHelper<any>().accessor("name", { header: "Name" }),
                  createColumnHelper<any>()
                    .accessor("pieceKey", {
                      header: "Piece",
                      cell: ({ row }) => (
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.pieceKey}
                        </TableCell>
                      ),
                    }),
                  createColumnHelper<any>()
                    .accessor("maskedHint", {
                      header: "Secret ref",
                      cell: ({ row }) => (
                        <TableCell className="font-mono text-xs text-iron-ink">
                          {row.maskedHint}
                        </TableCell>
                      ),
                    }),
                  createColumnHelper<any>()
                    .accessor("scopes", {
                      header: "Scopes",
                      cell: ({ row }) => {
                        let scopes: string[] = [];
                        try {
                          const parsed: unknown = JSON.parse(row.scopes);
                          if (Array.isArray(parsed))
                            scopes = parsed.filter(
                              (s): s is string => typeof s === "string",
                            );
                        } catch {
                          scopes = [];
                        }
                        return (
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {scopes.length === 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {" "}
                                  —{" "}
                                </span>
                              )}
                              {scopes.map((s) => (
                                <Badge
                                  key={s}
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {s}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        );
                      },
                    }),
                  createColumnHelper<any>().accessor("owner", { header: "Owner" }),
                  createColumnHelper<any>()
                    .accessor("status", {
                      header: "Status",
                      cell: ({ row }) => (
                        <TableCell>
                          <StateBadge state={row.status} />
                        </TableCell>
                      ),
                    }),
                  createColumnHelper<any>()
                    .accessor("expiresAt", {
                      header: "Expires",
                      cell: ({ row }) => {
                        const expiringSoon =
                          !!row.expiresAt &&
                          new Date(row.expiresAt).getTime() < soonThreshold;
                        return (
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="whitespace-nowrap text-xs text-muted-foreground">
                                {fmtDay(row.expiresAt)}
                              </span>
                              {expiringSoon && (
                                <StatusBadge status="Rotate soon" tone="amber" />
                              )}
                            </div>
                          </TableCell>
                        );
                      },
                    }),
                  createColumnHelper<any>()
                    .accessor("id", {
                      header: "Rotate",
                      cell: ({ row }) => (
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={rotating === row.id}
                            onClick={() => void rotate(row)}
                            aria-label={`Rotate secret for ${row.name}`}
                          >
                            {rotating === row.id ? (
                              <Spinner className="mr-2 h-3 w-3" />
                            ) : (
                              <RefreshCcw className="mr-1.5 h-3 w-3" />
                            )}
                            Rotate secret
                          </Button>
                        </TableCell>
                      ),
                    }),
                ]}
                data={connApi.data.connections}
                enableSorting={true}
                enablePagination={false}
                className="w-full"
                emptyMessage="No vault connections yet — connector credentials appear here once stored."
              />
            </div>
          </Card>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Secrets stored as encrypted references — never displayed. Rotation
          replaces the vault reference and refreshes the masked hint.
        </p>
      </div>

      {/* Toggle confirm */}
      <AlertDialog open={!!toggle} onOpenChange={(o) => !o && setToggle(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggle?.next ? "Enable" : "Disable"} piece “{toggle?.piece.name}
              ”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggle?.next
                ? "Workflows will be able to use this piece again on their next run."
                : "Disabled pieces cannot be added to drafts and are skipped by the executor — running workflows referencing this piece may fail."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="piece-reason">
              Reason (optional, recorded in audit)
            </Label>
            <Textarea
              id="piece-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder={t("adm.pieceReasonPh")}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void confirmToggle();
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────── notifications

const CHANNEL_TONES: Record<string, "neutral" | "sky" | "amber"> = {
  IN_APP: "neutral",
  EMAIL: "sky",
  PUSH: "amber",
};

export function AdminNotifications() {
  const setView = useApp((s) => s.setView);
  const { t } = useI18n();
  // The quiet-hours window is a platform setting, not a fact about this page:
  // state the configured value rather than a copy that drifts from the default.
  const { settings } = usePlatformSettings();
  const { data, error, loading, reload } = useApiData(() =>
    api.notificationLogs(),
  );
  const [retrying, setRetrying] = useState<string | null>(null);

  async function retry(n: NotificationLog) {
    setRetrying(n.id);
    try {
      await api.retryNotification(n.id);
      toast({
        title: "Retry queued",
        description: `“${truncate(n.title, 40)}” re-sent via ${n.channel}.`,
      });
      await reload();
    } catch (e) {
      toast({
        title: "Retry failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRetrying(null);
    }
  }

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("nav.section.admin")}
        title={t("adm.notificationsTitle")}
        desc={t("adm.notificationsDesc")}
      />

      {loading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          {/* min-w-0: the grid item's automatic minimum would otherwise be the
              table's min-content (≈780px, whitespace-nowrap cells), which blew
              the page out horizontally on phones. With min-w-0 the item shrinks
              to the track and the inner overflow-x-auto does the scrolling. */}
          <Card className="min-w-0 max-w-full gap-0 rounded-md border-border p-0 xl:col-span-2">
            <div className="border-b border-border/60 px-6 py-4">
              <Eyebrow>Delivery log</Eyebrow>
              <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
                Most recent 100 notifications
              </h3>
            </div>
            <div className="min-w-0 max-h-125 overflow-y-auto">
              <div className="overflow-x-auto">
                <DataTable
                  columns={[
                    createColumnHelper<any>().accessor("createdAt", {
                      header: "Time",
                      cell: ({ row }) => (
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDate(row.createdAt)}
                        </TableCell>
                      ),
                    }),
                    createColumnHelper<any>().accessor("user", {
                      header: "User",
                      cell: ({ row }) => (
                        <>
                          <p className="text-sm text-cobble-ink">
                            {row.user.name}
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {row.user.role.replace("_", " ")}
                          </p>
                        </>
                      ),
                    }),
                    createColumnHelper<any>().accessor("title", {
                      header: "Title",
                      cell: ({ row }) => (
                        <TableCell className="text-sm text-iron-ink">
                          {truncate(row.title, 44)}
                        </TableCell>
                      ),
                    }),
                    createColumnHelper<any>().accessor("channel", {
                      header: "Channel",
                      cell: ({ row }) => (
                        <TableCell>
                          <StatusBadge
                            status={row.channel.replace("_", "-")}
                            tone={CHANNEL_TONES[row.channel] ?? "neutral"}
                          />
                        </TableCell>
                      ),
                    }),
                    createColumnHelper<any>().accessor("status", {
                      header: "Status",
                      cell: ({ row }) => (
                        <TableCell>
                          <StateBadge state={row.status} />
                        </TableCell>
                      ),
                    }),
                    createColumnHelper<any>().accessor("id", {
                      header: "Retry",
                      cell: ({ row }) => (
                        <TableCell className="text-right">
                          {row.status === "FAILED" ||
                          row.status === "DEAD_LETTER" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={retrying === row.id}
                              onClick={() => void retry(row)}
                              aria-label={`Retry notification ${row.title}`}
                            >
                              {retrying === row.id ? (
                                <Spinner className="h-3 w-3" />
                              ) : (
                                "Retry"
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                      ),
                    }),
                  ]}
                  data={data.logs}
                  enableSorting={true}
                  enablePagination={false}
                  className="w-full"
                  emptyMessage="No notifications sent yet — they appear here as workflows dispatch emails, in-app messages, and push notifications."
                />
              </div>
            </div>
          </Card>

          {/* min-w-0 on the side column too: its own min-content (the DLQ
              panel's header row) was setting the track width at ≤375px. */}
          <div className="min-w-0 space-y-6">
            {/* DLQ panel */}
            <Card className="min-w-0 gap-0 rounded-md border-border p-6">
              <div className="flex items-center justify-between">
                <div>
                  <Eyebrow>Dead-letter queue</Eyebrow>
                  <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
                    Unresolved events
                  </h3>
                </div>
                <StatusBadge
                  status={`${data.dlq.length} dead`}
                  tone={data.dlq.length > 0 ? "red" : "green"}
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Dead letters are outbox events that failed delivery after every
                retry — kept here for manual inspection rather than silently
                dropped. Currently{" "}
                <span className="font-semibold text-cobble-ink">
                  {data.queued}
                </span>{" "}
                event{data.queued === 1 ? "" : "s"} queued.
              </p>
              <div className="mt-4 max-h-48 space-y-2 overflow-y-auto pr-1">
                {data.dlq.length === 0 && (
                  <p className="text-sm text-olive-ink">
                    Queue clean — no dead letters.
                  </p>
                )}
                {data.dlq.map((d: DlqRow) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded border border-border/70 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs text-cobble-ink">
                        {d.topic}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {fmtDate(d.createdAt)}
                      </span>
                    </span>
                    <StateBadge state={d.status} />
                  </div>
                ))}
              </div>
            </Card>

            {/* Quiet hours note */}
            <Card className="gap-0 rounded-md border-border p-6">
              <Eyebrow>Delivery preferences</Eyebrow>
              <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
                Quiet hours
              </h3>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Clients may set per-channel preferences in their portal. Quiet
                hours ({settings.governance.quietHoursDefault}) suppress
                non-urgent in-app and push deliveries; approval and dispatch
                events are never suppressed. Email follows the outbox schedule
                and is retried automatically.
              </p>
              <div className="mt-4">
                <SandboxChip label="Email via sandbox outbox" />
              </div>
            </Card>
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────── feature flags

/**
 * Notes come from the module that actually gates behaviour
 * (`src/lib/settings/features.ts`), not from a copy kept here. A description of
 * a switch that lives away from the switch is how the two drifted apart before:
 * the console promised an effect the runtime never had.
 */
const FLAG_NOTES: Record<string, string> = FEATURE_NOTES;

/** Known flags with no stored row — these follow their platform default. */
function knownUnsetFlags(
  rows: Array<{ key: string }>,
): Array<keyof typeof FEATURE_DEFAULTS> {
  const stored = new Set(rows.map((r) => r.key));
  return (
    Object.keys(FEATURE_DEFAULTS) as Array<keyof typeof FEATURE_DEFAULTS>
  ).filter((k) => !stored.has(k));
}

export function AdminFlags() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApiData(() => api.flags());
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<FlagRow | null>(null);

  async function toggle(key: string, next: boolean) {
    setBusy(key);
    try {
      await api.toggleFlag(key, next);
      toast({
        title: next ? "Flag enabled" : "Flag disabled",
        description: key,
      });
      await reload();
    } catch (e) {
      toast({
        title: "Flag toggle failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("nav.section.admin")}
        title={t("adm.flagsTitle")}
        desc={t("adm.flagsDesc")}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing({ key: "", name: "", enabled: false })}
          >
            <Plus className="h-4 w-4" /> New flag
          </Button>
        }
      />
      {loading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} />
      ) : (
        <div className="max-w-3xl space-y-3">
          {data.flags.length === 0 && (
            <Card className="rounded-md border-dashed border-border p-0">
              <InlineEmpty
                icon={Flag}
                message="No feature flags registered — platform-wide switches appear here."
                ctaLabel="New flag"
                onCta={() => setEditing({ key: "", name: "", enabled: false })}
              />
            </Card>
          )}
          {data.flags.map((f: FlagRow) => (
            <Card
              key={f.key}
              className={cn(
                "flex items-center justify-between gap-6 rounded-md border-border p-5 transition-colors",
                busy === f.key && "opacity-60",
              )}
            >
              <div className="min-w-0">
                <p className="font-mono text-sm text-cobble-ink">{f.key}</p>
                <p className="mt-0.5 text-sm text-iron-ink">{f.name}</p>
                {FLAG_NOTES[f.key] && (
                  <p
                    className={cn(
                      "mt-2 flex items-start gap-2 text-xs leading-relaxed",
                      f.enabled && f.key === "maintenance_mode"
                        ? "text-danger-ink"
                        : "text-muted-foreground",
                    )}
                  >
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-ink" />
                    {FLAG_NOTES[f.key]}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {f.enabled ? "On" : "Off"}
                </span>
                <Switch
                  checked={f.enabled}
                  disabled={busy === f.key}
                  aria-label={`Toggle flag ${f.key}`}
                  onCheckedChange={(next) => void toggle(f.key, next)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit flag ${f.key}`}
                  onClick={() => setEditing(f)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
          {/* Known flags with no stored row follow their platform default. They
              are shown because otherwise an operator sees an empty panel and
              cannot tell whether extraction is on before anyone has touched it —
              absence would read as "off" when the runtime treats it as "on". */}
          {knownUnsetFlags(data.flags).map((key) => {
            const on = FEATURE_DEFAULTS[key];
            return (
              <Card
                key={`default-${key}`}
                className="flex items-center justify-between gap-6 rounded-md border-dashed border-border p-5"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm text-cobble-ink">{key}</p>
                  <p className="mt-0.5 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Following the platform default
                  </p>
                  {FLAG_NOTES[key] && (
                    <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-ink" />
                      {FLAG_NOTES[key]}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {on ? "On" : "Off"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing({ key, name: key, enabled: on })}
                  >
                    Set explicitly
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing !== null && (
        <FlagDialog
          key={editing.key || "new-flag"}
          row={editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </PageShell>
  );
}

function FlagDialog({
  row,
  onOpenChange,
  onSaved,
}: {
  row: FlagRow;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const isNew = row.key === "";
  const [key, setKey] = useState(row.key);
  const [name, setName] = useState(row.name);
  const [enabled, setEnabled] = useState(row.enabled);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const ok =
    key.trim().length > 0 &&
    name.trim().length > 0 &&
    (!isNew || reason.trim().length > 0);

  async function save() {
    setBusy(true);
    try {
      await api.saveFlag({
        key: key.trim(),
        name: name.trim(),
        enabled,
        reason: reason.trim() || undefined,
      });
      toast({
        title: isNew ? "Flag created" : "Flag saved",
        description: key.trim(),
      });
      await onSaved();
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "New feature flag" : "Edit feature flag"}
          </DialogTitle>
          <DialogDescription>
            {isNew
              ? "Register a platform-wide switch. It defaults to off; toggle it on when the code path is ready."
              : "Rename a flag or leave the name as it is. The key is the stable identifier the code reads and cannot change."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="flag-key">Key</Label>
            <Input
              id="flag-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="maintenance_mode"
              className="font-mono"
              disabled={!isNew}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="flag-name">Name</Label>
            <Input
              id="flag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maintenance mode"
            />
          </div>
          {isNew && (
            <div className="space-y-1.5">
              <Label htmlFor="flag-reason">Reason (audit)</Label>
              <Input
                id="flag-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("adm.flagReasonPh")}
              />
            </div>
          )}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm text-iron-ink">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Applies immediately.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label={t("adm.flagEnabled")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!ok || busy}>
            {busy && <Spinner className="h-4 w-4" />}{" "}
            {isNew ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────── programmes (services)

/**
 * Programme & Service catalogue — the ADMIN authoring surface for the service
 * list a client picks from. One definition feeds the public catalogue, the
 * client's service browser and the RM's approval desk, so edits here are
 * canonical. Creation/edit/retire are all audit-reasoned server-side.
 */
export function AdminProgrammes() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApiData(() =>
    api.adminProgrammes(),
  );
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; row: AdminProgrammeRow } | null
  >(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function setActive(row: AdminProgrammeRow, active: boolean) {
    setBusy(row.id);
    try {
      await api.updateProgramme({
        id: row.id,
        active,
        reason: `Set ${row.key} ${active ? "active" : "inactive"}`,
      });
      toast({
        title: active ? "Programme activated" : "Programme retired",
        description: row.name,
      });
      await reload();
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("nav.section.admin")}
        title={t("adm.programmesTitle")}
        desc={t("adm.programmesDesc")}
        actions={
          <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
            <Plus className="h-4 w-4" /> New programme
          </Button>
        }
      />
      {loading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} />
      ) : (
        <div className="max-w-4xl space-y-3">
          {data.programmes.length === 0 && (
            <Card className="rounded-md border-dashed border-border p-0">
              <InlineEmpty
                icon={Globe}
                message="No programmes yet — add the first service clients can apply through."
                ctaLabel="New programme"
                onCta={() => setDialog({ mode: "create" })}
              />
            </Card>
          )}
          {data.programmes.map((p) => (
            <Card
              key={p.id}
              className={cn(
                "rounded-md border-border p-5 transition-colors",
                busy === p.id && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-editorial text-base text-cobble-ink">
                      {p.name}
                    </p>
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] uppercase tracking-wider"
                    >
                      {p.key}
                    </Badge>
                    <Badge
                      variant={p.active ? "default" : "outline"}
                      className="text-[10px] uppercase tracking-wider"
                    >
                      {p.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {p.country}
                  </p>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-iron-ink">
                    {p.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {p.active ? "On" : "Off"}
                  </span>
                  <Switch
                    checked={p.active}
                    disabled={busy === p.id}
                    aria-label={`Toggle programme ${p.key}`}
                    onCheckedChange={(next) => void setActive(p, next)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ mode: "edit", row: p })}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {dialog !== null && (
        <ProgrammeDialog
          key={dialog.mode === "edit" ? `edit-${dialog.row.id}` : "create"}
          mode={dialog.mode}
          row={dialog.mode === "edit" ? dialog.row : undefined}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onSaved={async () => {
            setDialog(null);
            await reload();
          }}
        />
      )}
    </PageShell>
  );
}

function ProgrammeDialog({
  mode,
  row,
  onOpenChange,
  onSaved,
}: {
  mode: "create" | "edit";
  row?: AdminProgrammeRow;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState(row?.key ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [country, setCountry] = useState(row?.country ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const validKey = /^[A-Z0-9_]{2,40}$/.test(key.trim().toUpperCase());
  const ok =
    mode === "edit"
      ? name.trim().length > 0 &&
        country.trim().length > 0 &&
        description.trim().length > 0 &&
        reason.trim().length > 0
      : validKey &&
        name.trim().length > 0 &&
        country.trim().length > 0 &&
        description.trim().length > 0 &&
        reason.trim().length > 0;

  async function save() {
    setBusy(true);
    try {
      if (mode === "create") {
        await api.createProgramme({
          key: key.trim().toUpperCase(),
          name: name.trim(),
          country: country.trim(),
          description: description.trim(),
          reason: reason.trim(),
        });
        toast({ title: "Programme created", description: name.trim() });
      } else {
        await api.updateProgramme({
          id: row!.id,
          name: name.trim(),
          country: country.trim(),
          description: description.trim(),
          reason: reason.trim(),
        });
        toast({ title: "Programme updated", description: name.trim() });
      }
      await onSaved();
    } catch (e) {
      toast({
        title: mode === "create" ? "Create failed" : "Update failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New programme" : "Edit programme"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Adds a service to the catalogue. The key is the stable identifier other surfaces join on and cannot change later."
              : "Edit the editorial copy. The key is fixed — other surfaces join on it."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prog-key">Key</Label>
            <Input
              id="prog-key"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="DE_BUSINESS"
              disabled={mode === "edit"}
              className="font-mono"
            />
            {mode === "create" && key.length > 0 && !validKey && (
              <p className="text-xs text-danger-ink">
                Use 2–40 characters: A–Z, 0–9 or underscore.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-name">Name</Label>
            <Input
              id="prog-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="German Business Residence"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-country">Country</Label>
            <Input
              id="prog-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Germany"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-desc">Description</Label>
            <Textarea
              id="prog-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t("adm.progDescPh")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-reason">Reason (audit)</Label>
            <Input
              id="prog-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("adm.progReasonPh")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!ok || busy}>
            {busy && <Spinner className="h-4 w-4" />}{" "}
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────── message templates

const TEMPLATE_CHANNELS = ["IN_APP", "EMAIL", "PUSH", "WHATSAPP"] as const;

/**
 * Message Templates — admin-authored notification copy with {{token}}
 * interpolation, consumed by notify nodes and the notification centre. One row
 * per (key, channel, locale); saving upserts on that tuple.
 */
export function AdminTemplates() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApiData(() => api.templates());
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; row: MessageTemplateRow } | null
  >(null);
  const [deleting, setDeleting] = useState<MessageTemplateRow | null>(null);

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("nav.section.admin")}
        title={t("adm.templatesTitle")}
        desc={t("adm.templatesDesc")}
        actions={
          <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
            <Plus className="h-4 w-4" /> New template
          </Button>
        }
      />
      {loading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} />
      ) : (
        <div className="max-w-4xl space-y-3">
          {data.templates.length === 0 && (
            <Card className="rounded-md border-dashed border-border p-0">
              <InlineEmpty
                icon={MailQuestion}
                message="No templates yet — author the notification copy automated sends will reuse."
                ctaLabel="New template"
                onCta={() => setDialog({ mode: "create" })}
              />
            </Card>
          )}
          {data.templates.map((tpl) => (
            <Card key={tpl.id} className="rounded-md border-border p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-editorial text-base text-cobble-ink">
                      {tpl.name}
                    </p>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase tracking-wider"
                    >
                      {tpl.channel}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase tracking-wider"
                    >
                      {tpl.locale.toUpperCase()}
                    </Badge>
                    {!tpl.active && (
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase tracking-wider"
                      >
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {tpl.key}
                  </p>
                  {tpl.subject && (
                    <p className="mt-2 text-sm font-medium text-iron-ink">
                      {tpl.subject}
                    </p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-iron-ink">
                    {tpl.body}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ mode: "edit", row: tpl })}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete template ${tpl.key}`}
                    onClick={() => setDeleting(tpl)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {dialog !== null && (
        <TemplateDialog
          key={dialog.mode === "edit" ? `edit-${dialog.row.id}` : "create"}
          mode={dialog.mode}
          row={dialog.mode === "edit" ? dialog.row : undefined}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onSaved={async () => {
            setDialog(null);
            await reload();
          }}
        />
      )}
      <TypedConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this template?"
        description={
          deleting
            ? `${deleting.name} (${deleting.key} · ${deleting.channel}) will be removed. Automated sends that referenced it fall back to their built-in copy.`
            : ""
        }
        objectName={deleting?.key ?? ""}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api.deleteTemplate(deleting.id);
            toast({ title: "Template deleted", description: deleting.key });
            setDeleting(null);
            await reload();
          } catch (e) {
            toast({
              title: "Delete failed",
              description: e instanceof Error ? e.message : "Unknown error",
              variant: "destructive",
            });
          }
        }}
      />
    </PageShell>
  );
}

function TemplateDialog({
  mode,
  row,
  onOpenChange,
  onSaved,
}: {
  mode: "create" | "edit";
  row?: MessageTemplateRow;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState(row?.key ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [channel, setChannel] = useState<string>(row?.channel ?? "IN_APP");
  const [locale, setLocale] = useState(row?.locale ?? "en");
  const [subject, setSubject] = useState(row?.subject ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [active, setActive] = useState(row?.active ?? true);
  const [busy, setBusy] = useState(false);

  const ok =
    key.trim().length > 0 && name.trim().length > 0 && body.trim().length > 0;

  async function save() {
    setBusy(true);
    try {
      await api.saveTemplate({
        key: key.trim(),
        name: name.trim(),
        channel,
        locale: locale.trim() || "en",
        subject: subject.trim() || undefined,
        body,
        active,
      });
      toast({
        title: mode === "create" ? "Template created" : "Template saved",
        description: name.trim(),
      });
      await onSaved();
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New template" : "Edit template"}
          </DialogTitle>
          <DialogDescription>
            Saving overwrites the template for this exact key, channel and
            language. Insert {"{{token}}"} placeholders for values filled at
            send time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-key">Key</Label>
              <Input
                id="tpl-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="doc.requested"
                className="font-mono"
                disabled={mode === "edit"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Document requested"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-channel">Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger id="tpl-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-locale">Language</Label>
              <Input
                id="tpl-locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                placeholder="en"
                className="font-mono"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-subject">
              Subject <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="tpl-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("adm.tplSubjectPh")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-body">Body</Label>
            <Textarea
              id="tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Hello {{client.name}}, your document {{document.type}} was received."
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm text-iron-ink">Active</p>
              <p className="text-xs text-muted-foreground">
                Inactive templates stay saved but are not used by automated
                sends.
              </p>
            </div>
            <Switch
              checked={active}
              onCheckedChange={setActive}
              aria-label={t("adm.templateActive")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!ok || busy}>
            {busy && <Spinner className="h-4 w-4" />}{" "}
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────── automation

const AUTOMATION_TOPICS: Array<{ topic: string; label: string; note: string }> =
  [
    {
      topic: "case.status.changed",
      label: "Case status changed",
      note: "Every legal case transition — drives client comms + downstream SLAs",
    },
    {
      topic: "document.uploaded",
      label: "Document uploaded",
      note: "Client intake — triggers AI extraction + completeness checks",
    },
    {
      topic: "ocr.completed",
      label: "OCR completed",
      note: "Extraction settled — provisional values await human confirmation",
    },
    {
      topic: "dispatch.created",
      label: "Dispatch created",
      note: "Physical file dispatched — tracking webhook inbound",
    },
    {
      topic: "approval.letter.uploaded",
      label: "Approval letter uploaded",
      note: "Approval-in-principle received from authority",
    },
    {
      topic: "workflow.run.started",
      label: "Workflow run started",
      note: "Internal workflow engine runs — mirrored to the event bus",
    },
    {
      topic: "workflow.run.completed",
      label: "Workflow run completed",
      note: "Run settled (succeeded or failed) — consumed by downstream flows",
    },
    {
      topic: "page.submitted",
      label: "Lane page submitted",
      note: "Public page form submission — correlated with the bound workflow run",
    },
    {
      topic: "selfbuild.completed",
      label: "Self-Build completed",
      note: "The AI composer finished drafting a page or workflow — awaits human review",
    },
    {
      topic: "workflow.mirrored",
      label: "Workflow mirrored",
      note: "A platform workflow was published to the signed webhook fan-out",
    },
  ];

export function AdminAutomation() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApiData(() =>
    api.automationStatus(),
  );
  const [pinging, setPinging] = useState(false);
  // Alerting state
  const [automationAlerts, setAutomationAlerts] = useState<Array<Alert>>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const session = useApp((s) => s.session);
  const isAdmin = session?.role === "ADMIN";

  // dead-letter queue replay — which row is mid-flight
  const [requeueingId, setRequeueingId] = useState<string | null>(null);
  // job timeline — list of recent jobs + expanded job details
  const [jobTimeline, setJobTimeline] = useState<
    Array<{
      id: string;
      topic: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
      correlationId: string | null;
      createdAt: string;
      finishedAt: string | null;
      claimedAt: string | null;
      claimedBy: string | null;
      notBefore: string;
      leaseUntil: string | null;
      concurrencyKey: string | null;
      workerClass: string | null;
      failureCategory: string | null;
    }>
  >([]);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobDetails, setJobDetails] = useState<{
    job: {
      id: string;
      topic: string;
      payload: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
      correlationId: string | null;
      createdAt: string;
      finishedAt: string | null;
      claimedAt: string | null;
      claimedBy: string | null;
      notBefore: string;
      orgId: string | null;
      leaseUntil: string | null;
      concurrencyKey: string | null;
      workerClass: string | null;
      failureCategory: string | null;
    };
    timeline: Array<{ at: string; event: string; detail?: string }>;
    attempts: Array<{
      id: string;
      attempt: number;
      workerId: string | null;
      status: string;
      failureCategory: string | null;
      error: string | null;
      startedAt: string;
      finishedAt: string | null;
      durationMs: number | null;
    }>;
  } | null>(null);
  const [jobTimelineError, setJobTimelineError] = useState<string | null>(null);
  // Alerting service imported
  // ticking clock — lease chips ("renews in Ns" / "lease expired") update live.
  // It only ticks while a loaded job is actually RUNNING under a lease, so the
  // console is not re-rendered every second when there is nothing to watch.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const hasLiveLease = jobTimeline.some(
    (j) => j.status === "RUNNING" && j.leaseUntil,
  );
  useEffect(() => {
    if (!hasLiveLease) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasLiveLease]);

  // Alert checking effect
  useEffect(() => {
    if (!isAdmin) return;

    const checkAlerts = async () => {
      setAlertsLoading(true);
      setAlertsError(null);
      try {
        const alerts = await checkAutomationAlerts();
        setAutomationAlerts(alerts);
      } catch (e) {
        setAlertsError(
          e instanceof Error ? e.message : "Failed to check alerts",
        );
      } finally {
        setAlertsLoading(false);
      }
    };

    // Check alerts on mount and every 30 seconds
    checkAlerts();
    const interval = setInterval(checkAlerts, 30 * 1000); // 30 seconds
    return () => clearInterval(interval);
  }, [isAdmin]);

  async function ping() {
    setPinging(true);
    try {
      const res = await api.automationPing();
      if (res.result.delivered) {
        toast({
          title: "Test event dispatched",
          description: res.result.detail,
        });
      } else {
        toast({
          title: t("auto.pingRecorded"),
          description: res.result.detail,
          variant: "destructive",
        });
      }
      await reload();
    } catch (e) {
      toast({
        title: t("auto.pingFailed"),
        description: e instanceof Error ? e.message : t("auto.unknownError"),
        variant: "destructive",
      });
    } finally {
      setPinging(false);
    }
  }

  /** Return one dead-lettered automation job to the durable queue (fresh retries). */
  async function requeueDeadJob(id: string, topic: string) {
    setRequeueingId(id);
    try {
      await api.automationRequeue(id);
      toast({
        title: t("auto.requeued"),
        description: t("auto.requeuedBody", { topic }),
      });
      await reload();
    } catch (e) {
      toast({
        title: t("auto.requeueFailed"),
        description: e instanceof Error ? e.message : t("auto.unknownError"),
        variant: "destructive",
      });
    } finally {
      setRequeueingId(null);
    }
  }

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("nav.section.admin")}
        title={t("adm.automationTitle")}
        desc="Business events run on the platform's own workflow engine and are ledgered in the outbox — every event fans out in-app and to signed outbound webhooks."
        actions={
          <Button
            variant="outline"
            disabled={pinging}
            onClick={() => void ping()}
          >
            {pinging ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}{" "}
            {t("auto.sendTest")}
          </Button>
        }
      />

      {loading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBlock
          message={error ?? t("auto.unknownError")}
          onRetry={reload}
        />
      ) : (
        <div className="space-y-6">
          {/* automation engine health */}
          <Card className="gap-0 rounded-md border-border p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Eyebrow>{t("auto.backend")}</Eyebrow>
                <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
                  In-app engine
                </h3>
              </div>
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-olive/40 bg-olive/10 px-2.5 py-0.5 text-[11px] font-semibold text-olive-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-olive" />
                {t("auto.online")}
              </span>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t("auto.health")}</dt>
                <dd className="truncate font-mono text-xs text-cobble-ink">
                  {truncate(data.health.detail, 44)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Pending jobs</dt>
                <dd className="font-mono text-xs text-cobble-ink">
                  {data.health.pendingJobs}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  Recent deliveries (24h)
                </dt>
                <dd className="font-mono text-xs text-cobble-ink">
                  {data.health.recentDeliveries}
                </dd>
              </div>
            </dl>
            <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Activity className="h-3.5 w-3.5 text-gold-ink" />
              Automation runs entirely on the platform's own engine — events fan
              out in-app and to signed outbound webhooks.
            </p>
          </Card>

          {/* durable queue + dead-letter queue — the in-app engine's operational surface */}
          <Card className="gap-0 rounded-md border-border p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Eyebrow>{t("auto.durableQueue")}</Eyebrow>
                <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
                  {t("auto.queueTitle")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("auto.queueHint")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {data.queue?.paused && (
                  <StatusBadge status={t("auto.paused")} tone="amber" />
                )}
                <StatusBadge
                  status={t("auto.queued", { n: data.queue?.queued ?? 0 })}
                  tone="sky"
                />
                <StatusBadge
                  status={t("auto.running", { n: data.queue?.running ?? 0 })}
                  tone="amber"
                />
                <StatusBadge
                  status={t("auto.dead", { n: data.queue?.dead ?? 0 })}
                  tone={(data.queue?.dead ?? 0) > 0 ? "red" : "green"}
                />
              </div>
            </div>

            {!data.dead || data.dead.length === 0 ? (
              <p className="mt-4 rounded-md border border-border/60 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                {t("auto.queueClear")}
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-md border border-border/60">
                <DataTable
                  columns={[
                    createColumnHelper<any>().accessor("job", {
                      header: "Job",
                      cell: ({ row }) => (
                        <TableCell className="font-medium text-sm text-cobble-ink">
                          {row.job.name}
                        </TableCell>
                      ),
                    }),
                    createColumnHelper<any>().accessor("lastRunAt", {
                      header: "Last run",
                      cell: ({ row }) => (
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {fmtDay(row.lastRunAt)}
                        </TableCell>
                      ),
                    }),
                    createColumnHelper<any>().accessor("failureCount", {
                      header: "Failures",
                      cell: ({ row }) => (
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {row.failureCount}
                        </TableCell>
                      ),
                    }),
                    createColumnHelper<any>().accessor("lastError", {
                      header: "Last error",
                      cell: ({ row }) => (
                        <TableCell className="text-sm text-danger-ink w-40">
                          <Tooltip
                            content={row.lastError || ""}
                            delayDuration={150}
                            side="top"
                            sideOffset={4}
                          >
                            <div className="font-mono">
                              {truncate(row.lastError || "", 30)}
                            </div>
                          </Tooltip>
                        </TableCell>
                      ),
                    }),
                    createColumnHelper<any>().accessor("id", {
                      header: "Actions",
                      cell: ({ row }) => (
                        <TableCell className="text-right text-xs">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void clearDeadJob(row.id)}
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
                            Clear
                          </Button>
                        </TableCell>
                      ),
                    }),
                  ]}
                  data={deadJobs}
                  enableSorting={true}
                  enablePagination={false}
                  className="w-full"
                  emptyMessage="No failed jobs"
                />
              </div>
            )}
          </Card>

          {/* SLA alerts — automatic monitoring for queue health */}
          {data.alerts && data.alerts.length > 0 && (
            <Card className="gap-0 rounded-md border-border p-6">
              <div className="flex items-center justify-between">
                <div>
                  <Eyebrow>Active alerts</Eyebrow>
                  <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
                    Automation health
                  </h3>
                </div>
                <StatusBadge
                  status={`${data.alerts.length} active`}
                  tone={
                    data.alerts.some((a) => a.severity === "critical")
                      ? "red"
                      : "amber"
                  }
                />
              </div>
              <div className="mt-4 space-y-2">
                {data.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded border px-4 py-3",
                      alert.severity === "critical"
                        ? "border-coral/50 bg-coral/5"
                        : alert.severity === "warning"
                          ? "border-gold/50 bg-gold/5"
                          : "border-border bg-muted/30",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-cobble-ink">
                        {alert.ruleName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {alert.message}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge
                        status={alert.severity}
                        tone={
                          alert.severity === "critical"
                            ? "red"
                            : alert.severity === "warning"
                              ? "amber"
                              : "neutral"
                        }
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={async () => {
                          try {
                            await api.automationAcknowledgeAlert(alert.id);
                            toast({
                              title: "Alert acknowledged",
                              description: alert.ruleName,
                            });
                            await reload();
                          } catch (e) {
                            toast({
                              title: "Failed to acknowledge",
                              description:
                                e instanceof Error
                                  ? e.message
                                  : "Unknown error",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        Acknowledge
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Job timeline — recent jobs with expandable history */}
          <Card className="gap-0 rounded-md border-border p-0">
            <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
              <div>
                <Eyebrow>Job timeline</Eyebrow>
                <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
                  Recent automation jobs
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Inspect individual job history and debug issues
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const res = await api.automationJobs({ limit: 20 });
                    setJobTimeline(res.jobs);
                    setJobTimelineError(null);
                  } catch (e) {
                    setJobTimelineError(
                      e instanceof Error ? e.message : "Failed to load jobs",
                    );
                  }
                }}
              >
                <RefreshCcw className="mr-2 h-3.5 w-3.5" /> Load jobs
              </Button>
            </div>
            {jobTimelineError && (
              <div className="border-b border-border/60 bg-coral/5 px-6 py-3 text-sm text-danger-ink">
                {jobTimelineError}
              </div>
            )}
            {jobTimeline.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                Click "Load jobs" to fetch recent automation jobs
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <div className="overflow-x-auto">
                  <DataTable
                    columns={[
                      createColumnHelper<any>()
                        .accessor("jobName", {
                          header: "Job",
                          cell: ({ row }) => (
                            <TableCell className="font-medium text-sm text-cobble-ink">
                              {row.jobName}
                            </TableCell>
                          ),
                        }),
                      createColumnHelper<any>()
                        .accessor("runAt", {
                          header: "Run at",
                          cell: ({ row }) => (
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {fmtTime(row.runAt)}
                            </TableCell>
                          ),
                        }),
                      createColumnHelper<any>()
                        .accessor("status", {
                          header: "Status",
                          cell: ({ row }) => (
                            <TableCell>
                              <StateBadge state={row.status} />
                            </TableCell>
                          ),
                        }),
                      createColumnHelper<any>()
                        .accessor("triggeredBy", {
                          header: "Triggered by",
                          cell: ({ row }) => (
                            <TableCell className="text-sm text-muted-foreground">
                              {row.triggeredBy}
                            </TableCell>
                          ),
                        }),
                      createColumnHelper<any>()
                        .accessor("id", ({ row }) => (
                          <TableCell className="text-right text-xs">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void viewJobTimeline(row.id)}
                            >
                              <Eye className="mr-1 h-3 w-3" />
                              View
                            </Button>
                          </TableCell>
                        ))
                        .header("Actions"),
                    ]}
                    data={jobTimeline}
                    enableSorting={true}
                    enablePagination={false}
                    className="w-full"
                    emptyMessage="No recent job runs"
                  />
                </div>
              </div>
            )}
          </Card>

          {/* subscribed topics */}
          <Card className="gap-0 rounded-md border-border p-6">
            <Eyebrow>{t("auto.eventCatalogue")}</Eyebrow>
            <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
              {t("auto.eventsOnBus")}
            </h3>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {AUTOMATION_TOPICS.map((t) => (
                <div
                  key={t.topic}
                  className="rounded border border-border/70 bg-muted/30 px-3 py-2.5"
                >
                  <p className="flex items-center gap-1.5 font-mono text-xs text-cobble-ink">
                    <Zap
                      className="h-3 w-3 shrink-0 text-gold-ink"
                      aria-hidden="true"
                    />
                    {t.topic}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t.note}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* delivery ledger */}
          <Card className="gap-0 rounded-md border-border p-0">
            <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
              <div>
                <Eyebrow>{t("auto.outbox")}</Eyebrow>
                <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
                  {t("auto.recentDeliveries")}
                </h3>
              </div>
              <Button variant="outline" size="sm" onClick={reload}>
                <RefreshCcw className="mr-2 h-3.5 w-3.5" /> {t("auto.refresh")}
              </Button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <div className="overflow-x-auto">
                <DataTable
                  columns={[
                    createColumnHelper<any>()
                      .accessor("jobName", ({ row }) => (
                        <TableCell className="font-medium text-sm text-cobble-ink">
                          {row.jobName}
                        </TableCell>
                      ))
                      .header("Job"),
                    createColumnHelper<any>()
                      .accessor("deliveredAt", ({ row }) => (
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {fmtTime(row.deliveredAt)}
                        </TableCell>
                      ))
                      .header("Delivered at"),
                    createColumnHelper<any>()
                      .accessor("status", ({ row }) => (
                        <TableCell>
                          <StateBadge state={row.status} />
                        </TableCell>
                      ))
                      .header("Status"),
                    createColumnHelper<any>()
                      .accessor("recipient", ({ row }) => (
                        <TableCell className="text-sm text-muted-foreground truncate w-32">
                          {row.recipient}
                        </TableCell>
                      ))
                      .header("Recipient"),
                    createColumnHelper<any>()
                      .accessor("id", ({ row }) => (
                        <TableCell className="text-right text-xs">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void viewDelivery(row.id)}
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            View
                          </Button>
                        </TableCell>
                      ))
                      .header("Actions"),
                  ]}
                  data={recentDeliveries}
                  enableSorting={true}
                  enablePagination={false}
                  className="w-full"
                  emptyMessage="No recent deliveries"
                />
              </div>
            </div>
          </Card>

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-gold-ink" />
            Automation runs on the platform's own engine. Undelivered events
            stay QUEUED in the outbox for replay.
          </p>

          {/* Autopilot — auto-detect + auto-generate signed inbound hook URLs & tools */}
          <AutopilotPanel />
        </div>
      )}
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────── integrations settings

type IntegrationRow = Awaited<
  ReturnType<typeof api.integrations>
>["integrations"][number];

/**
 * Translated titles per connector. The server already returns the canonical
 * order (INTEGRATION_ORDER in the integration layer) and an English label +
 * blurb as fallback, so the UI only owns the localized headline — there is no
 * second connector list here to drift out of sync.
 */
const INTEGRATION_LABEL_KEY: Record<string, StringKey> = {
  smtp: "admin.integration.smtp",
  whatsapp: "admin.integration.whatsapp",
  webhook: "admin.integration.webhook",
  ai: "admin.integration.ai",
  dhl: "admin.integration.dhl",
  resend: "admin.integration.resend",
  automation: "admin.integration.automation",
  n8n: "admin.integration.n8n",
  xero: "admin.integration.xero",
  bexio: "admin.integration.bexio",
  github: "admin.integration.github",
};

/** Strings containing the mask are sent back untouched — the server treats them as "keep stored". */
function isMasked(v: string): boolean {
  return v.includes("•••");
}

/** Flatten the masked server config into a string form-state keyed by field key. */
function seedConfig(row: IntegrationRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of row.fields) {
    const v = row.config[f.key];
    out[f.key] = v === undefined || v === null ? "" : String(v);
  }
  return out;
}

export function AdminIntegrations() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApiData(() => api.integrations());
  // The server returns connectors in the canonical order — no client-side sort,
  // so an unknown/extra key can never be mis-sorted to the top of the grid.
  const ordered = data?.integrations ?? [];

  return (
    <PageShell>
      <AdminHeader
        eyebrow={t("nav.section.admin")}
        title={t("admin.integrations")}
        desc={t("admin.integrationsIntro")}
        actions={<SandboxChip label="Server-side credentials" />}
      />

      {loading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} />
      ) : ordered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-editorial text-lg text-cobble-ink">
            {t("admin.integrationsEmpty")}
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={reload}>
            <RefreshCcw className="mr-2 h-3.5 w-3.5" /> {t("common.retry")}
          </Button>
        </Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {ordered.map((row) =>
            row.key === "n8n" ? (
              <N8nWorkflowManager key="n8n-workflow-manager" />
            ) : (
              <IntegrationCard
                key={`${row.key}-${row.updatedAt ?? "new"}`}
                row={row}
                onSaved={reload}
              />
            ),
          )}
        </div>
      )}

      <WebhooksPanel />
    </PageShell>
  );
}

function IntegrationCard({
  row,
  onSaved,
}: {
  row: IntegrationRow;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [config, setConfig] = useState<Record<string, string>>(() =>
    seedConfig(row),
  );
  const [active, setActive] = useState(row.active);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  // re-seed from the server row after every refetch (save/refresh) — server truth wins
  useEffect(() => {
    setConfig(seedConfig(row));
    setActive(row.active);
    setMissing([]);
  }, [row]);

  const label = INTEGRATION_LABEL_KEY[row.key]
    ? t(INTEGRATION_LABEL_KEY[row.key])
    : row.label;

  /** Form state → payload. Masked values pass through unchanged; numeric fields become numbers. */
  function buildPayload(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of row.fields) {
      const raw = config[f.key] ?? "";
      if (
        f.type === "number" &&
        raw.trim() !== "" &&
        !Number.isNaN(Number(raw))
      ) {
        out[f.key] = Number(raw);
      } else {
        out[f.key] = raw;
      }
    }
    return out;
  }

  /** Guard: required metadata fields must be filled (masked values always count as filled). */
  function requiredMissing(): string[] {
    return row.fields
      .filter(
        (f) =>
          f.required &&
          !(config[f.key] ?? "").trim() &&
          !isMasked(config[f.key] ?? ""),
      )
      .map((f) => f.key);
  }

  async function save(nextActive: boolean) {
    const missingKeys = requiredMissing();
    if (missingKeys.length > 0) {
      setMissing(missingKeys);
      return;
    }
    setMissing([]);
    setSaving(true);
    try {
      await api.saveIntegration(row.key, buildPayload(), nextActive);
      toast({ title: t("admin.integration.saved"), description: label });
      await onSaved();
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Download the workflows-only n8n bundle. The compiler lives in
   * `src/lib/integrations/n8n-graph.ts`; this only saves what the API returns,
   * so the console and the API can never disagree about the artefact.
   */
  async function exportToN8n() {
    setExporting(true);
    try {
      const bundle = await api.n8nExport();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `citizen-lane-n8n-workflows.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: t("admin.integration.n8nExportOk"),
        description: t("admin.integration.n8nExportDesc", {
          n: String(bundle.counts?.workflows ?? 0),
          nodes: String(bundle.counts?.nodes ?? 0),
        }),
      });
    } catch (e) {
      toast({
        title: t("admin.integration.n8nExportFail"),
        description: e instanceof Error ? e.message : t("auto.unknownError"),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  /** Optimistic active toggle — reverts and toasts destructively if the PUT fails. */
  async function toggleActive(next: boolean) {
    setActive(next);
    setToggling(true);
    try {
      await api.saveIntegration(row.key, buildPayload(), next);
      toast({
        title: next
          ? t("admin.integration.active")
          : t("admin.integration.inactive"),
        description: label,
      });
      await onSaved();
    } catch (e) {
      setActive(row.active);
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setToggling(false);
    }
  }

  /**
   * Live connectivity check. The server probes with the STORED credentials and
   * returns only { ok, detail } — no secret ever reaches the browser.
   */
  async function testConnection() {
    setTesting(true);
    try {
      const res = await api.testIntegration(row.key);
      toast({
        title: res.ok
          ? t("admin.integration.testOk")
          : t("admin.integration.testFail"),
        description: res.detail,
        variant: res.ok ? "default" : "destructive",
      });
    } catch (e) {
      toast({
        title: t("admin.integration.testFail"),
        description: e instanceof Error ? e.message : t("auto.unknownError"),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="gap-0 rounded-md border-border p-0">
      {/* header — label, kind, active switch (optimistic) */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Eyebrow>{row.kind}</Eyebrow>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {row.key}
            </span>
          </div>
          <h3 className="mt-1 font-editorial text-lg text-cobble-ink">
            {label}
          </h3>
          {row.blurb && (
            <p className="mt-1.5 max-w-prose text-[12px] leading-relaxed text-muted-foreground">
              {row.blurb}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge
            status={
              active
                ? t("admin.integration.active")
                : t("admin.integration.inactive")
            }
            tone={active ? "green" : "neutral"}
          />
          <Switch
            checked={active}
            disabled={toggling || saving}
            aria-label={`${label} — ${active ? t("admin.integration.active") : t("admin.integration.inactive")}`}
            onCheckedChange={(next) => void toggleActive(next)}
          />
        </div>
      </div>

      {/* fields — generated from the server metadata; area scrolls if the field list grows */}
      <div className="max-h-96 overflow-y-auto px-6 py-4">
        <div className="space-y-4">
          {row.fields.map((f) => {
            const id = `integration-${row.key}-${f.key}`;
            const isMissing = missing.includes(f.key);
            const value = config[f.key] ?? "";
            return (
              <div key={f.key} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor={id} className="text-[13px]">
                    {f.label}
                    {f.required && (
                      <span className="ml-1 text-gold-ink" aria-hidden="true">
                        *
                      </span>
                    )}
                  </Label>
                  {!f.required && (
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("common.optional")}
                    </span>
                  )}
                </div>
                {f.type === "select" ? (
                  <Select
                    value={value}
                    onValueChange={(v) => {
                      setConfig((c) => ({ ...c, [f.key]: v }));
                      setMissing((m) => m.filter((k) => k !== f.key));
                    }}
                  >
                    <SelectTrigger
                      id={id}
                      className="w-full"
                      aria-invalid={isMissing || undefined}
                    >
                      <SelectValue placeholder={t("common.none")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={id}
                    type={f.type === "password" ? "password" : "text"}
                    inputMode={f.type === "number" ? "numeric" : undefined}
                    value={value}
                    autoComplete="off"
                    onChange={(e) => {
                      setConfig((c) => ({ ...c, [f.key]: e.target.value }));
                      setMissing((m) => m.filter((k) => k !== f.key));
                    }}
                    aria-required={f.required || undefined}
                    aria-invalid={isMissing || undefined}
                    className={cn(
                      "rounded-none border-input focus-visible:ring-gold",
                      isMasked(value) && "text-muted-foreground italic",
                    )}
                  />
                )}
                {f.help && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {f.help}
                  </p>
                )}
                {isMissing && (
                  <p className="text-[11px] font-medium text-danger-ink">
                    {t("common.required")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* footer — updated stamp + per-card save */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-6 py-4">
        <p className="text-[11px] text-muted-foreground">
          {row.updatedAt
            ? t("admin.integration.updatedBy", {
                date: fmtDate(row.updatedAt),
                by: row.updatedBy ?? "—",
              })
            : "—"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-none"
            disabled={testing || saving || toggling}
            onClick={() => void testConnection()}
            aria-label={`${t("admin.integration.test")} — ${label}`}
          >
            {testing ? (
              <Spinner className="mr-2 h-3 w-3" />
            ) : (
              <Zap className="mr-2 h-3.5 w-3.5" />
            )}
            {t("admin.integration.test")}
          </Button>
          {row.key === "n8n" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-none"
              disabled={exporting}
              onClick={() => void exportToN8n()}
              aria-label={`${t("admin.integration.n8nExport")} — ${label}`}
            >
              {exporting ? (
                <Spinner className="mr-2 h-3 w-3" />
              ) : (
                <Download className="mr-2 h-3.5 w-3.5" />
              )}
              {t("admin.integration.n8nExport")}
            </Button>
          )}
          <Button
            size="sm"
            className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]"
            disabled={saving || toggling}
            onClick={() => void save(active)}
          >
            {saving && <Spinner className="mr-2 h-3 w-3" />}
            {t("admin.integration.save")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
