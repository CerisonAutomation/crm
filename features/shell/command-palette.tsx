"use client";
/**
 * Command palette — ⌘K / Ctrl+K anywhere in the authenticated shell.
 *
 * Groups (hidden when empty): "Recent" (query empty only) mirrors the last
 * destinations from localStorage, "Go to" mirrors the role-scoped sidebar nav
 * from the shared @/lib/nav config, "Cases" reuses the exact RM-queue endpoint
 * (selecting a case mirrors rm-console's setActiveCase store call), "Actions"
 * is role-based, "Help" opens the help dialog. All strings go through useI18n().
 *
 * Filtering is done locally (case-insensitive substring, every whitespace
 * token must match) so cmdk's own filter is disabled — groups render only
 * when they have results, which keeps the group headers honest.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
import { useI18n, type StringKey } from "@/lib/i18n";
import {
  NAV, SECTION_LABEL_KEYS, canOpen, readRecents, rememberRecent,
  type AdminSub, type RecentEntry,
} from "@/lib/nav";
import {
  Command as Cmdk, CommandInput, CommandList, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Command, CircleHelp, LayoutDashboard, ShieldCheck, Users, Workflow, Globe, Puzzle,
  ScrollText, LayoutTemplate, Settings,
  UserRound, FileUp, MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHelp: () => void;
  /** Mirrors the shell's own navigate() for the two admin-automation panels. */
  onOpenAdminAutomation: (sub: AdminSub) => void;
};

type QueueCase = Awaited<ReturnType<typeof api.rmCases>>["cases"][number];

type Row = {
  id: string;
  label: string;
  keywords?: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
};

/** Every whitespace token must appear in "label keywords" (case-insensitive). */
function matchesQuery(query: string, text: string, keywords?: string): boolean {
  const hay = `${text} ${keywords ?? ""}`.toLowerCase();
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

const STAFF_CASE_ROLES = ["RM", "SENIOR_RM", "ADMIN", "AUDITOR"];

export function CommandPalette({ open, onOpenChange, onOpenHelp, onOpenAdminAutomation }: CommandPaletteProps) {
  const { t } = useI18n();
  const session = useApp((s) => s.session);
  const setView = useApp((s) => s.setView);
  const setActiveCase = useApp((s) => s.setActiveCase);

  const [query, setQuery] = useState("");
  const [cases, setCases] = useState<QueueCase[]>([]);
  const [caseListPendingRaw, setCaseListPending] = useState(true);
  const [ownCase, setOwnCase] = useState<{ id: string; reference: string; status: string; programmeName: string | null } | null>(null);
  // Recent destinations (cl.recent) — re-read on every open so store-driven
  // view changes land here too.
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  const role = session?.role ?? "CLIENT";

  // All close paths (Esc, backdrop, ⌘K, item select) funnel through here so the
  // query is cleared outside of render/effect (event-handler setState is safe).
  const handleOpenChange = useCallback((o: boolean) => {
    if (!o) setQuery("");
    onOpenChange(o);
  }, [onOpenChange]);

  // Global ⌘K / Ctrl+K — one listener while mounted (one instance in AppShell).
  // Skipped while typing in inputs/textarea/contenteditable per spec.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || el?.isContentEditable) return;
      e.preventDefault();
      handleOpenChange(!open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleOpenChange]);

  // Recent destinations refresh on every open (localStorage is the source of
  // truth; the store records view changes from any source). `readRecents()` is
  // SSR-safe, so it can be re-read during the render that opens the palette
  // instead of one commit later in an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRecents(readRecents());
  }

  // Fresh data on every open — the same endpoints the RM queue / client portal use.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    if (STAFF_CASE_ROLES.includes(role)) {
      // caseListPending starts true (first open); later opens refresh in place.
      api.rmCases()
        .then((res) => { if (alive) setCases(res.cases); })
        .catch(() => { if (alive) setCases([]); })
        .finally(() => { if (alive) setCaseListPending(false); });
    } else if (role === "CLIENT") {
      // CLIENT has no staff queue — the pending gate doesn't apply.
      api.myCase()
        .then(({ case: c }) => {
          if (!alive) return;
          setOwnCase(c ? { id: c.id, reference: c.reference, status: c.status, programmeName: c.programme?.name ?? null } : null);
        })
        .catch(() => { if (alive) setOwnCase(null); });
    }
    return () => { alive = false; };
  }, [open, role]);

  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  // ── rows ──────────────────────────────────────────────────────────────────
  /** A palette nav row — label/icon/roles straight from the shared NAV. */
  const navRow = useCallback(
    (n: (typeof NAV)[number]): Row => ({
      id: `nav:${n.view}:${n.labelKey}:${n.sub ?? ""}`,
      label: t(n.labelKey),
      // Section label makes queries like "admin users" or "staff queue" match.
      keywords: `${n.view} ${t(SECTION_LABEL_KEYS[n.section])}${n.sub ? ` ${n.sub} automation integration` : ""}`,
      icon: <n.icon className="h-4 w-4" aria-hidden="true" />,
      run: () => {
        rememberRecent(n.sub ? { view: n.view, sub: n.sub } : { view: n.view });
        if (n.sub) onOpenAdminAutomation(n.sub);
        else setView(n.view);
      },
    }),
    [t, setView, onOpenAdminAutomation],
  );

  const navRows = useMemo<Row[]>(
    () => NAV.filter((n) => n.roles.includes(role)).map(navRow),
    [role, navRow],
  );

  /**
   * Recent destinations — shown only while the query is empty, filtered
   * through the role gate (`roles` per row + `canOpen`) so a stored entry the
   * current role may not open never appears.
   */
  const recentRows = useMemo<Row[]>(() => {
    if (query.trim() !== "") return [];
    const rows: Row[] = [];
    for (const entry of recents) {
      const item = NAV.find(
        (n) =>
          n.view === entry.view &&
          n.roles.includes(role) &&
          (n.view !== "admin-automation" || (n.sub ?? "automation") === (entry.sub ?? "automation")),
      );
      if (!item || !canOpen(item.view, role)) continue;
      rows.push({ ...navRow(item), id: `recent:${item.view}:${item.labelKey}:${item.sub ?? ""}` });
    }
    return rows;
  }, [recents, query, role, navRow]);

  const caseRows = useMemo<Row[]>(() => {
    if (STAFF_CASE_ROLES.includes(role)) {
      return cases
        .filter((c) => matchesQuery(query, `${c.reference} ${c.client?.name ?? ""} ${c.client?.email ?? ""} ${c.programme?.name ?? ""}`))
        .slice(0, 6)
        .map((c) => ({
          id: `case:${c.id}`,
          label: c.reference,
          keywords: `${c.client?.name ?? ""} ${c.client?.email ?? ""} ${c.status} ${c.programme?.name ?? ""}`,
          hint: c.client?.name ?? c.status,
          icon: <ScrollText className="h-4 w-4" aria-hidden="true" />,
          // Mirrors rm-console exactly: setActiveCase sets the active case and lands on the case view.
          run: () => setActiveCase(c.id),
        }));
    }
    if (role === "CLIENT" && ownCase) {
      if (!matchesQuery(query, `${ownCase.reference} ${ownCase.programmeName ?? ""} ${ownCase.status}`)) return [];
      return [{
        id: `case:${ownCase.id}`,
        label: ownCase.reference,
        keywords: `${ownCase.programmeName ?? ""} ${ownCase.status}`,
        hint: ownCase.programmeName ?? ownCase.status,
        icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
        // The client's own case surface is their case dashboard (the RM working surface is staff-only).
        run: () => setView("client-dashboard"),
      }];
    }
    return [];
  }, [role, cases, ownCase, query, setActiveCase, setView]);

  const actionRows = useMemo<Row[]>(() => {
    const rows: Array<Omit<Row, "run"> & { run: () => void }> = [];
    if (role === "CLIENT") {
      rows.push(
        { id: "action:profile", label: t("palette.a.profile"), icon: <UserRound className="h-4 w-4" aria-hidden="true" />, run: () => setView("client-onboarding") },
        { id: "action:upload", label: t("palette.a.upload"), icon: <FileUp className="h-4 w-4" aria-hidden="true" />, run: () => setView("client-dashboard") },
        { id: "action:message", label: t("palette.a.message"), icon: <MessageCircle className="h-4 w-4" aria-hidden="true" />, run: () => setView("client-dashboard") },
        { id: "action:settings", label: t("palette.a.settings"), icon: <Settings className="h-4 w-4" aria-hidden="true" />, run: () => setView("settings") },
      );
    } else if (role === "RM" || role === "SENIOR_RM") {
      rows.push(
        { id: "action:queue", label: t("palette.a.queue"), icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />, run: () => setView("rm-queue") },
        { id: "action:runs", label: t("palette.a.runs"), icon: <LayoutTemplate className="h-4 w-4" aria-hidden="true" />, run: () => setView("studio-runs") },
        { id: "action:settings", label: t("palette.a.settings"), icon: <Settings className="h-4 w-4" aria-hidden="true" />, run: () => setView("settings") },
      );
    } else if (role === "ADMIN") {
      rows.push(
        { id: "action:studio", label: t("palette.a.studio"), icon: <Workflow className="h-4 w-4" aria-hidden="true" />, run: () => setView("studio-workflows") },
        { id: "action:pages", label: t("palette.a.pages"), icon: <Globe className="h-4 w-4" aria-hidden="true" />, run: () => setView("pages-list") },
        { id: "action:runs", label: t("palette.a.runs"), icon: <LayoutTemplate className="h-4 w-4" aria-hidden="true" />, run: () => setView("studio-runs") },
        { id: "action:users", label: t("palette.a.users"), icon: <Users className="h-4 w-4" aria-hidden="true" />, run: () => setView("admin-users") },
        { id: "action:audit", label: t("palette.a.audit"), icon: <ScrollText className="h-4 w-4" aria-hidden="true" />, run: () => setView("admin-audit") },
        { id: "action:automation", label: t("palette.a.automation"), icon: <Puzzle className="h-4 w-4" aria-hidden="true" />, run: () => onOpenAdminAutomation("integrations") },
        { id: "action:queue", label: t("palette.a.queue"), icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />, run: () => setView("rm-queue") },
      );
    } else if (role === "AUDITOR") {
      rows.push(
        { id: "action:queue", label: t("palette.a.queue"), icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />, run: () => setView("rm-queue") },
        { id: "action:audit", label: t("palette.a.audit"), icon: <ScrollText className="h-4 w-4" aria-hidden="true" />, run: () => setView("admin-audit") },
        { id: "action:settings", label: t("palette.a.settings"), icon: <Settings className="h-4 w-4" aria-hidden="true" />, run: () => setView("settings") },
      );
    }
    return rows;
  }, [role, t, setView, onOpenAdminAutomation]);

  const helpRows = useMemo<Row[]>(() => ([{
    id: "help:open",
    label: t("palette.openHelp"),
    icon: <CircleHelp className="h-4 w-4" aria-hidden="true" />,
    run: () => { close(); onOpenHelp(); },
  }]), [t, close, onOpenHelp]);

  const filteredNav = navRows.filter((r) => matchesQuery(query, r.label, r.keywords));
  const filteredActions = actionRows.filter((r) => matchesQuery(query, r.label, r.keywords));
  const filteredHelp = helpRows.filter((r) => matchesQuery(query, r.label, r.keywords));
  // "Pending" only gates the staff case list (CLIENT's own-case fetch resolves instantly).
  const caseListPending = STAFF_CASE_ROLES.includes(role) && caseListPendingRaw;
  const nothing = recentRows.length === 0 && filteredNav.length === 0 && caseRows.length === 0 && filteredActions.length === 0 && filteredHelp.length === 0 && !caseListPending;
  const staffQueueEmpty = STAFF_CASE_ROLES.includes(role) && !caseListPending && cases.length === 0;

  const renderRow = (r: Row) => (
    <CommandItem
      key={r.id}
      value={r.id}
      onSelect={() => { r.run(); close(); }}
      className={cn(
        "min-h-11 cursor-pointer gap-3 rounded-md px-3 py-2.5 text-sm",
        "data-[selected=true]:bg-gold/10 data-[selected=true]:text-cobble-ink"
      )}
    >
      <span className="text-gold-ink">{r.icon}</span>
      <span className="flex-1 truncate">{r.label}</span>
      {r.hint && <span className="max-w-[40%] truncate text-xs text-muted-foreground">{r.hint}</span>}
    </CommandItem>
  );

  const renderGroup = (labelKey: StringKey, rows: Row[]) =>
    rows.length > 0 ? <CommandGroup heading={t(labelKey)}>{rows.map(renderRow)}</CommandGroup> : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>{t("palette.title")}</DialogTitle>
        <DialogDescription>{t("palette.placeholder")}</DialogDescription>
      </DialogHeader>
      <DialogContent
        aria-label={t("palette.title")}
        showCloseButton={false}
        className="top-[8%] translate-y-0 gap-0 overflow-hidden rounded-lg border-border/80 p-0 shadow-xl sm:max-w-xl"
      >
      <Cmdk
        loop
        shouldFilter={false}
        className="bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-lg"
        aria-label={t("palette.title")}
      >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        autoFocus
        placeholder={t("palette.placeholder")}
        aria-label={t("palette.title")}
      />
      <CommandList className="max-h-[min(420px,55vh)]">
        {recentRows.length > 0 && (
          <CommandGroup heading={t("palette.groupRecent")}>
            {recentRows.map(renderRow)}
          </CommandGroup>
        )}
        {renderGroup("palette.groupNav", filteredNav)}
        {(caseRows.length > 0 || staffQueueEmpty) && (
          <CommandGroup heading={t("palette.groupCases")}>
            {caseRows.map(renderRow)}
            {staffQueueEmpty && (
              <p className="min-h-11 px-3 py-2.5 text-sm text-muted-foreground">{t("palette.noCases")}</p>
            )}
          </CommandGroup>
        )}
        {renderGroup("palette.groupActions", filteredActions)}
        {renderGroup("palette.groupHelp", filteredHelp)}
        {nothing && <p className="min-h-16 px-4 py-6 text-center text-sm text-muted-foreground">{t("palette.empty")}</p>}
      </CommandList>
      <div className="border-t border-border/70 px-4 py-2 text-[11px] tracking-wide text-muted-foreground">
        {t("palette.hint")}
      </div>
      </Cmdk>
      </DialogContent>
    </Dialog>
  );
}

/** Header trigger — shared look for the desktop/mobile header rows. */
export function PaletteTriggerButton({ onClick, ariaLabel, tone = "light" }: { onClick: () => void; ariaLabel: string; tone?: "light" | "dark" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-11 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors",
        tone === "dark"
          ? "border-[#24405A] bg-[#16324A]/40 text-[#B9C4CE] hover:bg-[#16324A] hover:text-[#F5F1EA]"
          : "border-border bg-card text-iron-ink hover:bg-muted hover:text-cobble-ink"
      )}
    >
      <Command className="h-4 w-4 text-gold-ink" aria-hidden="true" />
      <kbd className="hidden font-mono text-[10px] tracking-[0.2em] sm:inline">⌘K</kbd>
    </button>
  );
}
