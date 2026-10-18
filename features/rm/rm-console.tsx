"use client";
/**
 * Citizen Lane — RM Console (Tasks 8-b + 10-c)
 *
 * RmQueue       — assigned-case queue: desktop table + mobile cards, debounced search,
 *                 status filter, "my cases only" toggle, SLA + risk hints, plus one-tap
 *                 quick-filter chips (all / needs action / documents pending — see
 *                 queue-filters.tsx) with live counts derived from the queue payload.
 * RmCaseDetail  — the RM working surface: next-best-action bar (sticky under the header;
 *                 jumps to the first pending item with a gold flash), secondary approvals,
 *                 document review, document requests, secure timeline & messages,
 *                 DHL dispatch, approval letter.
 *
 * All data flows through the typed api client (src/lib/api-client.ts). No direct fetch.
 *
 * Known backend gap (logged in worklog 8-b): GET /api/rm/cases exposes document/request
 * counts but not their ids, so the detail view cannot enumerate per-document rows or
 * pre-existing requests. The full document-review UI below activates the moment a staff
 * case-detail endpoint ships — see `load()` for the marked integration point.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  Check,
  Clock,
  Download,
  FileDown,
  FilePlus2,
  FileText,
  History,
  Info,
  LayoutTemplate,
  ListChecks,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Truck,
  Upload,
  UserPlus,
  X,
} from "lucide-react";

import { api } from "@/lib/api-client";
import type {
  DocumentRow,
  ExtractedField,
  ScreeningsMatch,
  TriageScore,
  TriageTier,
} from "@/lib/api-client";
import { useDebouncedValue } from "@/hooks";
import { useCaseChat } from "@/hooks/use-case-chat";
import { useI18n, type StringKey } from "@/lib/i18n";
import { useApp } from "@/lib/store";
import {
  CASE_STATES,
  DOC_TYPE_LABELS,
  caseStatusLabel,
  docStatusLabel,
} from "@/lib/domain/states";
import { usePlatformSettings } from "@/lib/settings/client";
import {
  ConfidenceBar,
  EmptyState,
  Eyebrow,
  ProvisionalChip,
  SandboxChip,
  SectionTitle,
  Spinner,
  StateBadge,
  StatusBadge,
} from "@/components/brand/ui";

import {
  QueueQuickFilters,
  deriveQuickCounts,
  matchesQuickFilter,
  type QueueQuickKey,
} from "@/features/rm/queue-filters";
import { CrmViewSwitcher } from "@/features/rm/crm-view-switcher";
import { SYSTEM_CRM_VIEWS, applyCrmView } from "@/features/rm/crm-projections";
import { PersonalWorkloadView } from "@/features/rm/personal-workload-view";
import { ShiftFreezeCard } from "@/features/rm/shift-freeze-card";
import { CallLauncher } from "@/features/calls/call-launcher";
import {
  KeyboardShortcutsHelp,
  VitalsStrip,
  DecisionRail,
  useKeyboardShortcuts,
} from "@/features/rm/rm-power-features";
import { DuplicateReviewSection } from "@/features/rm/duplicate-review";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { useMutationStatus } from "@/hooks/use-mutation-status";
import { MutationStatus } from "@/components/brand/ui";
import { cn } from "@/lib/utils";
import { csvDocument } from "@/lib/csv";

// ────────────────────────────────────────────────────────────────────────────
// Shared types & helpers
// ────────────────────────────────────────────────────────────────────────────

type QueueRow = Awaited<ReturnType<typeof api.rmCases>>["cases"][number];
type HistoryItem = Awaited<ReturnType<typeof api.timeline>>["history"][number];
type CommentItem = Awaited<ReturnType<typeof api.timeline>>["comments"][number];
type LetterMeta = { fileName: string; version: number; createdAt: string };
type CreatedRequest = {
  id: string;
  docType: string;
  title: string;
  instructions: string;
  dueDate: string | null;
  status: string;
};

// ── Official letters (letterbox) — local fetch client
// LetterRow type mirrors the shape from /api/cases/[id]/letters
type LetterRow = {
  id: string;
  fileName: string;
  type: string | null;
  caseRef: string | null;
  ref: string | null;
  version: number;
  sizeBytes: number;
  createdAt: string;
  issuedBy: string;
};

/** Stages where a case older than 14 days warrants SLA attention. */
const EARLY_STAGES = new Set([
  "ONBOARDING",
  "DATA_SUBMITTED",
  "DATA_APPROVED",
  "SERVICE_SELECTED",
  "SERVICE_APPROVED",
  "DOCS_REQUESTED",
  "IN_PROGRESS",
]);

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "d MMM yyyy, HH:mm") : "—";
const fmtDate = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "d MMM yyyy") : "—";
const fmtShort = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "d MMM, HH:mm") : "—";

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function notifyError(e: unknown, title = "Action failed") {
  toast({
    title,
    description:
      e instanceof Error ? e.message : "Unexpected error — please retry.",
    variant: "destructive",
  });
}

/** Dictionary gs.* strings carry a literal "{n}" placeholder — interpolate locally (same as getting-started). */
const withN = (template: string, n: number) =>
  template.replace("{n}", String(n));

/** Editorial card header: eyebrow + gold-ruled section title. */
function CardHead({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <SectionTitle className="mt-1.5 text-lg md:text-xl">
          {title}
        </SectionTitle>
      </div>
      {action}
    </div>
  );
}

function ApprovalMini({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-12 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {value ? (
        <StateBadge state={value} />
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}

// ── G18/G19 — queue triage + multi-select helpers ───────────────────────────

type Translate = (
  key: StringKey,
  vars?: Record<string, string | number>
) => string;

/** Stages where no further case action is possible — bulk actions skip these. */
const TERMINAL_CASE_STATES = new Set(["COMPLETED", "CANCELLED"]);

const TIER_RANK: Record<TriageTier, number> = { P1: 0, P2: 1, P3: 2 };

/** Brand-badge tones for the tiers — coral (act now), gold (soon), neutral (routine). */
const TIER_TONES: Record<TriageTier, "red" | "gold" | "neutral"> = {
  P1: "red",
  P2: "gold",
  P3: "neutral",
};

/** Index the triage queue by case id for O(1) row lookups. */
function indexTriage(queue: TriageScore[]): Record<string, TriageScore> {
  const out: Record<string, TriageScore> = {};
  for (const s of queue) out[s.caseId] = s;
  return out;
}

/** Tier + score chip for a queue row; the scoring factors show on hover/focus. */
function TierChip({ score, t }: { score: TriageScore; t: Translate }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-gold"
          aria-label={t("rmq.triageScore", {
            tier: score.tier,
            score: score.score,
            factors: score.factors.join(", ") || "—",
          })}
        >
          <StatusBadge
            status={`${score.tier} · ${score.score}`}
            tone={TIER_TONES[score.tier]}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{score.factors.join(" · ")}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// RmQueue
// ────────────────────────────────────────────────────────────────────────────

export function RmQueue() {
  const session = useApp((s) => s.session);
  const setActiveCase = useApp((s) => s.setActiveCase);
  const setView = useApp((s) => s.setView);

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q.trim(), 300);
  const [status, setStatus] = useState<string>("ALL");
  const [mine, setMine] = useState(false);
  // 10-c quick filters — client-side triage over the loaded queue
  const [quick, setQuick] = useState<QueueQuickKey>("ALL");
  // Dead-UI wiring: saved queue views filter the same rows in place.
  // No persistence route exists yet, so only the shipped SYSTEM views are
  // offered (canManage=false hides the save UI rather than faking it).
  const [viewKey, setViewKey] = useState<string>("all");

  // G19 — triage tiers/scores (additive: while loading or when unavailable —
  // 403/5xx/network — every control below stays hidden and the queue behaves
  // exactly as before)
  const [triageById, setTriageById] = useState<Record<string, TriageScore>>({});
  const [triageStatus, setTriageStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [tierFilter, setTierFilter] = useState<TriageTier | null>(null);
  // Dead-UI wiring: the SLA dot and risk badges toggle these in place.
  const [slaOnly, setSlaOnly] = useState(false);
  const [riskFilter, setRiskFilter] = useState<"HIGH" | "LOW" | null>(null);
  const [prioritySort, setPrioritySort] = useState(false);
  const [triageBusy, setTriageBusy] = useState(false);

  // G18 — multi-select + bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false); // mobile: reveal row checkboxes
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(
    null
  );
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);

  const isRm = session?.role === "RM" || session?.role === "SENIOR_RM";
  // Roles that may mutate a case from this queue (case.assign / triage.run /
  // case.approve.data all resolve to exactly this set). AUDITOR reaches the
  // queue read-only via nav, so every bulk affordance — select column, tier
  // recalculation — is gated on this flag rather than offered and 403'd.
  const canAct = isRm || session?.role === "ADMIN";
  const canApprove = canAct;

  const { t } = useI18n();
  const { settings } = usePlatformSettings();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await api.rmCases({
          q: dq || undefined,
          status: status === "ALL" ? undefined : status,
          mine: mine && isRm,
        });
        setRows(res.cases);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "The queue could not be loaded."
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [dq, status, mine, isRm]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // G19 — fetch the org's prioritised queue once. Any failure (403 without
  // case.read.all, slow/5xx, offline) resolves to "unavailable" and is never
  // surfaced as an error: triage is strictly additive to the queue.
  useEffect(() => {
    let cancelled = false;
    api
      .triage()
      .then((res) => {
        if (cancelled) return;
        setTriageById(indexTriage(res.queue));
        setTriageStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setTriageStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Recalculate the whole queue server-side (POST /api/triage, triage.run) and toast the result. */
  async function recalculatePriority() {
    setTriageBusy(true);
    try {
      const res = await api.triageRecalculate();
      setTriageById(indexTriage(res.queue));
      setTriageStatus("ready");
      toast({
        title: t("rmq.recalcDone"),
        description: t("rmq.recalcDoneDesc", { n: res.recalculated }),
      });
    } catch (e) {
      notifyError(e, t("rmq.recalcFailed"));
    } finally {
      setTriageBusy(false);
    }
  }

  // 10-c — live chip counts + the client-side filtered list. Counts derive from
  // the same `rows` array the list renders, so a badge always equals the length
  // of the list its chip reveals (self-consistent by construction).
  const quickCounts = useMemo(() => deriveQuickCounts(rows), [rows]);
  const visibleRows = useMemo(() => {
    let list = rows.filter((c) => matchesQuickFilter(c, quick));
    if (tierFilter)
      list = list.filter((c) => triageById[c.id]?.tier === tierFilter);
    if (slaOnly)
      list = list.filter((c) => c.ageDays > 14 && EARLY_STAGES.has(c.status));
    if (riskFilter) list = list.filter((c) => c.riskFlag === riskFilter);
    const activeView =
      SYSTEM_CRM_VIEWS.find((v) => v.key === viewKey) ?? SYSTEM_CRM_VIEWS[0];
    if (activeView && activeView.key !== "all")
      list = applyCrmView(list, activeView);
    if (prioritySort) {
      list = [...list].sort((a, b) => {
        const sa = triageById[a.id];
        const sb = triageById[b.id];
        if (!sa && !sb) return 0;
        if (!sa) return 1;
        if (!sb) return -1;
        return TIER_RANK[sa.tier] - TIER_RANK[sb.tier] || sb.score - sa.score;
      });
    }
    return list;
  }, [
    rows,
    quick,
    tierFilter,
    prioritySort,
    triageById,
    slaOnly,
    riskFilter,
    viewKey,
  ]);
  const filteredEmpty =
    (quick !== "ALL" ||
      tierFilter !== null ||
      slaOnly ||
      riskFilter !== null ||
      viewKey !== "all") &&
    visibleRows.length === 0 &&
    rows.length > 0;

  // G19 — tier chip counts over the loaded rows (a chip reveals exactly what it counts)
  const tierCounts = useMemo(() => {
    const counts: Record<TriageTier, number> = { P1: 0, P2: 0, P3: 0 };
    for (const c of rows) {
      const s = triageById[c.id];
      if (s) counts[s.tier] += 1;
    }
    return counts;
  }, [rows, triageById]);

  // Dead-UI wiring: per-view counts over the quick-filtered rows, so each
  // switcher badge equals the length of the list it reveals.
  const viewCounts = useMemo(() => {
    const base = rows.filter((c) => matchesQuickFilter(c, quick));
    const out: Record<string, number> = {};
    for (const v of SYSTEM_CRM_VIEWS) out[v.key] = applyCrmView(base, v).length;
    return out;
  }, [rows, quick]);

  // G18 — selection state over the loaded / currently visible rows
  const selectedRows = useMemo(
    () => rows.filter((c) => selected.has(c.id)),
    [rows, selected]
  );
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((c) => selected.has(c.id));
  const someVisibleSelected = visibleRows.some((c) => selected.has(c.id));

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Dead-UI wiring: queue cells that name a case section open the case,
  // then scroll to that section once it renders (capped poller).
  function openCaseAt(caseId: string, sectionId: string) {
    setActiveCase(caseId);
    let tries = 0;
    const tick = () => {
      tries += 1;
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ block: "start" });
        return;
      }
      if (tries < 30) window.setTimeout(tick, 100);
    };
    window.setTimeout(tick, 100);
  }
  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const c of visibleRows) next.delete(c.id);
      else for (const c of visibleRows) next.add(c.id);
      return next;
    });
  }

  type BulkIssue = { reference: string; reason: string };

  /**
   * G18 — run one bulk action over `targets` with Promise.allSettled, then a
   * single summary toast (n updated / m skipped / k failed, with reasons).
   * The queue reloads silently afterwards so the rows reflect the new state.
   */
  async function runBulk(
    targets: Array<{ id: string; reference: string }>,
    skipped: BulkIssue[],
    run: (id: string) => Promise<unknown>
  ) {
    setBulk({ done: 0, total: targets.length });
    const results = await Promise.allSettled(
      targets.map((target) =>
        run(target.id).finally(() =>
          setBulk((b) => (b ? { ...b, done: b.done + 1 } : b))
        )
      )
    );
    setBulk(null);
    let ok = 0;
    const issues: BulkIssue[] = [...skipped];
    results.forEach((result, i) => {
      if (result.status === "fulfilled") ok += 1;
      else {
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        issues.push({ reference: targets[i].reference, reason });
      }
    });
    const failed = results.length - ok;
    const detail = issues
      .slice(0, 3)
      .map((i) => `${i.reference}: ${i.reason}`)
      .join(" · ");
    const overflow = issues.length > 3 ? ` (+${issues.length - 3})` : "";
    toast({
      title: t("rmq.bulkDoneTitle"),
      description:
        t("rmq.bulkSummary", { ok, skipped: skipped.length, failed }) +
        (detail ? ` — ${detail}${overflow}` : ""),
      variant: failed > 0 ? "destructive" : undefined,
    });
    await load(true);
  }

  /** Bulk "assign to me" — skips cases already assigned to the signed-in RM. */
  function startBulkAssign() {
    if (!session) return;
    const assigneeId = session.id;
    const targets = selectedRows
      .filter((c) => c.rm !== session.name)
      .map((c) => ({ id: c.id, reference: c.reference }));
    const skipped = selectedRows
      .filter((c) => c.rm === session.name)
      .map((c) => ({ reference: c.reference, reason: t("rmq.skipMine") }));
    void runBulk(targets, skipped, (id) => api.assignCase(id, assigneeId));
  }

  /** Eligible rows for a bulk data decision (approve or reject): undecided +
      not already closed. One function for both — they must never drift apart. */
  function bulkDataPartition() {
    const targets: Array<{ id: string; reference: string }> = [];
    const skipped: BulkIssue[] = [];
    for (const c of selectedRows) {
      if (
        !TERMINAL_CASE_STATES.has(c.status) &&
        (c.dataApproval === null || c.dataApproval === "PENDING")
      ) {
        targets.push({ id: c.id, reference: c.reference });
      } else {
        skipped.push({
          reference: c.reference,
          reason: TERMINAL_CASE_STATES.has(c.status)
            ? t("rmq.skipTerminal")
            : t("rmq.skipDecided"),
        });
      }
    }
    return { targets, skipped };
  }

  function startBulkApprove() {
    const { targets, skipped } = bulkDataPartition();
    if (targets.length === 0) {
      toast({
        title: t("rmq.bulkDoneTitle"),
        description: t("rmq.bulkSummary", {
          ok: 0,
          skipped: skipped.length,
          failed: 0,
        }),
      });
      return;
    }
    setBulkApproveOpen(true);
  }

  function startBulkReject() {
    const { targets, skipped } = bulkDataPartition();
    if (targets.length === 0) {
      toast({
        title: t("rmq.bulkDoneTitle"),
        description: t("rmq.bulkSummary", {
          ok: 0,
          skipped: skipped.length,
          failed: 0,
        }),
      });
      return;
    }
    setBulkRejectOpen(true);
  }

  /** G22 — export the currently filtered queue rows as a CSV file (client-side). */
  function exportCsv() {
    if (visibleRows.length === 0) {
      toast({ title: t("rmq.exportEmpty") });
      return;
    }
    try {
      const rows = [
        [
          "reference",
          "client",
          "email",
          "nationality",
          "programme",
          "country",
          "status",
          "dataApproval",
          "serviceApproval",
          "documentsApproved",
          "documentsTotal",
          "openRequests",
          "rm",
          "ageDays",
          "updatedAt",
        ],
        ...visibleRows.map((c) => [
          c.reference,
          c.client.name,
          c.client.email,
          c.client.nationality ?? "",
          c.programme?.name ?? "",
          c.programme?.country ?? "",
          c.status,
          c.dataApproval ?? "",
          c.serviceApproval ?? "",
          c.documentsApproved,
          c.documentsTotal,
          c.openRequests,
          c.rm ?? "",
          c.ageDays,
          c.updatedAt,
        ]),
      ];
      const blob = new Blob([csvDocument(rows)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `citizen-lane-queue-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: t("rmq.exportDone"),
        description: t("rmq.exportDoneDesc", { n: visibleRows.length }),
      });
    } catch (e) {
      notifyError(e, t("rmq.exportFailed"));
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 py-6 md:px-8 md:py-8">
      {/* Page head */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Eyebrow>Relationship management</Eyebrow>
          <SectionTitle as="h1">Case queue</SectionTitle>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Every application under your care — approvals, document readiness
            and authority dispatch at a glance. Select a case to open its
            working surface.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setView("studio-runs")}
          className="self-start"
        >
          <LayoutTemplate className="h-4 w-4" />
          Run Inspector
        </Button>
      </div>

      {/* Toolbar */}
      <div className="mt-6 flex flex-col gap-3 border-b border-border/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("rmq.searchPh")}
              aria-label={t("rmq.searchLabel")}
              className="pl-8"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              aria-label={t("rmq.statusFilterLabel")}
              className="w-full sm:w-60"
            >
              <SelectValue placeholder={t("rmq.allStatusesPh")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {CASE_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {settings.labels.caseStatuses[s] ?? caseStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isRm && (
            <label className="flex items-center gap-2 text-sm text-iron-ink">
              <Switch
                checked={mine}
                onCheckedChange={setMine}
                aria-label={t("rmq.mineOnlyLabel")}
              />
              {t("queue.mine")}
            </label>
          )}
        </div>
        <div className="flex items-center gap-2 self-start">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={loading}
          >
            <FileDown className="h-3.5 w-3.5" />
            {t("rmq.exportCsv")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            className="text-muted-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* 10-c · Quick filters — one-tap triage above the list (additive to search/status/mine) */}
      {!loading && rows.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <QueueQuickFilters
            active={quick}
            onChange={setQuick}
            counts={quickCounts}
            t={t}
          />
          {/* G18 · mobile "Select" toggle — reveals row checkboxes (desktop has a permanent column) */}
          {canAct && (
            <button
              type="button"
              aria-pressed={selectMode}
              onClick={() => {
                if (selectMode) setSelected(new Set());
                setSelectMode(!selectMode);
              }}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm transition-colors md:hidden",
                selectMode
                  ? "border-gold bg-gold/15 font-semibold text-cobble-ink"
                  : "border-border bg-card text-iron-ink hover:border-gold/40 hover:bg-muted/40"
              )}
            >
              <ListChecks className="h-4 w-4" aria-hidden />
              {t("rmq.selectMode")}
            </button>
          )}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="mt-3">
          <CrmViewSwitcher
            views={SYSTEM_CRM_VIEWS}
            activeKey={viewKey}
            counts={viewCounts}
            canManage={false}
            onSelect={setViewKey}
          />
        </div>
      )}

      {/* G19 · Triage control row — tier chips with counts, priority sort, recalculation.
          Rendered only once triage is ready: unavailable/loading/error keeps the queue as-is. */}
      {!loading && rows.length > 0 && triageStatus === "ready" && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t("rmq.tierFilter")}
        >
          {(["P1", "P2", "P3"] as const).map((tier) => {
            const isActive = tierFilter === tier;
            return (
              <button
                key={tier}
                type="button"
                aria-pressed={isActive}
                aria-label={t("rmq.tierChip", { tier, n: tierCounts[tier] })}
                onClick={() => setTierFilter(isActive ? null : tier)}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm transition-colors",
                  isActive
                    ? "border-gold bg-gold/15 font-semibold text-cobble-ink shadow-[inset_0_1px_0_0_rgba(199,157,82,0.4)]"
                    : "border-border bg-card text-iron-ink hover:border-gold/40 hover:bg-muted/40 hover:text-cobble-ink"
                )}
              >
                {tier}
                <span
                  aria-label={`${tierCounts[tier]}`}
                  className={cn(
                    "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none",
                    isActive
                      ? "bg-gold text-cobble-ink"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {tierCounts[tier]}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={prioritySort}
            onClick={() => setPrioritySort(!prioritySort)}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm transition-colors",
              prioritySort
                ? "border-gold bg-gold/15 font-semibold text-cobble-ink shadow-[inset_0_1px_0_0_rgba(199,157,82,0.4)]"
                : "border-border bg-card text-iron-ink hover:border-gold/40 hover:bg-muted/40 hover:text-cobble-ink"
            )}
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            {t("rmq.sortPriority")}
          </button>
          {canAct && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto min-h-[44px]"
              onClick={() => void recalculatePriority()}
              disabled={triageBusy}
              aria-busy={triageBusy}
            >
              {triageBusy ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("rmq.recalculate")}
            </Button>
          )}
        </div>
      )}
      {/* Unscored cases vanish under a tier filter with no trace — say so. */}
      {triageStatus === "ready" &&
        tierFilter !== null &&
        (() => {
          const hidden = rows.filter((c) => !triageById[c.id]).length;
          return hidden > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground" role="status">
              {t("rmq.unscoredHidden", { n: hidden })}
            </p>
          ) : null;
        })()}

      {error && (
        <div className="mt-5 flex items-start gap-2 rounded-md border border-coral/50 bg-coral/10 p-4 text-sm text-danger-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <>
          {/* Desktop skeleton */}
          <div className="mt-5 hidden rounded-md border border-border bg-card md:block">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-6 border-b border-border/60 px-5 py-4 last:border-0"
              >
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
          {/* Mobile skeleton */}
          <div className="mt-5 space-y-3 md:hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-md border border-border bg-card p-4 space-y-2.5"
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="h-3 w-3" /> Loading the queue…
          </p>
        </>
      ) : rows.length === 0 ? (
        <EmptyState
          className="mt-8"
          title={t("rmq.noMatchTitle")}
          hint={t("rmq.noMatchHint")}
        />
      ) : filteredEmpty ? (
        <EmptyState
          className="mt-8"
          title={t("rmq.emptyFilterTitle")}
          hint={t("rmq.emptyFilterHint")}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="mt-5 hidden overflow-hidden rounded-md border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {canAct && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          allVisibleSelected
                            ? true
                            : someVisibleSelected
                            ? "indeterminate"
                            : false
                        }
                        onCheckedChange={() => toggleSelectAllVisible()}
                        aria-label={t("rmq.selectAll")}
                      />
                    </TableHead>
                  )}
                  <TableHead className="text-[10px] uppercase tracking-[0.16em]">
                    {t("queue.columns.reference")}
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.16em]">
                    {t("queue.columns.client")}
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.16em]">
                    {t("queue.columns.programme")}
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.16em]">
                    {t("queue.status")}
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.16em]">
                    Approvals
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.16em]">
                    {t("queue.columns.docs")}
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.16em]">
                    {t("queue.columns.rm")}
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.16em]">
                    Age
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-[0.16em]">
                    Updated
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((c) => {
                  const sla = c.ageDays > 14 && EARLY_STAGES.has(c.status);
                  return (
                    <TableRow
                      key={c.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open case ${c.reference} for ${c.client.name}`}
                      onClick={() => setActiveCase(c.id)}
                      onKeyDown={(e) => {
                        // Inner action buttons stop their own events; the row only
                        // answers keys pressed on the row itself.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setActiveCase(c.id);
                        }
                      }}
                      className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40"
                    >
                      {canAct && (
                        <TableCell
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selected.has(c.id)}
                            onCheckedChange={() => toggleSelected(c.id)}
                            aria-label={t("rmq.selectCase", {
                              ref: c.reference,
                            })}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-[13px] font-medium text-cobble-ink">
                        {c.reference}
                      </TableCell>
                      <TableCell>
                        <div className="leading-tight">
                          <p className="font-medium text-cobble-ink">
                            {c.client.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {c.client.email}
                          </p>
                          {c.client.nationality && (
                            <p className="text-[11px] text-muted-foreground/80">
                              {c.client.nationality}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-iron-ink">
                        {c.programme ? (
                          <>
                            {c.programme.name}
                            <span className="block text-xs text-muted-foreground">
                              {c.programme.country}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StateBadge state={c.status} />
                          {triageById[c.id] && (
                            <TierChip score={triageById[c.id]} t={t} />
                          )}
                          {c.riskFlag !== "NONE" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-pressed={riskFilter === c.riskFlag}
                                  aria-label={
                                    (c.riskFlag === "HIGH"
                                      ? "High risk"
                                      : "Low risk") + " — filter queue"
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRiskFilter((f) =>
                                      f === c.riskFlag
                                        ? null
                                        : (c.riskFlag as "HIGH" | "LOW")
                                    );
                                  }}
                                  className={cn(
                                    "rounded-full hover:ring-1 hover:ring-gold/60",
                                    riskFilter === c.riskFlag &&
                                      "ring-1 ring-gold/60"
                                  )}
                                >
                                  <StatusBadge
                                    status={
                                      c.riskFlag === "HIGH"
                                        ? "High risk"
                                        : "Low risk"
                                    }
                                    tone="red"
                                  />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  Show only{" "}
                                  {c.riskFlag === "HIGH"
                                    ? "high-risk"
                                    : "low-risk"}{" "}
                                  cases — click again to clear
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openCaseAt(c.id, "cl-sec-data");
                            }}
                            aria-label={`Open case ${c.reference} at data approval`}
                            className="rounded px-1 py-0.5 text-left hover:bg-muted/40"
                          >
                            <ApprovalMini label="Data" value={c.dataApproval} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openCaseAt(c.id, "cl-sec-data");
                            }}
                            aria-label={`Open case ${c.reference} at service approval`}
                            className="rounded px-1 py-0.5 text-left hover:bg-muted/40"
                          >
                            <ApprovalMini
                              label="Service"
                              value={c.serviceApproval}
                            />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCaseAt(c.id, "cl-sec-requests");
                          }}
                          aria-label={`Open case ${c.reference} at document requests`}
                          className="flex items-center gap-2 whitespace-nowrap rounded px-1 py-0.5 hover:bg-muted/40"
                        >
                          <span className="font-medium tabular-nums text-cobble-ink">
                            {c.documentsApproved}/{c.documentsTotal}
                          </span>
                          {c.openRequests > 0 && (
                            <span className="rounded border border-amber-brand/40 bg-amber-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-ink">
                              {c.openRequests} open req
                              {c.openRequests === 1 ? "" : "s"}
                            </span>
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm text-iron-ink">
                        {c.rm ?? (
                          <span className="text-muted-foreground">
                            Unassigned
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 tabular-nums text-iron-ink">
                          {c.ageDays} d
                          {sla && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={t("rmq.slaLabel")}
                                  aria-pressed={slaOnly}
                                  title={t("rmq.slaLabel")}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSlaOnly((v) => !v);
                                  }}
                                  className={cn(
                                    "inline-flex h-6 min-h-6 w-6 min-w-6 items-center justify-center rounded-full hover:bg-gold/15",
                                    slaOnly && "bg-gold/15 ring-1 ring-gold/60"
                                  )}
                                >
                                  <span
                                    aria-hidden="true"
                                    className="dot-pulse inline-block h-2 w-2 rounded-full bg-amber-brand"
                                  />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  SLA attention — in an early stage beyond 14
                                  days
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {fmtShort(c.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="mt-5 space-y-3 md:hidden">
            {visibleRows.map((c) => (
              <div
                key={c.id}
                className="overflow-hidden rounded-md border border-border bg-card"
              >
                {selectMode && (
                  <div className="flex items-center gap-2.5 border-b border-border/60 bg-muted/30 px-4 py-2">
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={() => toggleSelected(c.id)}
                      aria-label={t("rmq.selectCase", { ref: c.reference })}
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.reference}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setActiveCase(c.id)}
                  aria-label={`Open case ${c.reference} for ${c.client.name}`}
                  className="w-full p-4 text-left transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] font-medium text-cobble-ink">
                      {c.reference}
                    </span>
                    <div className="flex items-center gap-2">
                      {triageById[c.id] && (
                        <TierChip score={triageById[c.id]} t={t} />
                      )}
                      <StateBadge state={c.status} />
                    </div>
                  </div>
                  <p className="mt-2 font-medium text-cobble-ink">
                    {c.client.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.client.email}
                  </p>
                  {c.programme && (
                    <p className="mt-1 text-xs text-iron-ink">
                      {c.programme.name} · {c.programme.country}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <span>
                      Docs{" "}
                      <span className="font-medium tabular-nums text-cobble-ink">
                        {c.documentsApproved}/{c.documentsTotal}
                      </span>
                    </span>
                    {c.openRequests > 0 && (
                      <span>
                        {c.openRequests} open req
                        {c.openRequests === 1 ? "" : "s"}
                      </span>
                    )}
                    <span>{c.ageDays} d old</span>
                    {c.riskFlag !== "NONE" && (
                      <StatusBadge
                        status={
                          c.riskFlag === "HIGH" ? "High risk" : "Low risk"
                        }
                        tone="red"
                      />
                    )}
                    {c.ageDays > 14 && EARLY_STAGES.has(c.status) && (
                      <span className="inline-flex items-center gap-1 text-amber-ink">
                        <span
                          className="dot-pulse inline-block h-1.5 w-1.5 rounded-full bg-amber-brand"
                          aria-hidden
                        />
                        SLA attention
                      </span>
                    )}
                  </div>
                </button>
              </div>
            ))}
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground">
            {visibleRows.length} case{visibleRows.length === 1 ? "" : "s"}
            {quick !== "ALL" && visibleRows.length !== rows.length && (
              <span> of {rows.length}</span>
            )}{" "}
            · {prioritySort ? t("rmq.sortedPriority") : "sorted by last update"}{" "}
            · audit trail records every view and action
          </p>
        </>
      )}

      {/* Party duplicate review (CRM merge slice) — read-only for the desk,
          actions gated senior-only inside the section. Mounted here so review
          sits alongside the queue it protects. */}
      <DuplicateReviewSection />

      {/* G18 · Sticky bulk-action bar — visible while cases are selected or a bulk run
          is in flight. Buttons are real <button>s (keyboard-reachable) and only call
          existing typed api methods; destructive complete/cancel are never bulk-fired. */}
      {canAct && (selected.size > 0 || bulk !== null) && (
        <div
          role="region"
          aria-label={t("rmq.bulkBar")}
          className="sticky bottom-20 z-30 mr-16 mt-4 flex flex-wrap items-center gap-3 rounded-md border border-gold/40 bg-card p-3 shadow-lg lg:bottom-4"
        >
          <span
            aria-live="polite"
            className="text-sm font-semibold text-cobble-ink"
          >
            {bulk
              ? t("rmq.bulkProgress", { done: bulk.done, total: bulk.total })
              : t("rmq.bulkCount", { n: selected.size })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={startBulkAssign}
              disabled={bulk !== null || selectedRows.length === 0}
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              {t("rmq.bulkAssignMe")}
            </Button>
            {canApprove && (
              <Button
                variant="outline"
                size="sm"
                onClick={startBulkApprove}
                disabled={bulk !== null || selectedRows.length === 0}
              >
                <Check className="h-4 w-4" aria-hidden />
                {t("rmq.bulkApproveData")}
              </Button>
            )}
            {canApprove && (
              <Button
                variant="outline"
                size="sm"
                onClick={startBulkReject}
                disabled={bulk !== null || selectedRows.length === 0}
              >
                <X className="h-4 w-4" aria-hidden />
                {t("rmq.bulkRejectData")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={bulk !== null}
            >
              <X className="h-4 w-4" aria-hidden />
              {t("rmq.bulkClear")}
            </Button>
          </div>
        </div>
      )}

      {/* G18 · Bulk data approval — mandatory audit reason; primary review only, every
          approval still awaits senior countersignature (two-person rule). */}
      {bulkApproveOpen && (
        <ReasonDialog
          open
          onOpenChange={(o) => {
            if (!o) setBulkApproveOpen(false);
          }}
          title={t("rmq.bulkApproveTitle")}
          description={t("rmq.bulkApproveDesc")}
          decision="APPROVED"
          confirmLabel={t("rmq.bulkApproveConfirm")}
          onConfirm={(reason) => {
            setBulkApproveOpen(false);
            const { targets, skipped } = bulkDataPartition();
            if (targets.length === 0) return;
            void runBulk(targets, skipped, (id) =>
              api.approveData(id, "APPROVED", reason)
            );
          }}
        />
      )}

      {/* Bulk data rejection — mandatory audit reason. */}
      {bulkRejectOpen && (
        <ReasonDialog
          open
          onOpenChange={(o) => {
            if (!o) setBulkRejectOpen(false);
          }}
          title={t("rmq.bulkRejectTitle")}
          description={t("rmq.bulkRejectDesc")}
          decision="REJECTED"
          confirmLabel={t("rmq.bulkRejectConfirm")}
          onConfirm={(reason) => {
            setBulkRejectOpen(false);
            const { targets, skipped } = bulkDataPartition();
            if (targets.length === 0) return;
            void runBulk(targets, skipped, (id) =>
              api.approveData(id, "REJECTED", reason)
            );
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Decision dialogs (mandatory reason — audit footnote)
// ────────────────────────────────────────────────────────────────────────────

type Decision = "APPROVED" | "REJECTED" | "REQUEST_CHANGES";

/**
 * Quick-pick reason chips (rm.reviewReasons) — clicking one FILLS the textarea
 * so the RM can then edit it. Purely a convenience: the submitted payload stays
 * exactly what the textarea holds.
 */
function ReasonChips({
  reasons,
  onPick,
}: {
  reasons: string[];
  onPick: (reason: string) => void;
}) {
  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {reasons.map((r) => (
        <Button
          key={r}
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-0 whitespace-normal rounded-full px-2.5 py-1 text-xs font-normal leading-snug text-iron-ink"
          onClick={() => onPick(r)}
        >
          {r}
        </Button>
      ))}
    </div>
  );
}

/** Approve / Reject with a mandatory, audit-recorded reason. */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  decision,
  confirmLabel,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  decision: "APPROVED" | "REJECTED";
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useI18n();
  // remounted (keyed) by the parent on each open — state initialises fresh, no reset effect
  const [reason, setReason] = useState("");
  const { settings } = usePlatformSettings();
  const ok = reason.trim().length > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reason-mandatory">Reason (mandatory)</Label>
          <Textarea
            id="reason-mandatory"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t("rmq.reasonPh")}
            aria-required
          />
          <ReasonChips reasons={settings.rm.reviewReasons} onPick={setReason} />
          {!ok && (
            <p className="text-xs text-muted-foreground">
              A reason is required before this decision can be confirmed.
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={decision === "REJECTED" ? "destructive" : "default"}
            disabled={!ok || busy}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy && <Spinner className="h-4 w-4" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Screening outcome recorder: result select + mandatory rationale, same audit discipline as ReasonDialog. */
function ScreeningDialog({
  open,
  onOpenChange,
  checkKey,
  checkLabel,
  initialResult,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  checkKey: string;
  checkLabel: string;
  initialResult: "PASS" | "FAIL" | "REVIEW";
  busy?: boolean;
  onConfirm: (result: "PASS" | "FAIL" | "REVIEW", note: string) => void;
}) {
  const { t } = useI18n();
  // remounted (keyed) by the parent on each open — state initialises fresh, no reset effect
  const [result, setResult] = useState<"PASS" | "FAIL" | "REVIEW">(
    initialResult
  );
  const [note, setNote] = useState("");
  const ok = note.trim().length > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Record screening — {checkLabel}</AlertDialogTitle>
          <AlertDialogDescription>
            Check {checkKey}. A rationale is mandatory and is recorded in the
            audit trail with your name and role. Recording supersedes the prior
            row — history is never rewritten.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="screening-result">Outcome</Label>
            <div
              className="flex gap-2"
              role="radiogroup"
              aria-label={t("rmq.screeningOutcomeLabel")}
            >
              {(["PASS", "REVIEW", "FAIL"] as const).map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant={result === r ? "default" : "outline"}
                  size="sm"
                  onClick={() => setResult(r)}
                  aria-pressed={result === r}
                >
                  {r === "PASS"
                    ? "Pass"
                    : r === "REVIEW"
                    ? "Needs review"
                    : "Fail"}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="screening-note">Rationale (mandatory)</Label>
            <Textarea
              id="screening-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={t("rmq.screeningNotePh")}
              aria-required
            />
            {!ok && (
              <p className="text-xs text-muted-foreground">
                A rationale is required before this outcome can be recorded.
              </p>
            )}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={result === "FAIL" ? "destructive" : "default"}
            disabled={!ok || busy}
            onClick={() => onConfirm(result, note.trim())}
          >
            {busy && <Spinner className="h-4 w-4" />}
            Record{" "}
            {result === "PASS"
              ? "pass"
              : result === "REVIEW"
              ? "review"
              : "fail"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Watchlist match — the QUERY half of screening.
 *
 * It records nothing: it asks the matcher (yente, when the KYC stack is up)
 * about a name across the platform's name-variant set and shows what came
 * back, including the variants that produced each hit. The outcome is still
 * recorded in the ledger above — a score is the matcher's, not a compliance
 * decision, and this dialog is deliberately not able to make one.
 *
 * When the matcher is unreachable the route answers 503 and this dialog shows
 * that failure verbatim: an unreachable matcher must never read as "clean".
 */
function MatchDialog({
  open, onOpenChange, defaultName, defaultCountry,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultName: string;
  defaultCountry: string;
}) {
  const { t } = useI18n();
  // Fresh-mounted per open (parent renders it only while open), so props seed
  // state once — the same convention as ScreeningDialog above.
  const [name, setName] = useState(defaultName);
  const [birthDate, setBirthDate] = useState("");
  const [country, setCountry] = useState(defaultCountry);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScreeningsMatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const q = name.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.matchScreenings({
        name: q,
        birthDate: birthDate.trim() || undefined,
        country: country.trim() || undefined,
      }));
    } catch (e) {
      // The route fails closed (503) rather than returning an empty list, so a
      // failure is surfaced as one — never rendered as "no hits".
      setResult(null);
      setError(e instanceof Error ? e.message : t("rm.match.unreachable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("rm.match.title")}</DialogTitle>
          <DialogDescription>{t("rm.match.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="match-name">{t("rm.match.nameLabel")}</Label>
            <Input id="match-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="match-dob">{t("rm.match.dobLabel")}</Label>
            <Input id="match-dob" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="match-country">{t("rm.match.countryLabel")}</Label>
            <Input id="match-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder={t("rm.match.countryPlaceholder")} />
          </div>
        </div>

        {error !== null && (
          <p role="alert" className="flex items-start gap-2 rounded border border-coral/50 bg-coral/10 p-3 text-sm text-danger-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        )}

        {result !== null && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {t(result.queries.length === 1 ? "rm.match.queriedOne" : "rm.match.queriedMany", {
                  n: result.queries.length,
                  dataset: result.dataset,
                })}
              </span>
              {result.datasets.length > 0 && (
                <span>
                  {t(result.datasets.length === 1 ? "rm.match.listsOne" : "rm.match.listsMany", {
                    n: result.datasets.length,
                  })}
                </span>
              )}
              {result.degraded && <StatusBadge status="partial answer" tone="amber" />}
            </div>

            {result.hits.length === 0 ? (
              <p className="rounded border border-border bg-muted/40 p-3 text-sm text-iron-ink">
                {t("rm.match.noHits")}
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded border border-border">
                {result.hits.map((hit) => (
                  <li key={hit.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-cobble-ink">{hit.caption}</p>
                      <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-gold-ink">{hit.schema}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("rm.match.matchedVia", { via: hit.matchedVia.map((v) => `“${v}”`).join(", ") })}
                      </p>
                      {hit.datasets.length > 0 && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("rm.match.lists", { lists: hit.datasets.join(", ") })}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm text-cobble-ink">{(hit.score * 100).toFixed(0)}%</p>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t("rm.match.score")}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">{result.notice}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.close")}
          </Button>
          <Button onClick={() => void run()} disabled={busy || name.trim().length < 2}>
            {busy ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" aria-hidden />}
            {t("rm.match.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Three-way document review with decision select + mandatory reason. */
function DocReviewDialog({
  target,
  onOpenChange,
  busy,
  onConfirm,
}: {
  target: {
    docId: string;
    docTitle: string;
    docStatus: string;
    decision: Decision;
  };
  onOpenChange: (o: boolean) => void;
  busy?: boolean;
  onConfirm: (decision: Decision, reason: string) => void;
}) {
  const { t } = useI18n();
  // remounted (keyed) by the parent on each open — state initialises from the target, no reset effect
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<Decision>(target.decision);
  const { settings } = usePlatformSettings();

  const ok = reason.trim().length > 0;
  const label =
    decision === "APPROVED"
      ? "Approve document"
      : decision === "REJECTED"
      ? "Reject document"
      : "Request changes";

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Document review — {target.docTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Current status:{" "}
            {(
              settings.labels.docStatuses[target.docStatus] ??
              docStatusLabel(target.docStatus)
            ).toLowerCase()}
            . Your decision and reason are recorded in the audit trail and
            communicated to the client.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="doc-decision">Decision</Label>
          <Select
            value={decision}
            onValueChange={(v) => setDecision(v as Decision)}
          >
            <SelectTrigger
              id="doc-decision"
              aria-label={t("rmq.reviewDecisionLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="APPROVED">
                Approve — document is accepted
              </SelectItem>
              <SelectItem value="REQUEST_CHANGES">
                Request changes — client re-uploads
              </SelectItem>
              <SelectItem value="REJECTED">
                Reject — document is not acceptable
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="doc-reason">Reason (mandatory)</Label>
          <Textarea
            id="doc-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t("rmq.docFeedbackPh")}
            aria-required
          />
          <ReasonChips reasons={settings.rm.reviewReasons} onPick={setReason} />
          {!ok && (
            <p className="text-xs text-muted-foreground">
              A reason is required before this decision can be confirmed.
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={decision === "APPROVED" ? "default" : "destructive"}
            disabled={!ok || busy}
            onClick={() => {
              onConfirm(decision, reason.trim());
            }}
          >
            {busy && <Spinner className="h-4 w-4" />}
            {label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Document row (rich) — rendered whenever document rows are hydratable
// ────────────────────────────────────────────────────────────────────────────

/**
 * DocCommentDialog — attach a note to ONE document (lifecycle `document.comment`).
 * An internal note is staff-only and never reaches the client; a client-visible
 * note is written to the case thread and notifies the applicant.
 */
function DocCommentDialog({
  target,
  onOpenChange,
  busy,
  onConfirm,
}: {
  target: { docId: string; docTitle: string };
  onOpenChange: (o: boolean) => void;
  busy?: boolean;
  onConfirm: (body: string, internal: boolean) => void;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const ok = body.trim().length > 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Note on “{target.docTitle}”</DialogTitle>
          <DialogDescription>
            Record an observation against this one document. A client-visible
            note is posted to the case thread; an internal note stays with
            staff.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="doc-comment">Note</Label>
          <Textarea
            id="doc-comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder={t("rmq.correctionPh")}
            aria-required
          />
        </div>
        <label className="flex items-center gap-2.5 text-sm text-iron-ink">
          <Switch
            checked={internal}
            onCheckedChange={setInternal}
            aria-label={t("rmq.internalNoteLabel")}
          />
          Internal note — staff only, never shown to the client
        </label>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(body.trim(), internal)}
            disabled={!ok || busy}
          >
            {busy && <Spinner className="h-4 w-4" />}
            {internal ? "Save internal note" : "Send comment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fieldLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function DocCard({
  doc,
  canAct,
  onReview,
  onComment,
  busyDocId,
}: {
  doc: DocumentRow;
  canAct: boolean;
  onReview: (t: {
    docId: string;
    docTitle: string;
    docStatus: string;
    decision: Decision;
  }) => void;
  onComment: (t: { docId: string; docTitle: string }) => void;
  busyDocId: string | null;
}) {
  const { t } = useI18n();
  const { settings } = usePlatformSettings();
  const ocr = doc.ocrJobs?.[0] ?? null;
  const fields: ExtractedField[] = doc.fields ?? [];
  const ocrConfidence =
    ocr?.confidence ??
    (fields.length > 0
      ? fields.reduce((a, f) => a + f.confidence, 0) / fields.length
      : null);
  // 10-c — aligned with the review endpoint's own intake rule: a client-confirmed
  // document enters review implicitly (CLIENT_CONFIRMED → IN_REVIEW → decision, both
  // legal steps), so both states are RM-reviewable here. OCR_* / UPLOADED documents
  // await the CLIENT's confirmation and correctly stay non-reviewable for the RM.
  const reviewable =
    canAct && (doc.status === "IN_REVIEW" || doc.status === "CLIENT_CONFIRMED");

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FileText aria-hidden className="h-4 w-4 shrink-0 text-gold-ink" />
            <p className="font-medium text-cobble-ink">{doc.title}</p>
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-iron-ink">
              {settings.labels.docTypes[doc.type] ??
                DOC_TYPE_LABELS[doc.type] ??
                doc.type}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              v{doc.version}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StateBadge state={doc.status} />
            {doc.scanStatus === "CLEAN" ? (
              <StatusBadge status="Scanned clean" tone="green" />
            ) : (
              <StatusBadge status={doc.scanStatus} tone="amber" />
            )}
            {ocr && (
              <span className="text-[11px] text-muted-foreground">
                OCR ·{" "}
                <span className="font-medium text-iron-ink">
                  {ocr.provider}
                </span>
              </span>
            )}
            {fields.length > 0 && <ProvisionalChip />}
          </div>
        </div>
        {canAct && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={busyDocId === doc.id}
              onClick={() => onComment({ docId: doc.id, docTitle: doc.title })}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Comment
            </Button>
            {reviewable && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyDocId === doc.id}
                  onClick={() =>
                    onReview({
                      docId: doc.id,
                      docTitle: doc.title,
                      docStatus: doc.status,
                      decision: "APPROVED",
                    })
                  }
                >
                  <Check className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyDocId === doc.id}
                  onClick={() =>
                    onReview({
                      docId: doc.id,
                      docTitle: doc.title,
                      docStatus: doc.status,
                      decision: "REQUEST_CHANGES",
                    })
                  }
                >
                  {t("action.requestChanges")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-danger-ink hover:bg-coral/10 hover:text-danger-ink"
                  disabled={busyDocId === doc.id}
                  onClick={() =>
                    onReview({
                      docId: doc.id,
                      docTitle: doc.title,
                      docStatus: doc.status,
                      decision: "REJECTED",
                    })
                  }
                >
                  <X className="h-3.5 w-3.5" /> {t("action.reject")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {ocrConfidence !== null && fields.length > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Extraction confidence
          </span>
          <ConfidenceBar value={ocrConfidence} />
        </div>
      )}

      {doc.reviews.length > 0 && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded border border-border/70 bg-muted/30 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Past reviews
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {doc.reviews.map((r) => (
              <li key={r.id} className="text-xs leading-relaxed text-iron-ink">
                <StateBadge state={r.decision} className="mr-2 align-middle" />
                <span className="text-muted-foreground">
                  {r.reviewer.name} · {fmtDateTime(r.createdAt)} —
                </span>{" "}
                {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {doc.comments && doc.comments.length > 0 && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded border border-border/70 bg-muted/30 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Document notes
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {doc.comments.map((cm) => (
              <li key={cm.id} className="text-xs leading-relaxed text-iron-ink">
                <span className="text-muted-foreground">
                  {cm.author.name}
                  {cm.internal && (
                    <span className="ml-1.5 rounded border border-border bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider">
                      internal
                    </span>
                  )}{" "}
                  · {fmtDateTime(cm.createdAt)} —
                </span>{" "}
                {cm.body}
              </li>
            ))}
          </ul>
        </div>
      )}

      {fields.length > 0 && (
        <Accordion type="single" collapsible className="mt-3">
          <AccordionItem
            value={`fields-${doc.id}`}
            className="border-border/70"
          >
            <AccordionTrigger className="py-2 text-xs uppercase tracking-[0.14em] text-muted-foreground hover:no-underline">
              Extracted fields ({fields.length}) — read-only for RM
            </AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-2">
                {fields.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-iron-ink">
                      <span className="text-muted-foreground">
                        {fieldLabel(f.fieldKey)}:
                      </span>{" "}
                      <span
                        className={cn(
                          "font-medium",
                          f.edited && "text-olive-ink"
                        )}
                      >
                        {f.value || (
                          <span className="italic text-muted-foreground">
                            empty
                          </span>
                        )}
                      </span>
                      {f.edited && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-olive-ink">
                          edited
                        </span>
                      )}
                    </span>
                    <ConfidenceBar value={f.confidence} />
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// RmCaseDetail
// ────────────────────────────────────────────────────────────────────────────

/** Human labels for the generatable letter types. */
const LETTER_TYPE_LABELS: Record<string, string> = {
  APPROVAL_IN_PRINCIPLE: "Approval in principle",
  FINAL_APPROVAL: "Final approval",
  DOCUMENT_REQUEST: "Document request",
  ENGAGEMENT_FEE_PROPOSAL: "Engagement & fee proposal",
  PAYMENT_RECEIPT: "Payment receipt",
};

/**
 * Official letters (letterbox) — generate on letterhead, list, download.
 * Real pdfkit letters rendered from live case data by /api/cases/[id]/letters;
 * every issue/download is audited and the client is notified automatically.
 */
function OfficialLettersPanel({
  caseId,
  canAct,
}: {
  caseId: string;
  canAct: boolean;
}) {
  const { t } = useI18n();
  const { settings } = usePlatformSettings();
  const [rows, setRows] = useState<LetterRow[] | null>(null);
  const [type, setType] = useState<string>("APPROVAL_IN_PRINCIPLE");
  const { status, error, run, reset } = useMutationStatus();
  const busy = status === "pending";
  // Letter-type labels resolve settings-first (canon underneath), LETTER_TYPE_LABELS as fallback.
  const letterTypeLabels: Record<string, string> = {
    ...LETTER_TYPE_LABELS,
    ...settings.labels.letterTypes,
  };

  const load = useCallback(async () => {
    try {
      const res = await api.letters(caseId);
      setRows(res.letters as unknown as LetterRow[]);
    } catch {
      setRows([]);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    await run(async () => {
      const res = await api.generateLetter(caseId, type);
      toast({
        title: "Letter issued",
        description: `${
          res.letter.ref ?? res.letter.fileName
        } — the client has been notified and can download it from their portal.`,
      });
      await load();
    });
  }

  async function download(row: LetterRow) {
    try {
      const blob = await api.downloadLetterById(row.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = row.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      notifyError(e, "Download failed");
    }
  }

  return (
    <Card className="rounded-md border-border p-5 md:p-6">
      <CardHead
        eyebrow="Correspondence · 08"
        title={t("clx.officialLetters")}
        action={
          <StatusBadge
            status={`${rows?.length ?? 0} on file`}
            tone={rows && rows.length > 0 ? "green" : "neutral"}
          />
        }
      />
      <p className="mt-4 text-sm leading-relaxed text-iron-ink">
        Generate firm letters on the Citizen Lane letterhead — rendered from
        live case data as signed PDFs, recorded in the letter registry, and
        delivered to the client's portal with an automatic notification.
      </p>
      {canAct && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger
              className="w-[260px] bg-card"
              aria-label={t("rmq.letterTypeLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(letterTypeLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => void generate()}
            disabled={busy}
            className="bg-cobble hover:bg-[#1B3A54] text-[#F5F1EA]"
          >
            {busy ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Generate &amp; issue
          </Button>
          <MutationStatus
            status={status}
            error={error}
            label="Generating letter"
          />
        </div>
      )}
      <div className="mt-4 max-h-96 overflow-y-auto">
        {rows === null ? (
          <p className="py-3 text-sm text-muted-foreground">Loading letters…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No letters issued yet for this case.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3.5 py-2.5"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <FileText
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-cobble-ink">
                      {letterTypeLabels[row.type ?? ""] ?? "Letter"}{" "}
                      {row.ref ? (
                        <span className="text-muted-foreground">
                          · {row.ref}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.fileName} · v{row.version} ·{" "}
                      {fmtDateTime(row.createdAt)} · issued by {row.issuedBy}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void download(row)}
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function RmCaseDetail() {
  const activeCaseId = useApp((s) => s.activeCaseId);
  const setActiveCase = useApp((s) => s.setActiveCase);
  const session = useApp((s) => s.session);
  const role = session?.role ?? "RM";
  const canAct = role === "RM" || role === "SENIOR_RM" || role === "ADMIN";
  const { t } = useI18n();
  const { settings } = usePlatformSettings();

  // Keyboard shortcuts for power users
  useKeyboardShortcuts({
    r: () => void load(true),
    n: () => nextAction && jumpToNext(nextAction),
    Escape: () => {
      // Close any open dialog
      setDataDialog(null);
      setServiceDialog(null);
      setDocDialog(null);
      setCommentDialog(null);
      setScreeningForm(null);
      setMatchOpen(false);
      setClosureDialog(null);
      setDispatchOpen(false);
      setReqOpen(false);
    },
  });

  const [row, setRow] = useState<QueueRow | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [letter, setLetter] = useState<LetterMeta | null>(null);
  const [letterDownload, setLetterDownload] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [detailCase, setDetailCase] = useState<
    Awaited<ReturnType<typeof api.caseDetail>>["case"] | null
  >(null);
  const [screening, setScreening] = useState<Awaited<
    ReturnType<typeof api.screenings>
  > | null>(null);
  const [screeningForm, setScreeningForm] = useState<{
    checkKey: string;
    result: "PASS" | "FAIL" | "REVIEW";
    note: string;
  } | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [extraRequests, setExtraRequests] = useState<CreatedRequest[]>([]);
  const [localDest, setLocalDest] = useState<string | null>(null);
  const [localFollowUp, setLocalFollowUp] = useState<{
    dueDate: string;
    weeks: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triage, setTriage] = useState<
    import("@/lib/api-client").TriageScore | null
  >(null);

  // dialog + busy state
  const [busy, setBusy] = useState(false);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [dataDialog, setDataDialog] = useState<{
    decision: "APPROVED" | "REJECTED" | "COUNTERSIGN";
  } | null>(null);
  const [serviceDialog, setServiceDialog] = useState<{
    decision: "APPROVED" | "REJECTED" | "COUNTERSIGN";
  } | null>(null);
  const [docDialog, setDocDialog] = useState<{
    docId: string;
    docTitle: string;
    docStatus: string;
    decision: Decision;
  } | null>(null);
  const [commentDialog, setCommentDialog] = useState<{
    docId: string;
    docTitle: string;
  } | null>(null);
  const [editClientDialog, setEditClientDialog] = useState<{
    name: string;
    phone: string;
    address: string;
    city: string;
    country: string;
    nationality: string;
    dateOfBirth: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!activeCaseId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [queueRes, timelineRes, letterRes] = await Promise.all([
          api.rmCases(),
          api.timeline(activeCaseId),
          // no letter yet (404) or transient failure — the card degrades to the upload state
          api.downloadLetter(activeCaseId).catch(() => null),
        ]);
        setRow(queueRes.cases.find((c) => c.id === activeCaseId) ?? null);
        setHistory(timelineRes.history);
        setComments(timelineRes.comments);
        if (letterRes) {
          setLetter({
            fileName: letterRes.letter.fileName,
            version: letterRes.letter.version,
            createdAt: letterRes.letter.createdAt,
          });
          setLetterDownload(letterRes.download);
        } else {
          setLetter(null);
          setLetterDownload(null);
        }

        // ── Staff case detail — documents (fields/reviews/OCR), requests, client profile ──
        const detail = await api.caseDetail(activeCaseId).catch(() => null);
        if (detail) {
          setDocs(detail.case.documents as unknown as DocumentRow[]);
          setDetailCase(detail.case);
        } else {
          setDocs([]);
          setDetailCase(null);
        }

        // ── KYC/AML screening posture — current results, outstanding, blocked ──
        const scr = await api.screenings(activeCaseId).catch(() => null);
        setScreening(scr);

        // ── Triage score for personal workload view (S4) ──
        const triageScore = await api
          .triageCase(activeCaseId)
          .catch(() => null);
        setTriage(triageScore);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "This case could not be loaded."
        );
        setRow(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeCaseId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const flowOpen =
    row !== null && row.status !== "CANCELLED" && row.status !== "COMPLETED";
  // mirrors the backend guard: dispatch allowed from IN_PROGRESS / FOLLOW_UP / DISPATCHED
  const canDispatch =
    row !== null &&
    ["IN_PROGRESS", "FOLLOW_UP", "DISPATCHED"].includes(row.status);
  const dataDecidable =
    canAct &&
    flowOpen &&
    (row?.dataApproval === null || row?.dataApproval === "PENDING");
  const serviceDecidable =
    canAct &&
    flowOpen &&
    row?.serviceApproval !== "APPROVED" &&
    row?.programme !== null;

  const dataHistory = useMemo(
    () =>
      history.find(
        (h) =>
          h.to === "DATA_APPROVED" ||
          (h.to === "ONBOARDING" && h.command === "approve-data")
      ) ?? null,
    [history]
  );
  const serviceHistory = useMemo(
    () => history.find((h) => h.to === "SERVICE_APPROVED") ?? null,
    [history]
  );

  // ── Next best action (10-c) ─────────────────────────────────────────────
  // The FIRST pending item computed from real case state, in a fixed priority:
  // (a) documents awaiting the RM decision → (b) open approval gates →
  // (c) unanswered client message → (d) nothing pending. Derived only from the
  // data already loaded in `load()` — no invented signals.

  type NextAction = {
    anchorId: string;
    label: string;
    desc: string;
    block: "start" | "center";
  };

  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );

  /** Review-intake states the review endpoint accepts in one call (see documents/[id]/[action]). */
  const reviewableDocs = useMemo(
    () =>
      docs.filter(
        (d) => d.status === "IN_REVIEW" || d.status === "CLIENT_CONFIRMED"
      ),
    [docs]
  );

  const unansweredClient = useMemo(() => {
    const thread = comments
      .filter((c) => !c.internal)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    const last = thread[thread.length - 1];
    return last && last.author.role === "CLIENT" ? last : null;
  }, [comments]);

  const nextAction: NextAction | null = (() => {
    if (!canAct) return null;
    if (reviewableDocs.length > 0) {
      return {
        anchorId: "cl-sec-documents",
        label: t("clx.stageReview"),
        desc: withN(t("gs.rmS1d"), reviewableDocs.length),
        block: "start",
      };
    }
    if (dataDecidable) {
      return {
        anchorId: "cl-sec-data",
        label: "Open",
        desc: "Client data — secondary approval pending.",
        block: "start",
      };
    }
    if (serviceDecidable) {
      return {
        anchorId: "cl-sec-service",
        label: "Open",
        desc: "Programme choice — approval pending.",
        block: "start",
      };
    }
    if (unansweredClient) {
      return {
        anchorId: "cl-sec-composer",
        label: "Reply",
        desc: `Message from ${unansweredClient.author.name} awaiting your reply.`,
        block: "center",
      };
    }
    return null;
  })();

  /** Smooth-scroll to a section and flash it with a brief gold ring. */
  function jumpToNext(action: NextAction) {
    const el = document.getElementById(action.anchorId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: action.block });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashId(action.anchorId);
    flashTimer.current = setTimeout(() => setFlashId(null), 2200);
  }

  /** Record a screening outcome, then refresh the posture. */
  async function submitScreening(reason: string) {
    if (!activeCaseId || !screeningForm) return;
    setBusy(true);
    try {
      await api.recordScreening(activeCaseId, {
        checkKey: screeningForm.checkKey,
        result: screeningForm.result,
        note: reason || screeningForm.note,
      });
      toast({
        title: "Screening recorded",
        description: "Outcome recorded in the audit trail.",
      });
      setScreeningForm(null);
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  /** Scroll offset (below shell header + sticky bar) and the gold flash ring. */
  const sectionCls = (id: string) =>
    cn(
      "scroll-mt-32 transition-shadow duration-700",
      flashId === id && "ring-2 ring-gold ring-offset-2 ring-offset-background"
    );

  // ── mutations ──
  async function decideData(reason: string) {
    if (!activeCaseId || !dataDialog) return;
    setBusy(true);
    try {
      if (dataDialog.decision === "COUNTERSIGN") {
        await api.countersignData(activeCaseId, reason);
        toast({
          title: "Client data countersigned",
          description:
            "The two-person rule is satisfied — the client has been notified.",
        });
      } else {
        await api.approveData(activeCaseId, dataDialog.decision, reason);
        toast({
          title:
            dataDialog.decision === "APPROVED"
              ? "Primary review recorded"
              : "Client data rejected",
          description:
            dataDialog.decision === "APPROVED"
              ? "Awaiting senior countersignature — recorded in the audit trail."
              : "Decision recorded in the audit trail — the client has been notified.",
        });
      }
      setDataDialog(null);
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  /** Send a rejected case back to the client for correction (un-wedges the review). */
  async function requestCorrection() {
    if (!activeCaseId) return;
    const reason = window.prompt("What must the client correct or re-submit?");
    if (reason === null) return; // cancelled — do nothing
    setBusy(true);
    try {
      await api.requestDataCorrection(activeCaseId, reason.trim());
      toast({
        title: "Correction requested",
        description: "The client can re-submit their details.",
      });
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  async function decideService(reason: string) {
    if (!activeCaseId || !serviceDialog) return;
    setBusy(true);
    try {
      if (serviceDialog.decision === "COUNTERSIGN") {
        await api.countersignService(activeCaseId, reason);
        toast({
          title: "Programme choice countersigned",
          description:
            "The two-person rule is satisfied — the standard document set has been issued.",
        });
      } else {
        await api.approveService(activeCaseId, serviceDialog.decision, reason);
        toast({
          title:
            serviceDialog.decision === "APPROVED"
              ? "Primary selection review recorded"
              : "Programme choice rejected",
          description:
            serviceDialog.decision === "APPROVED"
              ? "Awaiting senior countersignature — recorded in the audit trail."
              : "The client has been notified to discuss the selection.",
        });
      }
      setServiceDialog(null);
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  async function reviewDoc(decision: Decision, reason: string) {
    if (!docDialog) return;
    setBusy(true);
    try {
      await api.reviewDocument(docDialog.docId, decision, reason);
      toast({
        title:
          decision === "APPROVED"
            ? "Document approved"
            : decision === "REJECTED"
            ? "Document rejected"
            : "Changes requested",
        description: "The client has been notified with your reason.",
      });
      setDocDialog(null);
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
      setBusyDocId(null);
    }
  }

  async function addDocComment(body: string, internal: boolean) {
    if (!commentDialog) return;
    setBusy(true);
    try {
      await api.commentDocument(commentDialog.docId, body, internal);
      toast({
        title: internal ? "Internal note saved" : "Comment sent",
        description: internal
          ? "Visible to staff only — the client cannot see this note."
          : "The client has been notified.",
      });
      setCommentDialog(null);
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  // ── timeline feed ──
  const feed = useMemo<
    Array<
      | {
          kind: "status";
          id: string;
          at: number;
          from: string | null;
          to: string;
          reason: string | null;
          command: string | null;
        }
      | {
          kind: "comment";
          id: string;
          at: number;
          internal: boolean;
          author: string;
          role: string;
          body: string;
        }
    >
  >(() => {
    const items = [
      ...history.map((h) => ({
        kind: "status" as const,
        id: h.id,
        at: new Date(h.createdAt).getTime(),
        from: h.from,
        to: h.to,
        reason: h.reason,
        command: h.command,
      })),
      ...comments.map((c) => ({
        kind: "comment" as const,
        id: c.id,
        at: new Date(c.createdAt).getTime(),
        internal: c.internal,
        author: c.author.name,
        role: c.author.role,
        body: c.body,
      })),
    ];
    return items.sort((a, b) => b.at - a.at);
  }, [history, comments]);

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const typingCooldown = useRef(0);

  // ── Realtime: live client messages + typing + presence (socket.io, REST fallback in hook) ──
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const {
    connected: chatConnected,
    onlineUsers: chatOnline,
    typingUser: chatTyping,
    send: chatSend,
    notifyTyping,
  } = useCaseChat(activeCaseId, {
    onMessage: useCallback(
      (m: { author: { name: string }; body: string }) => {
        if (m.author.name === session?.name) return;
        toast({ title: `${m.author.name}`, description: m.body.slice(0, 120) });
        void loadRef.current(true);
      },
      [session?.name]
    ),
  });

  async function sendMessage() {
    if (!activeCaseId || !message.trim()) return;
    setSending(true);
    try {
      // Realtime path (socket.io, room broadcast) — falls back to REST inside the hook.
      const ok = await chatSend(message.trim());
      if (ok) notifyTyping(false);
      toast({
        title: ok ? "Message sent to client" : "Message not sent",
        description: ok
          ? "Delivered live to the client portal and notification channels."
          : undefined,
      });
      setMessage("");
      await load(true);
    } catch (e) {
      notifyError(e, "Message not sent");
    } finally {
      setSending(false);
    }
  }

  // Mirror the client-portal composer: announce typing on edit, throttled so
  // every keystroke does not fan out a broadcast.
  function onComposerChange(v: string) {
    setMessage(v);
    const now = Date.now();
    if (v.trim() && now - typingCooldown.current > 1500) {
      typingCooldown.current = now;
      notifyTyping(true);
    }
  }

  // ── dispatch ──
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [followUpWeeks, setFollowUpWeeks] = useState("6");

  async function dispatchDossier() {
    if (!activeCaseId || !destination.trim()) return;
    setBusy(true);
    try {
      const res = await api.dispatch(
        activeCaseId,
        destination.trim(),
        selectedDocs
      );
      setLocalDest(destination.trim());
      toast({
        title: "Dossier dispatched to authority",
        description: `DHL tracking ${res.dispatch.trackingId}${
          res.sandbox ? " (sandbox adapter)" : ""
        } — a 6-week follow-up was created automatically.`,
      });
      setDispatchOpen(false);
      setDestination("");
      setSelectedDocs([]);
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  async function scheduleFollowUp() {
    if (!activeCaseId) return;
    setBusy(true);
    try {
      const weeks = Number(followUpWeeks);
      await api.scheduleFollowUp(activeCaseId, weeks);
      setLocalFollowUp({
        weeks,
        dueDate: new Date(Date.now() + weeks * 7 * 86400000).toISOString(),
      });
      toast({
        title: `Follow-up scheduled in ${weeks} weeks`,
        description: "The case moves to authority follow-up.",
      });
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  // ── letter ──
  const [uploadingLetter, setUploadingLetter] = useState(false);
  async function handleLetterFile(file: File) {
    if (!activeCaseId) return;
    if (
      !file.name.toLowerCase().endsWith(".pdf") ||
      (file.type && file.type !== "application/pdf")
    ) {
      toast({
        title: "PDF only",
        description: "The approval letter must be a PDF document.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "The approval letter must be under 10 MB.",
        variant: "destructive",
      });
      return;
    }
    setUploadingLetter(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const s = String(reader.result ?? "");
          resolve(s.slice(s.indexOf(",") + 1));
        };
        reader.onerror = () => reject(new Error("The file could not be read."));
        reader.readAsDataURL(file);
      });
      await api.uploadLetter(activeCaseId, file.name, base64);
      toast({
        title: "Approval letter uploaded",
        description:
          "Client is notified automatically; case moves to Approved in principle.",
      });
      await load(true);
    } catch (e) {
      notifyError(e, "Letter not uploaded");
    } finally {
      setUploadingLetter(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function downloadLetterFile() {
    if (!letterDownload || !letter) return;
    try {
      const bin = window.atob(letterDownload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = letter.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Download failed",
        description: "The letter bytes are unavailable in this sandbox.",
        variant: "destructive",
      });
    }
  }

  // ── document request ──
  const [reqOpen, setReqOpen] = useState(false);
  const [reqType, setReqType] = useState<string>("OTHER");
  const [reqTitle, setReqTitle] = useState("");
  const [reqInstructions, setReqInstructions] = useState("");
  const [reqDue, setReqDue] = useState("14");
  const [notNeededId, setNotNeededId] = useState<string | null>(null);
  const [notNeededReason, setNotNeededReason] = useState("");

  async function markNotNeeded() {
    if (!notNeededId || !notNeededReason.trim()) return;
    setBusy(true);
    try {
      await api.markRequestNotNeeded(notNeededId, notNeededReason.trim());
      setExtraRequests((prev) =>
        prev.map((r) =>
          r.id === notNeededId ? { ...r, status: "NOT_NEEDED" } : r
        )
      );
      setNotNeededId(null);
      setNotNeededReason("");
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  async function createRequest() {
    if (!activeCaseId || !reqTitle.trim() || !reqInstructions.trim()) return;
    setBusy(true);
    try {
      const res = (await api.createRequest(activeCaseId, {
        docType: reqType,
        title: reqTitle.trim(),
        instructions: reqInstructions.trim(),
        dueInDays: Number(reqDue) > 0 ? Number(reqDue) : undefined,
      })) as { request: { id: string } };
      setExtraRequests((prev) => [
        {
          id: res.request.id,
          docType: reqType,
          title: reqTitle.trim(),
          instructions: reqInstructions.trim(),
          dueDate:
            Number(reqDue) > 0
              ? new Date(Date.now() + Number(reqDue) * 86400000).toISOString()
              : null,
          status: "OPEN",
        },
        ...prev,
      ]);
      toast({
        title: "Document requested",
        description: `${reqTitle.trim()} — the client has been notified.`,
      });
      setReqOpen(false);
      setReqTitle("");
      setReqInstructions("");
      setReqDue("14");
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  // ── case closure ──
  const [closureDialog, setClosureDialog] = useState<
    null | "complete" | "cancel"
  >(null);
  async function closeCase(action: "complete" | "cancel", reason: string) {
    if (!activeCaseId) return;
    setBusy(true);
    try {
      if (action === "complete") await api.completeCase(activeCaseId, reason);
      else await api.cancelCase(activeCaseId, reason);
      toast({
        title: action === "complete" ? "Case completed" : "Case cancelled",
        description:
          "The client has been notified; the transition is audit-recorded.",
      });
      setClosureDialog(null);
      await load(true);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  // ── null / loading / error states ──
  if (!activeCaseId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-16 md:px-8">
        <EmptyState
          title={t("rmq.selectCaseEmptyTitle")}
          hint={t("rmq.selectCaseEmptyHint")}
        />
        <div className="mt-5 flex justify-center">
          <Button variant="outline" onClick={() => setActiveCase(null)}>
            <ArrowLeft className="h-4 w-4" /> Back to queue
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-5 px-5 py-6 md:px-8 md:py-8">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="ml-auto h-6 w-28 rounded-full" />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full rounded-md" />
            ))}
          </div>
          <div className="space-y-5">
            <Skeleton className="h-40 w-full rounded-md" />
            <Skeleton className="h-32 w-full rounded-md" />
          </div>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="h-3 w-3" /> Opening the case dossier…
        </p>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-16 md:px-8">
        <EmptyState
          title={
            error ? t("rmq.caseUnavailable") : t("rmq.selectCaseEmptyTitle")
          }
          hint={error ?? t("rmq.selectCaseEmptyHintShort")}
        />
        <div className="mt-5 flex justify-center">
          <Button variant="outline" onClick={() => setActiveCase(null)}>
            <ArrowLeft className="h-4 w-4" /> Back to queue
          </Button>
        </div>
      </div>
    );
  }

  const approvedDocs = docs.filter((d) => d.status === "RM_APPROVED");

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 py-6 md:px-8 md:py-8">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-border/70 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setActiveCase(null)}
            aria-label={t("rmq.backToQueueLabel")}
            className="mt-0.5 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <Eyebrow>Case working surface</Eyebrow>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="font-editorial text-2xl tracking-wide text-cobble-ink md:text-[28px]">
                {row.reference}
              </h1>
              <StateBadge state={row.status} />
              {row.riskFlag !== "NONE" && (
                <StatusBadge
                  status={row.riskFlag === "HIGH" ? "High risk" : "Low risk"}
                  tone="red"
                />
              )}
              {!canAct && (
                <StatusBadge status="Read-only · auditor" tone="amber" />
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              <span className="font-medium text-cobble-ink">
                {row.client.name}
              </span>
              {row.programme && (
                <>
                  {" "}
                  · {row.programme.name} — {row.programme.country}
                </>
              )}
              {row.rm && <> · RM {row.rm}</>}
            </p>
          </div>
        </div>
        <div className="text-left text-xs text-muted-foreground lg:text-right flex flex-wrap items-center gap-4">
          <div>
            <p>
              Case age{" "}
              <span className="font-medium tabular-nums text-cobble-ink">
                {row.ageDays} d
              </span>
            </p>
            <p className="mt-0.5">Updated {fmtDateTime(row.updatedAt)}</p>
          </div>
          {canAct && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(
                      `/api/cases/${activeCaseId}/audit-bundle`,
                      "_blank"
                    )
                  }
                  aria-label={t("rmq.exportAuditBundle")}
                  disabled={!activeCaseId}
                >
                  <FileDown className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {t("rmq.exportAuditBundle")}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-56 text-xs">
                  {t("rmq.exportAuditBundleDesc")}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      {/* ── Keyboard shortcuts help (always visible in header for quick access) ── */}
      {canAct && (
        <div
          className="sticky top-14 z-10 mt-4 mb-4 lg:top-16"
          role="region"
          aria-label={t("rmq.shortcuts")}
        >
          <KeyboardShortcutsHelp />
        </div>
      )}

      {/* ── Vitals strip — live progress, doc counts, SLA ── */}
      {canAct && activeCaseId && (
        <div
          className="sticky top-14 z-10 mt-2 lg:top-16"
          role="region"
          aria-label={t("rmq.vitals")}
        >
          <VitalsStrip caseId={activeCaseId} />
        </div>
      )}

      {/* ── Next best action (10-c) — slim sticky bar under the case header ── */}
      {canAct && (
        <div
          className="sticky top-14 z-20 mt-6 lg:top-16"
          role="region"
          aria-label={t("rmq.next")}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-cobble bg-cobble px-4 py-2.5 shadow-md md:px-5">
            <Eyebrow className="shrink-0">{t("rmq.next")}</Eyebrow>
            {nextAction ? (
              <>
                <p className="min-w-0 flex-1 text-sm text-[#E9E2D5]">
                  {nextAction.desc}
                </p>
                <Button
                  size="sm"
                  onClick={() => jumpToNext(nextAction)}
                  aria-label={`${nextAction.label} — ${nextAction.desc}`}
                  className="min-h-[44px] shrink-0 bg-gold text-cobble-ink hover:bg-[#D4AF6A]"
                >
                  {nextAction.label}
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </>
            ) : (
              <p className="flex min-w-0 flex-1 items-center gap-2 py-1 text-sm text-[#B9C4CE]">
                <Check className="h-4 w-4 shrink-0 text-gold-ink" aria-hidden />
                {t("rmq.nextEmpty")}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-7 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ══ MAIN COLUMN ══════════════════════════════════════════════════ */}
        <div className="space-y-6">
          {/* 1 · Secondary approval — client data */}
          <Card
            id="cl-sec-data"
            className={cn(
              "rounded-md border-border scroll-mt-20 p-5 md:p-6",
              sectionCls("cl-sec-data")
            )}
          >
            <CardHead
              eyebrow="Secondary approval · 01"
              title={t("rmq.secClientData")}
              action={
                row.dataApproval ? (
                  <StateBadge state={row.dataApproval} />
                ) : (
                  <StatusBadge status="Awaiting review" tone="amber" />
                )
              }
            />
            <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Client
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2">
                        ⓘ
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-56 text-xs">
                        {t("legal.basis.name")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </p>
                <p className="mt-1 flex items-center gap-2.5 font-medium text-cobble-ink">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cobble text-xs font-semibold text-[#F5F1EA]">
                    {initialsOf(row.client.name)}
                  </span>
                  {row.client.name}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Email
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2">
                        ⓘ
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-56 text-xs">
                        {t("legal.basis.email")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </p>
                <p className="mt-1 text-sm text-iron-ink">{row.client.email}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Nationality
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2">
                        ⓘ
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-56 text-xs">
                        {t("legal.basis.nationality")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </p>
                <p className="mt-1 text-sm text-iron-ink">
                  {row.client.nationality ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t("case.rm")}
                </p>
                <p className="mt-1 text-sm text-iron-ink">
                  {row.rm ?? "Unassigned"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Date of birth
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2">
                        ⓘ
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-56 text-xs">
                        {t("legal.basis.dateOfBirth")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </p>
                <p className="mt-1 text-sm text-iron-ink">
                  {detailCase?.client.dateOfBirth ?? "—"}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Phone
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2">
                        ⓘ
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-56 text-xs">
                        {t("legal.basis.phone")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </p>
                <p className="mt-1 text-sm text-iron-ink">
                  {detailCase?.client.phone ?? "—"}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Address
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2">
                        ⓘ
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-56 text-xs">
                        {t("legal.basis.address")}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </p>
                <p className="mt-1 text-sm text-iron-ink">
                  {detailCase?.client.address ?? "—"}
                  {detailCase?.client.city ? `, ${detailCase.client.city}` : ""}
                  {detailCase?.client.country
                    ? `, ${detailCase.client.country}`
                    : ""}
                </p>
              </div>
            </div>
            {canAct && (
              <div className="mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setEditClientDialog({
                      name: detailCase?.client.name ?? "",
                      phone: detailCase?.client.phone ?? "",
                      address: detailCase?.client.address ?? "",
                      city: detailCase?.client.city ?? "",
                      country: detailCase?.client.country ?? "",
                      nationality: detailCase?.client.nationality ?? "",
                      dateOfBirth: detailCase?.client.dateOfBirth ?? "",
                    })
                  }
                >
                  <UserPlus className="h-4 w-4" /> Edit client details
                </Button>
              </div>
            )}
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              Two-person rule: an advisor performs the primary review; a senior
              advisor countersigns before the data is approved. Any correction
              is appended to the case history with your reason.
            </p>

            {dataDecidable ? (
              <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-4">
                <Button onClick={() => setDataDialog({ decision: "APPROVED" })}>
                  <ShieldCheck className="h-4 w-4" /> Approve data (primary
                  review)
                </Button>
                <Button
                  variant="outline"
                  className="text-danger-ink hover:bg-coral/10 hover:text-danger-ink"
                  onClick={() => setDataDialog({ decision: "REJECTED" })}
                >
                  Reject
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Reason is mandatory — recorded in the audit trail.
                </span>
              </div>
            ) : (
              <div className="mt-4 border-t border-border/60 pt-4">
                {row.dataApproval === "PRIMARY_APPROVED" && (
                  <div className="space-y-3">
                    <p className="flex items-start gap-2 text-sm text-gold-ink">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        Primary review complete — awaiting senior
                        countersignature
                        {dataHistory
                          ? ` (since ${fmtDateTime(dataHistory.createdAt)})`
                          : ""}
                        .
                      </span>
                    </p>
                    {/* Countersign is the second person, never the reviewer:
                        enforced by the SENIOR-only `case.approve.data.secondary`
                        capability on the server. */}
                    {(role === "SENIOR_RM" || role === "ADMIN") && (
                      <Button
                        onClick={() =>
                          setDataDialog({ decision: "COUNTERSIGN" })
                        }
                      >
                        <ShieldCheck className="h-4 w-4" /> Countersign (senior)
                      </Button>
                    )}
                  </div>
                )}
                {row.dataApproval === "APPROVED" && (
                  <p className="flex items-start gap-2 text-sm text-olive-ink">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      Approved
                      {dataHistory
                        ? ` — ${fmtDateTime(dataHistory.createdAt)}`
                        : ""}
                      {dataHistory?.reason ? `: “${dataHistory.reason}”` : ""}
                    </span>
                  </p>
                )}
                {row.dataApproval === "REJECTED" && (
                  <div className="space-y-3">
                    <p className="flex items-start gap-2 text-sm text-danger-ink">
                      <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        Rejected
                        {dataHistory
                          ? ` — ${fmtDateTime(dataHistory.createdAt)}`
                          : ""}
                        {dataHistory?.reason ? `: “${dataHistory.reason}”` : ""}
                      </span>
                    </p>
                    {/* Recovery path: the client cannot self-correct a rejected
                        review — the advisor sends the case back to onboarding,
                        which re-opens the data for the client. */}
                    <Button
                      variant="outline"
                      onClick={() => void requestCorrection()}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden /> Request
                      correction from client
                    </Button>
                  </div>
                )}
                {(row.dataApproval === null ||
                  row.dataApproval === "PENDING") &&
                  !canAct && (
                    <p className="text-sm text-muted-foreground">
                      Awaiting secondary approval by a relationship manager.
                    </p>
                  )}
              </div>
            )}
          </Card>

          {/* 1b · Screening (KYC / AML) — regulated evidence, not a checklist */}
          <Card
            id="cl-sec-screening"
            className={cn(
              "rounded-md border-border p-5 md:p-6",
              sectionCls("cl-sec-screening")
            )}
          >
            <CardHead
              eyebrow="Compliance · Screening"
              title={t("rmq.secScreening")}
              action={
                screening === null || screening === undefined ? (
                  <StatusBadge status="Loading" tone="sky" />
                ) : screening.blocked ? (
                  <StateBadge state="BLOCKED" />
                ) : screening.outstanding.length > 0 ? (
                  <StatusBadge
                    status={`${screening.outstanding.length} outstanding`}
                    tone="amber"
                  />
                ) : (
                  <StateBadge state="CLEAR" />
                )
              }
            />
            {screening === null || screening === undefined ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Loading screening posture…
              </p>
            ) : (
              <>
                {screening.blocked && (
                  <p className="mt-4 flex items-start gap-2 rounded border border-coral/50 bg-coral/10 p-3 text-sm text-danger-ink">
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden
                    />
                    <span>
                      A failed BLOCKER check stops this case — resolve it before
                      any approval or dispatch.
                    </span>
                  </p>
                )}
                <ul className="mt-4 divide-y divide-border">
                  {screening.checks.map((check) => {
                    const current = screening.rows.find(
                      (r) => r.checkKey === check.key
                    );
                    const result = current?.result ?? "UNKNOWN";
                    return (
                      <li
                        key={check.key}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-cobble-ink">
                            {check.label}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {check.purpose}
                          </p>
                          {current?.note && (
                            <p className="mt-1 text-xs italic text-iron-ink">
                              “{current.note}”
                              {current.runByLabel
                                ? ` — ${current.runByLabel}`
                                : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {check.severity === "BLOCKER"
                              ? "Blocker"
                              : "Review"}
                          </span>
                          <StateBadge state={result} />
                          {canAct && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setScreeningForm({
                                  checkKey: check.key,
                                  result: result === "FAIL" ? "FAIL" : "PASS",
                                  note: "",
                                })
                              }
                            >
                              Record
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Results are append-only: recording supersedes the prior row,
                    history is never rewritten. Every recording is audit-logged
                    with your name and role.
                  </p>
                  {/* The query half of screening: ask the matcher, then record.
                      Rendering the button only after the posture loads keeps it
                      next to the ledger it complements. */}
                  <Button variant="outline" size="sm" onClick={() => setMatchOpen(true)}>
                    <Search className="h-4 w-4" aria-hidden />
                    {t("rm.match.title")}
                  </Button>
                </div>
              </>
            )}
          </Card>

          {/* 2 · Secondary approval — programme choice */}
          <Card
            id="cl-sec-service"
            className={cn(
              "rounded-md border-border p-5 md:p-6",
              sectionCls("cl-sec-service")
            )}
          >
            <CardHead
              eyebrow="Secondary approval · 02"
              title={t("rmq.secProgramme")}
              action={
                row.serviceApproval ? (
                  <StateBadge state={row.serviceApproval} />
                ) : (
                  <StatusBadge status="Awaiting review" tone="amber" />
                )
              }
            />
            {row.programme ? (
              <div className="mt-4">
                <p className="font-editorial text-lg text-cobble-ink">
                  {row.programme.name}
                </p>
                <p className="text-xs uppercase tracking-[0.16em] text-gold-ink">
                  {row.programme.country}
                </p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-iron-ink">
                  {row.serviceApproval === "APPROVED"
                    ? "Approved — the standard document set has been issued to the client."
                    : row.serviceApproval === "PRIMARY_APPROVED"
                    ? "Primary selection review recorded — a senior advisor countersigns before the document set is issued."
                    : "Two-person rule: an advisor records the primary review; a senior advisor countersigns, and only the countersignature issues the standard document set (registration certificate, national ID, police record) to the client automatically."}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                The client has not selected a programme yet — approval unlocks
                once they choose.
              </p>
            )}

            {serviceDecidable ? (
              <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-4">
                <Button
                  onClick={() => setServiceDialog({ decision: "APPROVED" })}
                >
                  <ShieldCheck className="h-4 w-4" /> Approve programme (primary
                  review)
                </Button>
                <Button
                  variant="outline"
                  className="text-danger-ink hover:bg-coral/10 hover:text-danger-ink"
                  onClick={() => setServiceDialog({ decision: "REJECTED" })}
                >
                  Reject
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  On countersign: “Standard document set will be issued to the
                  client.”
                </span>
              </div>
            ) : (
              <div className="mt-4 border-t border-border/60 pt-4">
                {row.serviceApproval === "PRIMARY_APPROVED" && (
                  <div className="space-y-3">
                    <p className="flex items-start gap-2 text-sm text-gold-ink">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        Primary selection review recorded — awaiting senior
                        countersignature.
                      </span>
                    </p>
                    {/* Countersign is the second person: SENIOR-only server gate. */}
                    {(role === "SENIOR_RM" || role === "ADMIN") && (
                      <Button
                        onClick={() =>
                          setServiceDialog({ decision: "COUNTERSIGN" })
                        }
                      >
                        <ShieldCheck className="h-4 w-4" /> Countersign (senior)
                      </Button>
                    )}
                  </div>
                )}
                {row.serviceApproval === "APPROVED" && (
                  <p className="flex items-start gap-2 text-sm text-olive-ink">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      Approved
                      {serviceHistory
                        ? ` — ${fmtDateTime(serviceHistory.createdAt)}`
                        : ""}
                      {serviceHistory?.reason
                        ? `: “${serviceHistory.reason}”`
                        : ""}
                    </span>
                  </p>
                )}
                {row.serviceApproval === "REJECTED" && (
                  <p className="flex items-start gap-2 text-sm text-danger-ink">
                    <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      Rejected — discuss the selection with the client before
                      re-approval.
                    </span>
                  </p>
                )}
                {row.programme === null && (
                  <p className="text-sm text-muted-foreground">
                    Waiting for the client’s programme selection.
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* 3 · Documents */}
          <Card
            id="cl-sec-documents"
            className={cn(
              "rounded-md border-border p-5 md:p-6",
              sectionCls("cl-sec-documents")
            )}
          >
            <CardHead
              eyebrow="Dossier · 03"
              title={t("case.documents")}
              action={
                <span className="text-sm tabular-nums text-iron-ink">
                  <span className="font-semibold text-cobble-ink">
                    {row.documentsApproved}
                  </span>
                  <span className="text-muted-foreground">
                    /{row.documentsTotal} approved
                  </span>
                </span>
              }
            />
            <div className="mt-4 space-y-3">
              {docs.length > 0 ? (
                docs.map((d) => (
                  <DocCard
                    key={d.id}
                    doc={d}
                    canAct={canAct}
                    onReview={setDocDialog}
                    onComment={setCommentDialog}
                    busyDocId={busyDocId}
                  />
                ))
              ) : row.documentsTotal > 0 ? (
                <div className="rounded-md border border-amber-brand/40 bg-amber-brand/5 p-4">
                  <div className="flex items-start gap-3">
                    <Info
                      aria-hidden
                      className="mt-0.5 h-4 w-4 shrink-0 text-amber-ink"
                    />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-amber-ink">
                        {row.documentsTotal} document
                        {row.documentsTotal === 1 ? "" : "s"} on file —{" "}
                        {row.documentsApproved} approved
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        This case shows approved and total counts. Per-document
                        review — OCR fields, confidence, approve or request
                        changes — is done from the document list.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No documents on file yet — requests appear in the client
                  portal once issued.
                </p>
              )}
            </div>
          </Card>

          {/* 4 · Document requests */}
          <Card
            id="cl-sec-requests"
            className="rounded-md border-border p-5 md:p-6 scroll-mt-20"
          >
            <CardHead
              eyebrow="Client ask · 04"
              title={t("rmq.secRequests")}
              action={
                canAct && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReqOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Request additional document
                  </Button>
                )
              }
            />
            <div className="mt-4 space-y-2.5">
              {extraRequests.length === 0 &&
              (detailCase?.requests.length ?? 0) === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                  No open document requests — the client’s dossier is complete
                  or not yet issued.
                </p>
              ) : (
                <>
                  {extraRequests.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-md border border-border bg-muted/20 p-3.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-cobble-ink">{r.title}</p>
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-iron-ink">
                            {settings.labels.docTypes[r.docType] ??
                              DOC_TYPE_LABELS[r.docType] ??
                              r.docType}
                          </span>
                          <StateBadge state={r.status} />
                        </div>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-iron-ink">
                        {r.instructions}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Due {fmtDate(r.dueDate)} · requested just now
                      </p>
                    </div>
                  ))}
                  {/* The programme-issued request set ships with the case detail but
                      was only ever rendered as a count, so the RM could not see which
                      documents are outstanding or when they fall due. Render them, in
                      the same card the freshly-created ones use. Requests created in
                      this session are already listed above, so filter those out. */}
                  {(detailCase?.requests ?? [])
                    .filter((r) => !extraRequests.some((e) => e.id === r.id))
                    .map((r) => (
                      <div
                        key={r.id}
                        className="rounded-md border border-border bg-muted/20 p-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-cobble-ink">
                            {r.title}
                            {r.flexible && (
                              <span className="ml-2 rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-gold-ink">
                                flexible
                              </span>
                            )}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-iron-ink">
                              {settings.labels.docTypes[r.docType] ??
                                DOC_TYPE_LABELS[r.docType] ??
                                r.docType}
                            </span>
                            <StateBadge state={r.status} />
                          </div>
                        </div>
                        {r.instructions && (
                          <p className="mt-1 text-xs leading-relaxed text-iron-ink">
                            {r.instructions}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {r.documents.length > 0
                            ? `${r.documents.length} file${
                                r.documents.length === 1 ? "" : "s"
                              } received · `
                            : ""}
                          {r.dueDate
                            ? `Due ${fmtDate(r.dueDate)}`
                            : "No due date"}
                        </p>
                        {canAct && r.status === "OPEN" && (
                          <div className="mt-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground hover:text-red-ink"
                              onClick={() => {
                                setNotNeededId(r.id);
                                setNotNeededReason("");
                              }}
                            >
                              <X className="h-3 w-3" /> {t("rmq.markNotNeeded")}
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                </>
              )}
            </div>
          </Card>

          {/* 5 · Secure timeline & comments */}
          <Card className="rounded-md border-border p-5 md:p-6">
            <CardHead
              eyebrow="Record · 05"
              title={t("rmq.secTimeline")}
              action={
                <div className="flex items-center gap-2">
                  <CallLauncher caseId={activeCaseId} mySide="STAFF" />
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em]",
                      chatConnected
                        ? "border-olive/40 bg-olive/10 text-olive-ink"
                        : "border-border bg-muted text-muted-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        chatConnected ? "bg-olive" : "bg-muted-foreground/60"
                      )}
                      aria-hidden
                    />
                    {chatConnected
                      ? t("chat.liveBadge")
                      : t("chat.reconnecting")}
                  </span>
                </div>
              }
            />
            {chatOnline.length > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-olive-ink">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-olive"
                  aria-hidden
                />
                {chatOnline.map((u) => u.name).join(", ")} {t("chat.online")}
              </p>
            )}
            <div className="mt-4 max-h-[480px] space-y-4 overflow-y-auto pr-1">
              {feed.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No history yet — approvals, status changes and messages will
                  appear here.
                </p>
              )}
              {feed.map((item) =>
                item.kind === "status" ? (
                  <div key={item.id} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/20 text-gold-ink">
                      <History aria-hidden className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1 rounded-md border border-border/70 bg-muted/20 px-3.5 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-cobble-ink">
                          {settings.labels.caseStatuses[item.to] ??
                            caseStatusLabel(item.to)}
                        </p>
                        {item.command && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {item.command}
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDateTime(new Date(item.at).toISOString())}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.from
                          ? `${
                              settings.labels.caseStatuses[item.from] ??
                              caseStatusLabel(item.from)
                            } → `
                          : "Case created → "}
                        {(
                          settings.labels.caseStatuses[item.to] ??
                          caseStatusLabel(item.to)
                        ).toLowerCase()}
                      </p>
                      {item.reason && (
                        <p className="mt-1 text-xs italic leading-relaxed text-iron-ink">
                          “{item.reason}”
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={item.id} className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                        item.internal
                          ? "bg-amber-brand/15 text-amber-ink"
                          : "bg-cobble/10 text-cobble-ink"
                      )}
                    >
                      <MessageSquare aria-hidden className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1 rounded-md border border-border/70 px-3.5 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-cobble-ink">
                          {item.author}
                        </p>
                        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {item.role.replace("_", " ")}
                        </span>
                        {item.internal && (
                          <StatusBadge status="Internal note" tone="amber" />
                        )}
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {fmtDateTime(new Date(item.at).toISOString())}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-iron-ink">
                        {item.body}
                      </p>
                    </div>
                  </div>
                )
              )}
            </div>

            {canAct && (
              <div
                id="cl-sec-composer"
                className={cn(
                  "mt-5 border-t border-border/60 pt-4",
                  sectionCls("cl-sec-composer")
                )}
              >
                <Label htmlFor="client-message">Message to client</Label>
                <Textarea
                  id="client-message"
                  value={message}
                  onChange={(e) => onComposerChange(e.target.value)}
                  rows={3}
                  className="mt-1.5"
                  placeholder={t("rmq.clientMsgPh")}
                  aria-label={t("rmq.clientMsgLabel")}
                />
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="max-w-md">
                    {chatTyping ? (
                      <p
                        className="text-[11px] italic text-olive-ink"
                        aria-live="polite"
                      >
                        {t("chat.typing", { name: chatTyping })}
                      </p>
                    ) : (
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Messages posted here are client-visible. Internal notes
                        appear read-only above — they are recorded by RM tooling
                        and never leave the house.
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={() => void sendMessage()}
                    disabled={!message.trim() || sending}
                  >
                    {sending ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send message
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ══ SIDE COLUMN ═══════════════════════════════════════════════════ */}
        <div className="space-y-6">
          {/* 6 · Dispatch */}
          <Card className="rounded-md border-border p-5 md:p-6">
            <CardHead
              eyebrow="Authority · 06"
              title={t("queue.columns.dispatch")}
              action={
                row.dispatch ? (
                  <StateBadge state={row.dispatch.status} />
                ) : (
                  <StatusBadge status="Not dispatched" tone="neutral" />
                )
              }
            />
            {row.dispatch ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-start gap-2.5 rounded-md border border-border/70 bg-muted/20 p-3.5">
                  <Truck
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 text-teal-ink"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      DHL tracking
                    </p>
                    <p className="font-mono text-sm font-medium text-cobble-ink">
                      {row.dispatch.trackingId}
                    </p>
                    {localDest && (
                      <p className="mt-1 text-xs text-iron-ink">{localDest}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SandboxChip label="Sandbox" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2">
                          DHL (sandbox adapter)
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-56 text-xs">
                          Deterministic sandbox carrier — tracking ids are
                          generated locally; no live booking was made with DHL.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                {(localFollowUp ||
                  row.status === "FOLLOW_UP" ||
                  row.status === "DISPATCHED") && (
                  <p className="text-xs text-muted-foreground">
                    {localFollowUp
                      ? `Follow-up due ${fmtDate(localFollowUp.dueDate)} (${
                          localFollowUp.weeks
                        } weeks).`
                      : "A 6-week follow-up was created automatically with the dispatch."}
                  </p>
                )}
                {canAct && flowOpen && (
                  <div className="flex items-center gap-2 border-t border-border/60 pt-3.5">
                    <Select
                      value={followUpWeeks}
                      onValueChange={setFollowUpWeeks}
                    >
                      <SelectTrigger
                        aria-label={t("rmq.followupIntervalLabel")}
                        className="w-36"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {settings.operations.followUpWeeks.map((weeks) => (
                          <SelectItem key={weeks} value={String(weeks)}>
                            {weeks} weeks
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void scheduleFollowUp()}
                      disabled={busy}
                    >
                      {t("action.followUp")}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-3.5">
                <p className="text-sm leading-relaxed text-iron-ink">
                  Once the dossier is complete, dispatch it to the residence
                  authority. Tracking and a follow-up reminder are created
                  automatically.
                </p>
                {canAct && (
                  <Button
                    onClick={() => {
                      setDestination(
                        (d) => d || settings.operations.defaultDestination
                      );
                      setDispatchOpen(true);
                    }}
                    disabled={!canDispatch}
                  >
                    <Truck className="h-4 w-4" /> Dispatch documents to
                    authority
                  </Button>
                )}
                {!canDispatch && (
                  <p className="text-xs text-muted-foreground">
                    Dispatch unlocks once all requested documents are in and the
                    case reaches the in-progress stage.
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* 7 · Approval letter */}
          <Card className="rounded-md border-border p-5 md:p-6">
            <CardHead
              eyebrow="Decision · 07"
              title={t("rmq.secApprovalLetter")}
              action={
                letter || row.hasLetter ? (
                  <StateBadge state="APPROVED" />
                ) : (
                  <StatusBadge status="Not uploaded" tone="neutral" />
                )
              }
            />
            {letter || row.hasLetter ? (
              <div className="mt-4 space-y-3">
                {letter ? (
                  <>
                    <div className="flex items-start gap-2.5 rounded-md border border-border/70 bg-muted/20 p-3.5">
                      <FileText
                        aria-hidden
                        className="mt-0.5 h-4 w-4 shrink-0 text-olive-ink"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-cobble-ink">
                          {letter.fileName}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          v{letter.version} · uploaded{" "}
                          {fmtDateTime(letter.createdAt)}
                        </p>
                      </div>
                    </div>
                    {letterDownload ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={downloadLetterFile}
                      >
                        <Download className="h-3.5 w-3.5" /> Download PDF
                      </Button>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Sandbox: letter bytes unavailable (seeded metadata
                        only).
                      </p>
                    )}
                  </>
                ) : (
                  <p className="flex items-start gap-2 text-sm text-iron-ink">
                    <FileText
                      aria-hidden
                      className="mt-0.5 h-4 w-4 shrink-0 text-olive-ink"
                    />
                    <span>
                      A letter is on file, but its file could not be opened.
                      Request the letter again, or ask the client to re-upload
                      it.
                    </span>
                  </p>
                )}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The client is notified automatically and can download the
                  letter from their portal; the case moves to{" "}
                  <span className="font-medium text-cobble-ink">
                    Approved in principle
                  </span>
                  .
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3.5">
                <p className="text-sm leading-relaxed text-iron-ink">
                  Upload the authority’s approval-in-principle letter as a PDF.
                  Uploading notifies the client automatically and moves the case
                  to approved-in-principle.
                </p>
                {canAct ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      aria-label={t("rmq.approvalPdfLabel")}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleLetterFile(f);
                      }}
                    />
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingLetter}
                    >
                      {uploadingLetter ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Upload approval letter (.pdf)
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Awaiting the RM’s approval letter.
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* 8 · Case closure — terminal transitions */}
          {canAct &&
            row.status !== "COMPLETED" &&
            row.status !== "CANCELLED" && (
              <Card className="rounded-md border-border p-5 md:p-6">
                <CardHead
                  eyebrow="Decision · 08"
                  title={t("rmq.secClosure")}
                  action={
                    <StatusBadge
                      status={
                        settings.labels.caseStatuses[row.status] ??
                        caseStatusLabel(row.status)
                      }
                      tone="neutral"
                    />
                  }
                />
                <p className="mt-4 text-sm leading-relaxed text-iron-ink">
                  Complete the case once the objective is achieved, or cancel it
                  if the client withdraws. The client is notified and the
                  transition is written to the audit trail.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => setClosureDialog("complete")}
                    disabled={busy}
                  >
                    <Check className="h-4 w-4" /> Mark completed
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setClosureDialog("cancel")}
                    disabled={busy}
                  >
                    <X className="h-4 w-4" /> {t("action.cancel")}
                  </Button>
                </div>
              </Card>
            )}

          {/* 9 · Official letters (letterbox) — generated on letterhead */}
          {detailCase && (
            <OfficialLettersPanel caseId={detailCase.id} canAct={canAct} />
          )}

          {/* 10 · Personal workload view — capacity vs SLA forecast */}
          {detailCase && <PersonalWorkloadView row={row} triage={triage} />}

          {/* 11 · Shift/leave handoff freeze card */}
          <ShiftFreezeCard busy={busy} />

          {/* Discreet audit footnote */}
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            Every decision on this surface requires a reason and is written to
            the immutable audit trail with actor, timestamp and correlation id —
            Citizen Lane GmbH, Zurich.
          </p>
        </div>
      </div>

      {/* ── Dialogs (keyed remount = fresh state per open) ────────────────── */}
      {dataDialog !== null && (
        <ReasonDialog
          key={`data-${dataDialog.decision}`}
          open
          onOpenChange={(o) => !o && setDataDialog(null)}
          title={
            dataDialog.decision === "APPROVED"
              ? "Approve client data (primary review)"
              : dataDialog.decision === "COUNTERSIGN"
              ? "Countersign client data (senior)"
              : "Reject client data"
          }
          description="Two-person rule: an advisor's primary review is completed by a senior advisor's countersignature. The reason is mandatory, recorded in the audit trail and communicated to the client."
          decision={
            dataDialog.decision === "COUNTERSIGN"
              ? "APPROVED"
              : dataDialog.decision
          }
          confirmLabel={
            dataDialog.decision === "APPROVED"
              ? "Record primary review"
              : dataDialog.decision === "COUNTERSIGN"
              ? "Countersign"
              : "Reject data"
          }
          busy={busy}
          onConfirm={(reason) => void decideData(reason)}
        />
      )}

      {serviceDialog !== null && (
        <ReasonDialog
          key={`service-${serviceDialog.decision}`}
          open
          onOpenChange={(o) => !o && setServiceDialog(null)}
          title={
            serviceDialog.decision === "APPROVED"
              ? "Approve programme choice (primary review)"
              : serviceDialog.decision === "COUNTERSIGN"
              ? "Countersign programme choice (senior)"
              : "Reject programme choice"
          }
          description={
            serviceDialog.decision === "APPROVED"
              ? "Records the primary selection review. A senior advisor must countersign before the document set is issued. The reason is mandatory and audit-recorded."
              : serviceDialog.decision === "COUNTERSIGN"
              ? "Senior countersignature: issues the standard document set to the client and advances the case. The reason is mandatory and audit-recorded."
              : "Rejecting returns the programme choice to the client for discussion. The reason is mandatory and audit-recorded."
          }
          decision={
            serviceDialog.decision === "COUNTERSIGN"
              ? "APPROVED"
              : serviceDialog.decision
          }
          confirmLabel={
            serviceDialog.decision === "APPROVED"
              ? "Record primary review"
              : serviceDialog.decision === "COUNTERSIGN"
              ? "Countersign"
              : "Reject programme"
          }
          busy={busy}
          onConfirm={(reason) => void decideService(reason)}
        />
      )}

      {screeningForm !== null && (
        <ScreeningDialog
          key={`screening-${screeningForm.checkKey}-${screeningForm.result}`}
          open
          onOpenChange={(o) => !o && setScreeningForm(null)}
          checkKey={screeningForm.checkKey}
          checkLabel={
            screening?.checks.find((c) => c.key === screeningForm.checkKey)
              ?.label ?? screeningForm.checkKey
          }
          initialResult={screeningForm.result}
          busy={busy}
          onConfirm={(result, note) => {
            setScreeningForm({ ...screeningForm, result, note });
            void submitScreening(note);
          }}
        />
      )}

      {matchOpen && (
        <MatchDialog
          open
          onOpenChange={(o) => !o && setMatchOpen(false)}
          defaultName={row?.client.name ?? ""}
          defaultCountry={row?.client.nationality ?? ""}
        />
      )}

      {closureDialog !== null && (
        <ReasonDialog
          key={`closure-${closureDialog}`}
          open
          onOpenChange={(o) => !o && setClosureDialog(null)}
          title={
            closureDialog === "complete"
              ? t("action.complete")
              : t("action.cancel")
          }
          description={
            closureDialog === "complete"
              ? "Marks the case as completed and notifies the client. The reason is mandatory and audit-recorded."
              : "Cancels the case and notifies the client. The reason is mandatory and audit-recorded."
          }
          decision={closureDialog === "complete" ? "APPROVED" : "REJECTED"}
          confirmLabel={
            closureDialog === "complete"
              ? t("action.complete")
              : t("action.cancel")
          }
          busy={busy}
          onConfirm={(reason) => void closeCase(closureDialog, reason)}
        />
      )}

      {editClientDialog !== null && (
        <Dialog open onOpenChange={(o) => !o && setEditClientDialog(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit client details</DialogTitle>
              <DialogDescription>
                Update the client's profile information. Email cannot be changed
                — it is the login identifier.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="edit-name">Full name</Label>
                <Input
                  id="edit-name"
                  value={editClientDialog.name}
                  onChange={(e) =>
                    setEditClientDialog({
                      ...editClientDialog,
                      name: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  value={editClientDialog.phone}
                  onChange={(e) =>
                    setEditClientDialog({
                      ...editClientDialog,
                      phone: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="edit-dob">Date of birth</Label>
                <Input
                  id="edit-dob"
                  type="date"
                  value={editClientDialog.dateOfBirth}
                  onChange={(e) =>
                    setEditClientDialog({
                      ...editClientDialog,
                      dateOfBirth: e.target.value,
                    })
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="edit-address">Address</Label>
                <Input
                  id="edit-address"
                  value={editClientDialog.address}
                  onChange={(e) =>
                    setEditClientDialog({
                      ...editClientDialog,
                      address: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="edit-city">City</Label>
                <Input
                  id="edit-city"
                  value={editClientDialog.city}
                  onChange={(e) =>
                    setEditClientDialog({
                      ...editClientDialog,
                      city: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="edit-country">Country</Label>
                <Input
                  id="edit-country"
                  value={editClientDialog.country}
                  onChange={(e) =>
                    setEditClientDialog({
                      ...editClientDialog,
                      country: e.target.value,
                    })
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="edit-nationality">Nationality</Label>
                <Input
                  id="edit-nationality"
                  value={editClientDialog.nationality}
                  onChange={(e) =>
                    setEditClientDialog({
                      ...editClientDialog,
                      nationality: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button
                variant="outline"
                onClick={() => setEditClientDialog(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.editClient(activeCaseId, {
                      name: editClientDialog.name,
                      phone: editClientDialog.phone,
                      address: editClientDialog.address,
                      city: editClientDialog.city,
                      country: editClientDialog.country,
                      nationality: editClientDialog.nationality,
                      dateOfBirth: editClientDialog.dateOfBirth,
                    });
                    toast({
                      title: "Client details updated",
                      variant: "default",
                    });
                    setEditClientDialog(null);
                    await load(true);
                  } catch (e) {
                    toast({
                      title:
                        e instanceof Error
                          ? e.message
                          : "Failed to update client details",
                      variant: "destructive",
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {docDialog !== null && (
        <DocReviewDialog
          key={`doc-${docDialog.docId}-${docDialog.decision}`}
          target={docDialog}
          onOpenChange={(o) => {
            if (!o) {
              setDocDialog(null);
              setBusyDocId(null);
            }
          }}
          busy={busy}
          onConfirm={(decision, reason) => {
            setBusyDocId(docDialog.docId);
            void reviewDoc(decision, reason);
          }}
        />
      )}

      {commentDialog !== null && (
        <DocCommentDialog
          key={`docc-${commentDialog.docId}`}
          target={commentDialog}
          onOpenChange={(o) => {
            if (!o) setCommentDialog(null);
          }}
          busy={busy}
          onConfirm={(body, internal) => {
            void addDocComment(body, internal);
          }}
        />
      )}

      {/* Dispatch dialog */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dispatch documents to authority</DialogTitle>
            <DialogDescription>
              The dossier is shipped via the DHL sandbox adapter — a tracking id
              is generated and a 6-week follow-up is created automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dispatch-destination">Destination</Label>
              <Input
                id="dispatch-destination"
                list="dispatch-destination-options"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="MA 35 — Austrian Residence Authority, Vienna, AT"
                aria-required
              />
              <datalist id="dispatch-destination-options">
                {settings.operations.dispatchDestinations.map((dest) => (
                  <option key={dest} value={dest} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>Attach approved documents</Label>
              {approvedDocs.length > 0 ? (
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                  {approvedDocs.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2.5 text-sm text-iron-ink"
                    >
                      <Checkbox
                        checked={selectedDocs.includes(d.id)}
                        onCheckedChange={(v) =>
                          setSelectedDocs((prev) =>
                            v ? [...prev, d.id] : prev.filter((x) => x !== d.id)
                          )
                        }
                        aria-label={`Include ${d.title}`}
                      />
                      {d.title}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                  This case dispatches as a sealed set, so individual documents
                  cannot be selected. Leave the selection empty to send
                  everything.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDispatchOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void dispatchDossier()}
              disabled={!destination.trim() || busy}
            >
              {busy ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Truck className="h-4 w-4" />
              )}
              Dispatch dossier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request additional document dialog */}
      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request additional document</DialogTitle>
            <DialogDescription>
              The client is notified immediately and fulfils the request from
              their portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="req-type">Document type</Label>
              <Select value={reqType} onValueChange={setReqType}>
                <SelectTrigger id="req-type" aria-label={t("rmq.docTypeLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries({
                    ...DOC_TYPE_LABELS,
                    ...settings.labels.docTypes,
                  }).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Title</Label>
              <Input
                id="req-title"
                value={reqTitle}
                onChange={(e) => setReqTitle(e.target.value)}
                placeholder="e.g. Proof of funds — bank statement"
                aria-required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-instructions">
                Instructions for the client
              </Label>
              <Textarea
                id="req-instructions"
                value={reqInstructions}
                onChange={(e) => setReqInstructions(e.target.value)}
                rows={3}
                placeholder={t("rmq.requestDetailsPh")}
                aria-required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-due">Due in (days)</Label>
              <Input
                id="req-due"
                type="number"
                min={1}
                max={180}
                value={reqDue}
                onChange={(e) => setReqDue(e.target.value)}
                className="w-32"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReqOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void createRequest()}
              disabled={!reqTitle.trim() || !reqInstructions.trim() || busy}
            >
              {busy ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark not needed dialog */}
      <Dialog
        open={notNeededId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setNotNeededId(null);
            setNotNeededReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rmq.notNeededTitle")}</DialogTitle>
            <DialogDescription>{t("rmq.notNeededDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="not-needed-reason">
                {t("rmq.notNeededReasonLabel")}
              </Label>
              <Textarea
                id="not-needed-reason"
                value={notNeededReason}
                onChange={(e) => setNotNeededReason(e.target.value)}
                rows={3}
                placeholder={t("rmq.notNeededReasonPh")}
                aria-required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNotNeededId(null);
                setNotNeededReason("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void markNotNeeded()}
              disabled={!notNeededReason.trim() || busy}
            >
              {busy ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <X className="h-4 w-4" />
              )}
              {t("rmq.markNotNeeded")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
