"use client";
/**
 * Workflow Studio — workflow gallery + detail (canvas / versions / runs) and
 * the platform-wide Run Inspector with approvals, retry and cancel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { api, type WfEdge, type WfNode } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import {
  BrandLoader, Eyebrow, SectionTitle, StateBadge, StatusBadge, EmptyState, Spinner, SandboxChip,
} from "@/components/brand/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useApiData, LoadingBlock, ErrorBlock } from "@/components/brand/data-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableCell } from "@/components/ui/table";
import { DataTable, createColumnHelper } from "@/components/ui/data-table";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowDown, ArrowLeft, Ban, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock, Copy,
  FlaskConical, Pencil, Play, Plus, RotateCcw, Search, Sparkles, Trash2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter,
  useDraggable, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import { NODE_CATALOG, NODE_CATEGORIES, nodeMetaByKey, type NodeField, type NodeMeta } from "@/lib/nodes/catalog";
import { useI18n } from "@/lib/i18n";

// ──────────────────────────────────────────────────────────── shared helpers

type WorkflowsRes = Awaited<ReturnType<typeof api.workflows>>;
type WfSummary = WorkflowsRes["workflows"][number];
type Template = WorkflowsRes["templates"][number];
type WfDetail = Awaited<ReturnType<typeof api.workflow>>["workflow"];
type RunRow = Awaited<ReturnType<typeof api.runs>>["runs"][number];
type RunDetail = Awaited<ReturnType<typeof api.run>>["run"];

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM HH:mm"); } catch { return "—"; }
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Workflow authoring (create/save/publish/rollback/test) is limited to Senior RM + Admin; everyone else gets a read-only studio. Mirrors the backend workflow.write capability. */
function canAuthorWorkflows(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SENIOR_RM";
}

const AI_PROMPT_MAX = 2000;

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">{children}</div>;
}

const RISK_TONES: Record<string, "neutral" | "sky" | "amber" | "red"> = {
  INTERNAL: "sky",
  PII: "amber",
  RESTRICTED: "red",
};

const RUN_STATUSES = ["RUNNING", "WAITING_APPROVAL", "WAITING_WORKFLOW", "SUCCEEDED", "FAILED", "CANCELLED"] as const;

/**
 * Node metadata comes exclusively from the self-contained registry
 * (src/lib/nodes/catalog.ts): the palette, the "Add node" list, the node
 * inspector fields and the defaults below are all derived from NODE_CATALOG.
 */

/** Initial config for a freshly added node, derived from field metadata:
 *  text/textarea → "", number → empty (written on first input),
 *  select → first option, boolean → false. */
function defaultConfigForNode(meta: NodeMeta): string {
  const cfg: Record<string, unknown> = {};
  for (const f of meta.fields) {
    if (f.type === "select") cfg[f.key] = f.options?.[0] ?? "";
    else if (f.type === "boolean") cfg[f.key] = false;
    else if (f.type === "text" || f.type === "textarea") cfg[f.key] = "";
  }
  return JSON.stringify(cfg, null, 2);
}

const isTriggerKey = (pieceKey: string) => pieceKey.startsWith("trigger.");

function safeParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────── studio: workflows

export function StudioWorkflows() {
  const session = useApp((s) => s.session);
  const canWrite = canAuthorWorkflows(session?.role);
  const setActiveWorkflow = useApp((s) => s.setActiveWorkflow);
  const { data, error, loading, reload } = useApiData(() => api.workflows());
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [disableTarget, setDisableTarget] = useState<{ wf: WfSummary; next: boolean } | null>(null);
  const [disableReason, setDisableReason] = useState("");

  // "Compose with AI" — in-process AI composer (gated by canAuthorWorkflows, like authoring itself)
  const [aiOpen, setAiOpen] = useState(false);
  const [aiGoal, setAiGoal] = useState("");
  const [aiName, setAiName] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  async function composeWithAi() {
    if (!aiGoal.trim()) {
      toast({ title: "Goal required", description: "Describe the automation the agent should compose.", variant: "destructive" });
      return;
    }
    setAiBusy(true);
    try {
      const res = await api.selfBuildWorkflow(aiGoal.trim(), aiName.trim() || undefined);
      toast({
        title: `Workflow composed — “${res.workflow.name}”`,
        description: `Composed via ${res.via} · ${res.provider} — review the canvas, then test & publish.`,
      });
      setAiOpen(false);
      setAiGoal("");
      setAiName("");
      setActiveWorkflow(res.workflow.id);
    } catch (e) {
      toast({ title: "Compose failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setAiBusy(false);
    }
  }

  async function createWorkflow(name: string, description: string, openAfter: boolean, templateKey?: string) {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await api.createWorkflow(name.trim(), description.trim(), templateKey);
      toast({
        title: "Workflow created",
        description: templateKey
          ? `“${name.trim()}” seeded with a ready-to-edit draft graph.`
          : `“${name.trim()}” created as an empty draft — add a trigger first.`,
      });
      setNewOpen(false);
      setDraft({ name: "", description: "" });
      if (openAfter) setActiveWorkflow(res.workflow.id);
      else await reload();
    } catch (e) {
      toast({ title: "Create failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(wf: WfSummary) {
    try {
      const res = await api.duplicateWorkflow(wf.id);
      toast({ title: "Workflow duplicated", description: `Created “${res.workflow.name}” as a draft.` });
      await reload();
    } catch (e) {
      toast({ title: "Duplicate failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  }

  async function confirmDisable() {
    if (!disableTarget || disableReason.trim().length < 3) return;
    setBusy(true);
    try {
      await api.setWorkflowDisabled(disableTarget.wf.id, disableTarget.next, disableReason.trim());
      toast({ title: disableTarget.next ? "Workflow disabled" : "Workflow enabled", description: disableTarget.wf.name });
      setDisableTarget(null);
      setDisableReason("");
      await reload();
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Workflow Studio</Eyebrow>
          <SectionTitle className="mt-1.5">Workflows</SectionTitle>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Author, version and publish the automation graphs that drive cases — from onboarding triggers to authority dispatch.
          </p>
        </div>
        {/* flex-wrap: the two authoring buttons are nowrap and outgrew a 320px
            page (333px) — wrapping keeps them inside the viewport. */}
        <div className="flex flex-wrap items-center gap-3">
          {!canWrite && <StatusBadge status="Read-only access" tone="amber" />}
          {canWrite && (
            <>
              <Button variant="outline" onClick={() => setAiOpen(true)}>
                <Sparkles className="mr-2 h-4 w-4 text-gold-ink" /> Compose with AI
              </Button>
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> New workflow
              </Button>
            </>
          )}
        </div>
      </div>

      {loading ? <LoadingBlock /> : error || !data ? <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} /> : (
        <Tabs defaultValue="mine">
          <TabsList className="mb-6">
            <TabsTrigger value="mine">My workflows</TabsTrigger>
            <TabsTrigger value="templates">Template gallery</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="space-y-3">
            {data.workflows.length === 0 && (
              <EmptyState
                title="No workflows yet"
                hint="Create one from scratch or start from a template in the gallery — templates seed a draft graph."
              />
            )}
            {data.workflows.map((w) => (
              <Card key={w.id} className="rounded-md border-border p-5 transition-colors hover:border-gold/60">
                {/* flex-wrap + a title basis: the shrink-0 action group used to
                    squeeze the title to ~80px (one word per line) at 320px.
                    Wrapping drops Duplicate/Disable under the title instead. */}
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <button onClick={() => setActiveWorkflow(w.id)} className="min-w-0 flex-1 basis-56 text-left" aria-label={`Open workflow ${w.name}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-editorial text-lg text-cobble-ink group-hover:text-gold-ink">{w.name}</span>
                      <StateBadge state={w.status} />
                      {w.disabled && <StatusBadge status="Disabled" tone="red" />}
                      <Badge variant="outline" className="text-[10px]">v{w.currentVersion}</Badge>
                    </div>
                    <p className="mt-1 max-w-2xl truncate text-sm text-muted-foreground">{w.description || "No description."}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Owner {w.owner} · {w.runs} run{w.runs === 1 ? "" : "s"} · updated {fmtDate(w.updatedAt)}
                    </p>
                  </button>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {canWrite && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => void duplicate(w)} aria-label={`Duplicate ${w.name}`}>
                          <Copy className="mr-1.5 h-3.5 w-3.5" /> Duplicate
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className={w.disabled ? "text-olive-ink hover:text-olive-ink" : "text-danger-ink hover:text-danger-ink"}
                          onClick={() => { setDisableReason(""); setDisableTarget({ wf: w, next: !w.disabled }); }}
                          aria-label={w.disabled ? `Enable ${w.name}` : `Disable ${w.name}`}
                        >
                          {w.disabled ? <Play className="mr-1.5 h-3.5 w-3.5" /> : <Ban className="mr-1.5 h-3.5 w-3.5" />}
                          {w.disabled ? "Enable" : "Disable"}
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setActiveWorkflow(w.id)} aria-label={`Open ${w.name}`}>
                      <ChevronRight className="h-4 w-4 text-gold-ink" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="templates" className="space-y-4">
            <div className="flex items-center gap-2">
              <SandboxChip label="Templates seed draft graphs" />
              <p className="text-xs text-muted-foreground">Using a template creates a new draft workflow you can edit freely.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.templates.map((t) => (
                <Card key={t.key} className="flex flex-col gap-0 rounded-md border-border p-5 transition-colors hover:border-gold/60">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{t.category}</Badge>
                    <StatusBadge status={t.risk} tone={RISK_TONES[t.risk] ?? "neutral"} />
                  </div>
                  <h3 className="mt-3 font-editorial text-lg leading-snug text-cobble-ink">{t.name}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{t.description}</p>
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5 text-gold-ink" /> {t.duration}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {t.pieces.map((p) => (
                      <span key={p} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-iron-ink">{p}</span>
                    ))}
                  </div>
                  <Button
                    variant="outline" size="sm" className="mt-4 w-full" disabled={busy}
                    onClick={() => void createWorkflow(t.name, t.description, true, t.key)}
                  >
                    Use template
                  </Button>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* New workflow dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>Starts as an empty draft — add nodes on the canvas, then publish when ready.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">Name</Label>
              <Input id="wf-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Golden Visa Onboarding" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-desc">Description</Label>
              <Textarea id="wf-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3} placeholder="What does this workflow automate?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void createWorkflow(draft.name, draft.description, true)}>
              {busy && <Spinner className="mr-2 h-3.5 w-3.5" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compose with AI — in-process AI composer */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compose a workflow with AI</DialogTitle>
            <DialogDescription>
              The AI composer turns your goal into a draft graph — trigger, steps and approval gates. You stay
              in control: review the canvas, test it in dry-run, then publish.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-goal">Goal</Label>
                <span
                  id="ai-goal-counter"
                  className={cn("text-[11px] tabular-nums", aiGoal.length >= AI_PROMPT_MAX ? "text-danger-ink" : "text-muted-foreground")}
                >
                  {aiGoal.length}/{AI_PROMPT_MAX}
                </span>
              </div>
              <Textarea
                id="ai-goal"
                value={aiGoal}
                maxLength={AI_PROMPT_MAX}
                rows={5}
                onChange={(e) => setAiGoal(e.target.value)}
                placeholder="Describe the automation you need — e.g. when a case reaches APPROVAL_IN_PRINCIPLE, notify the client and schedule an authority follow-up…"
                aria-describedby="ai-goal-counter"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-wf-name">Workflow name (optional — AI will name it)</Label>
              <Input
                id="ai-wf-name"
                value={aiName}
                onChange={(e) => setAiName(e.target.value)}
                placeholder="e.g. Authority Follow-up"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={aiBusy} onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button disabled={aiBusy || aiGoal.trim().length === 0} onClick={() => void composeWithAi()}>
              {aiBusy ? <Spinner className="mr-2 h-3.5 w-3.5" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />} Compose workflow
            </Button>
          </DialogFooter>
          {aiBusy && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Spinner className="h-3 w-3" /> AI is composing the graph… this can take up to a minute.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Disable / enable dialog */}
      <AlertDialog open={!!disableTarget} onOpenChange={(o) => !o && setDisableTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {disableTarget?.next ? `Disable “${disableTarget?.wf.name}”?` : `Enable “${disableTarget?.wf.name}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {disableTarget?.next
                ? "Disabled workflows cannot start new runs. In-flight runs finish normally."
                : "Enabling restores the workflow — new runs will use the latest published version."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="disable-reason">Reason (required)</Label>
            <Textarea id="disable-reason" value={disableReason} onChange={(e) => setDisableReason(e.target.value)} rows={2} placeholder="Why is this workflow being switched?" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disableReason.trim().length < 3 || busy}
              onClick={(e) => { e.preventDefault(); void confirmDisable(); }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────── studio: node palette

/** One draggable/clickable palette entry — same payload shape as the pages
 *  builder palette (`id: "palette:<key>"`, `data: { zone: "palette" }`). */
function PaletteNodeCard({
  meta, onAdd,
}: {
  meta: NodeMeta;
  onAdd: (pieceKey: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${meta.pieceKey}`,
    data: { zone: "palette" },
  });
  // Click-vs-drag guard: after a real drag dnd-kit lets a click event through.
  // A plain click lands <250ms after pointer-down; a post-drag click is later.
  const pointerDownAt = useRef(0);
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onPointerDown={() => { pointerDownAt.current = Date.now(); }}
      onClick={() => {
        const gap = pointerDownAt.current === 0 ? 0 : Date.now() - pointerDownAt.current;
        pointerDownAt.current = 0;
        if (gap > 250) return;
        onAdd(meta.pieceKey);
      }}
      aria-label={`Add ${meta.name} node — drag onto the canvas or click to add`}
      className={cn(
        "group flex w-full cursor-grab items-start gap-2.5 rounded-md border border-border/80 bg-card p-2.5 text-left transition-colors duration-150 hover:border-gold/70 hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:cursor-grabbing",
        isDragging && "opacity-50 scale-105",
      )}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-gold/50 bg-gold/10 font-editorial text-[11px] text-amber-ink transition-colors duration-150 group-hover:bg-gold/20"
      >
        {meta.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-cobble-ink">{meta.name}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{meta.description}</span>
      </span>
    </button>
  );
}

/** Node palette — every catalog node grouped by NODE_CATEGORIES, searchable.
 *  Triggers form the first section; exactly-one-trigger is enforced on add. */
function NodePalette({
  onAdd,
}: {
  onAdd: (pieceKey: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = NODE_CATEGORIES
    .map((cat) => ({
      cat,
      nodes: NODE_CATALOG.filter(
        (n) => n.category === cat && (!q || `${n.name} ${n.description} ${n.pieceKey}`.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.nodes.length > 0);

  return (
    <Card className="gap-0 rounded-md border-border p-6">
      <Eyebrow>{t("studio.palette")}</Eyebrow>
      <p className="mt-1 text-[11px] text-muted-foreground">Drag a node onto the canvas, or click to add it.</p>
      <div className="relative mt-3">
        <Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`${t("common.search")}…`}
          aria-label={t("studio.palette")}
          className="h-8 rounded-none pl-8 text-xs"
        />
      </div>
      <div className="mt-4 max-h-96 space-y-4 overflow-y-auto pr-1">
        {groups.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">No nodes match.</p>
        )}
        {groups.map((g) => (
          <div key={g.cat}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t(`studio.category.${g.cat}`)}
            </p>
            <div className="space-y-1.5">
              {g.nodes.map((n) => (
                <PaletteNodeCard key={n.pieceKey} meta={n} onAdd={onAdd} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** The flow column doubles as the drop target for palette drags. */
function DroppableFlow({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas-root", data: { zone: "canvas" } });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "max-h-150 overflow-y-auto rounded-md pr-1 transition-colors",
        isOver && "border-2 border-gold bg-gold/5",
      )}
    >
      {isOver && (
        <div className="flex items-center justify-center px-4 py-2 text-sm font-medium text-gold-ink bg-gold/10 rounded-md">
          <Plus className="mr-2 h-4 w-4" /> Drop to add node
        </div>
      )}
      {children}
    </div>
  );
}

/** DndContext for the canvas tab — palette cards drag into the flow column. */
function CanvasDnd({
  onAddPiece, children,
}: {
  onAddPiece: (pieceKey: string) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const [activePiece, setActivePiece] = useState<NodeMeta | null>(null);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(ev) => {
        const id = String(ev.active.id);
        setActivePiece(id.startsWith("palette:") ? nodeMetaByKey(id.slice("palette:".length)) ?? null : null);
      }}
      onDragEnd={(ev) => {
        const id = String(ev.active.id);
        if (id.startsWith("palette:")) {
          const key = id.slice("palette:".length);
          if (nodeMetaByKey(key)) onAddPiece(key);
        }
        setActivePiece(null);
      }}
      onDragCancel={() => setActivePiece(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activePiece && (
          <div className="flex items-center gap-2 rounded-md border border-gold/60 bg-card px-3 py-1.5 shadow-md">
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-sm border border-gold/50 bg-gold/10 font-editorial text-[10px] text-amber-ink"
            >
              {activePiece.name.charAt(0).toUpperCase()}
            </span>
            <span className="text-xs font-semibold text-cobble-ink">{activePiece.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ──────────────────────────────────────────────────────────── studio: detail

export function StudioDetail() {
  const session = useApp((s) => s.session);
  const canWrite = canAuthorWorkflows(session?.role);
  const activeWorkflowId = useApp((s) => s.activeWorkflowId);
  const setActiveWorkflow = useApp((s) => s.setActiveWorkflow);
  const setView = useApp((s) => s.setView);

  const [wf, setWf] = useState<WfDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  const [nodes, setNodes] = useState<WfNode[]>([]);
  const [validation, setValidation] = useState<{ ok: boolean; errors: string[]; draftVersion: number } | null>(null);
  // node dialog — shared by "Add node" and "Edit node"
  const [nodeOpen, setNodeOpen] = useState(false);
  const [nodeMode, setNodeMode] = useState<"add" | "edit">("add");
  const [nodeIndex, setNodeIndex] = useState<number | null>(null);
  const [formPiece, setFormPiece] = useState("");
  const [formName, setFormName] = useState("");
  const [formConfig, setFormConfig] = useState("{}");
  const [configMode, setConfigMode] = useState<"fields" | "json">("fields");
  const [insertPos, setInsertPos] = useState("end");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [changelog, setChangelog] = useState("");
  const [rollbackVersion, setRollbackVersion] = useState<number | null>(null);

  // test node panel
  const [testPiece, setTestPiece] = useState("");
  const [testInput, setTestInput] = useState("{}");
  const [testResult, setTestResult] = useState<{ ok: boolean; output?: Record<string, unknown>; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    if (!activeWorkflowId) return;
    setLoading(true);
    setError(null);
    try {
      const wfRes = await api.workflow(activeWorkflowId);
      setWf(wfRes.workflow);
      const latest = wfRes.workflow.versions[0];
      setNodes(latest ? latest.nodes.map((n) => ({ ...n })) : []);
      setValidation(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [activeWorkflowId]);

  useEffect(() => { void load(); }, [load]);

  // Catalog metadata for the node currently open in the inspector.
  const nodeMeta = nodeMetaByKey(formPiece);
  const nodeFields: NodeField[] = nodeMeta?.fields ?? [];

  if (!activeWorkflowId) {
    return (
      <PageShell>
        <div className="mb-8">
          <Eyebrow>Workflow Studio</Eyebrow>
          <SectionTitle className="mt-1.5">Workflow detail</SectionTitle>
        </div>
        <EmptyState title="No workflow selected" hint="Pick a workflow from the studio list to open its canvas, versions and runs." />
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => setActiveWorkflow(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to workflows
          </Button>
        </div>
      </PageShell>
    );
  }

  async function saveDraft() {
    if (!activeWorkflowId) return;
    setBusy(true);
    try {
      // Sequential edges; an edge leaving a condition node is labeled "true" so
      // the engine follows it on match and skips the node when unmatched.
      const edges: WfEdge[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        const edge: WfEdge = { from: nodes[i].key, to: nodes[i + 1].key };
        if (nodes[i].pieceKey === "condition.field.equals") edge.label = "true";
        edges.push(edge);
      }
      const res = await api.saveDraft(activeWorkflowId, nodes, edges);
      setValidation({ ok: res.validation.ok, errors: res.validation.errors, draftVersion: res.draftVersion });
      toast({
        title: res.validation.ok ? "Draft saved — graph valid" : "Draft saved — validation issues",
        description: res.validation.ok ? `Draft v${res.draftVersion} ready to publish.` : `${res.validation.errors.length} issue(s) found.`,
        variant: res.validation.ok ? "default" : "destructive",
      });
      await load();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function runTestRun() {
    if (!activeWorkflowId) return;
    setBusy(true);
    try {
      const res = await api.testRunWorkflow(activeWorkflowId);
      toast({
        title: "Test run started",
        description: `Dry-run ${shortId(res.runId)} executed end-to-end — inspect the node timeline in Run Inspector.`,
      });
      await load();
    } catch (e) {
      toast({ title: "Test run failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!activeWorkflowId || changelog.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await api.publishWorkflow(activeWorkflowId, changelog.trim());
      toast({ title: "Published", description: `Version v${res.published} is now live.` });
      setPublishOpen(false);
      setChangelog("");
      await load();
    } catch (e) {
      toast({ title: "Publish failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function rollback() {
    if (!activeWorkflowId || rollbackVersion === null) return;
    setBusy(true);
    try {
      await api.rollbackWorkflow(activeWorkflowId, rollbackVersion);
      toast({ title: "Rolled back", description: `v${rollbackVersion} restored as the active draft.` });
      setRollbackVersion(null);
      await load();
    } catch (e) {
      toast({ title: "Rollback failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function openAddNode() {
    setNodeMode("add");
    setNodeIndex(null);
    setFormPiece("");
    setFormName("");
    setFormConfig("{}");
    setConfigMode("fields");
    setInsertPos("end");
    setFormErr(null);
    setNodeOpen(true);
  }

  function openEditNode(index: number) {
    const n = nodes[index];
    if (!n) return;
    setNodeMode("edit");
    setNodeIndex(index);
    setFormPiece(n.pieceKey);
    setFormName(n.name);
    setFormConfig(JSON.stringify(n.config ?? {}, null, 2));
    setConfigMode("fields");
    setInsertPos("end");
    setFormErr(null);
    setNodeOpen(true);
  }

  function moveNode(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= nodes.length) return;
    const next = [...nodes];
    [next[index], next[j]] = [next[j], next[index]];
    setNodes(next);
  }

  function uniqueNodeKey(pieceKey: string): string {
    const base = pieceKey.split(".").pop() ?? "node";
    let i = nodes.length + 1;
    let key = `${base}-${i}`;
    while (nodes.some((n) => n.key === key)) { i += 1; key = `${base}-${i}`; }
    return key;
  }

  /** Add a node from the catalog palette — triggers go first and stay unique
   *  (exactly one trigger per workflow; the server validator has the final say). */
  function addPieceFromCatalog(pieceKey: string) {
    const meta = nodeMetaByKey(pieceKey);
    if (!meta) return;
    if (isTriggerKey(pieceKey) && nodes.some((n) => isTriggerKey(n.pieceKey))) {
      toast({
        title: "Trigger already set",
        description: "Every workflow has exactly one trigger — remove it before adding another.",
        variant: "destructive",
      });
      return;
    }
    const at = isTriggerKey(pieceKey) ? 0 : nodes.length;
    const node: WfNode = {
      key: uniqueNodeKey(pieceKey),
      pieceKey,
      name: meta.name,
      config: safeParseObject(defaultConfigForNode(meta)) ?? {},
    };
    setNodes([...nodes.slice(0, at), node, ...nodes.slice(at)]);
  }

  /** Write a single schema field back into the config JSON string. */
  function setConfigField(field: NodeField, value: string | boolean) {
    const cfg = safeParseObject(formConfig) ?? {};
    if (field.type === "boolean") {
      if (value === true) cfg[field.key] = true;
      else delete cfg[field.key];
    } else if (value === "") {
      delete cfg[field.key];
    } else if (field.type === "number") {
      const num = Number(value);
      if (Number.isNaN(num)) return;
      cfg[field.key] = num;
    } else {
      cfg[field.key] = value;
    }
    setFormConfig(JSON.stringify(cfg, null, 2));
  }

  function submitNode() {
    const meta = nodeMetaByKey(formPiece);
    if (!meta) { setFormErr("Choose a piece."); return; }
    const config = safeParseObject(formConfig);
    if (!config) { setFormErr("Config must be a valid JSON object."); return; }
    if (nodeMode === "edit" && nodeIndex !== null) {
      setNodes(nodes.map((n, i) => (i === nodeIndex ? { ...n, name: formName.trim() || meta.name, config } : n)));
    } else {
      const anchor = insertPos === "end" ? nodes.length - 1 : Number(insertPos);
      const at = anchor + 1;
      const node: WfNode = { key: uniqueNodeKey(formPiece), pieceKey: formPiece, name: formName.trim() || meta.name, config };
      setNodes([...nodes.slice(0, at), node, ...nodes.slice(at)]);
    }
    setNodeOpen(false);
  }

  async function runTest() {
    const sample = safeParseObject(testInput);
    if (!testPiece) { toast({ title: "Choose a piece to test", variant: "destructive" }); return; }
    if (!sample) { toast({ title: "Sample input must be a JSON object", variant: "destructive" }); return; }
    setTesting(true);
    try {
      const res = await api.testNode(testPiece, sample);
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <PageShell>
      {/* Header */}
      <div className="mb-8">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground" onClick={() => setActiveWorkflow(null)} aria-label="Back to workflows">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> All workflows
        </Button>
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={() => void load()} /> : wf && (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Eyebrow>Workflow Studio</Eyebrow>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <SectionTitle>{wf.name}</SectionTitle>
                <StateBadge state={wf.status} />
                {wf.disabled && <StatusBadge status="Disabled" tone="red" />}
                <Badge variant="outline" className="text-[10px]">v{wf.currentVersion}</Badge>
              </div>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{wf.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">Owner {wf.owner.name}</p>
            </div>
          </div>
        )}
      </div>

      {!loading && !error && wf && (
        <Tabs defaultValue="canvas">
          <TabsList className="mb-6">
            <TabsTrigger value="canvas">Canvas</TabsTrigger>
            <TabsTrigger value="versions">Versions ({wf.versions.length})</TabsTrigger>
            <TabsTrigger value="runs">Runs ({wf.runs.length})</TabsTrigger>
          </TabsList>

          {/* ── Canvas ── */}
          <TabsContent value="canvas">
            <CanvasDnd onAddPiece={addPieceFromCatalog}>
            <div className="grid gap-6 xl:grid-cols-5">
              <div className="xl:col-span-3">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Eyebrow>Flow</Eyebrow>
                    <SandboxChip label="Sequential sandbox executor" />
                  </div>
                  <div className="flex items-center gap-2">
                    {canWrite && (
                      <>
                        <Button variant="outline" size="sm" onClick={openAddNode}>
                          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add node
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => void runTestRun()}>
                          <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Test run
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => void saveDraft()}>
                          {busy ? <Spinner className="mr-2 h-3 w-3" /> : null} Save draft
                        </Button>
                        <Button size="sm" disabled={busy || nodes.length === 0} onClick={() => { setChangelog(""); setPublishOpen(true); }}>
                          Publish
                        </Button>
                      </>
                    )}
                    {!canWrite && <StatusBadge status="Read-only access" tone="amber" />}
                  </div>
                </div>

                {/* validation result */}
                {validation && (
                  <Card className={cn("mb-4 rounded-md border p-4", validation.ok ? "border-olive/50 bg-olive/5" : "border-coral/50 bg-coral/5")}>
                    {validation.ok ? (
                      <p className="flex items-center gap-2 text-sm font-medium text-olive-ink">
                        <CheckCircle2 className="h-4 w-4" /> Graph valid — draft v{validation.draftVersion} ready to publish.
                      </p>
                    ) : (
                      <div>
                        <p className="text-sm font-semibold text-danger-ink">Validation issues</p>
                        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-iron-ink">
                          {validation.errors.map((err, i) => <li key={i}>{err}</li>)}
                        </ul>
                      </div>
                    )}
                  </Card>
                )}

                {/* vertical flow — drop target for palette drags */}
                <DroppableFlow>
                  {nodes.length === 0 && (
                    <EmptyState title="Empty canvas" hint="Drag a trigger from the Nodes palette, or use Add node — every workflow needs exactly one trigger." />
                  )}
                  {nodes.map((n, idx) => {
                    const meta = nodeMetaByKey(n.pieceKey);
                    return (
                      <div key={n.key}>
                        {idx > 0 && (
                          <div className="flex flex-col items-center py-0.5" aria-hidden>
                            <div className="h-5 w-px bg-gold/60" />
                            <ArrowDown className="h-3 w-3 text-gold-ink" />
                          </div>
                        )}
                        <Card className="group flex items-start gap-4 rounded-md border-border p-4 transition-colors hover:border-gold/60">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gold/50 bg-gold/10 font-editorial text-sm text-amber-ink">
                            {(meta?.name ?? n.pieceKey).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-cobble-ink">{n.name}</span>
                              <Badge variant="outline" className="text-[10px]">{meta?.category ?? "PIECE"}</Badge>
                            </div>
                            {meta?.description && (
                              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{meta.description}</p>
                            )}
                            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{n.pieceKey}</p>
                            {(meta?.outputs.length ?? 0) > 0 && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">writes:</span>
                                {meta!.outputs.map((o) => (
                                  <span key={o} className="rounded-sm bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-ink">{o}</span>
                                ))}
                              </div>
                            )}
                            <p className="mt-1 truncate font-mono text-[11px] text-iron-ink" title={JSON.stringify(n.config)}>
                              {truncate(JSON.stringify(n.config), 90)}
                            </p>
                          </div>
                          {canWrite && (
                            <div className="flex shrink-0 items-center gap-0.5">
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-cobble-ink"
                                aria-label={`Move node ${n.name} up`} disabled={idx === 0}
                                onClick={() => moveNode(idx, -1)}
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-cobble-ink"
                                aria-label={`Move node ${n.name} down`} disabled={idx === nodes.length - 1}
                                onClick={() => moveNode(idx, 1)}
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-cobble-ink"
                                aria-label={`Edit node ${n.name}`}
                                onClick={() => openEditNode(idx)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-danger-ink"
                                aria-label={`Remove node ${n.name}`}
                                onClick={() => setNodes(nodes.filter((x) => x.key !== n.key))}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </Card>
                      </div>
                    );
                  })}
                </DroppableFlow>

                {/* test step panel */}
                {canWrite && (
                <Card className="mt-8 gap-0 rounded-md border-border p-6">
                  <Eyebrow>Test a step</Eyebrow>
                  <h3 className="mt-1 font-editorial text-lg text-cobble-ink">Dry-run a single piece</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="test-piece">Piece</Label>
                      <Select value={testPiece} onValueChange={setTestPiece}>
                        <SelectTrigger id="test-piece" className="w-full" aria-label="Test piece"><SelectValue placeholder="Choose a piece" /></SelectTrigger>
                        <SelectContent className="max-h-96 overflow-y-auto">
                          {NODE_CATEGORIES.map((cat) => (
                            <SelectGroup key={cat}>
                              <SelectLabel>{t(`studio.category.${cat}`)}</SelectLabel>
                              {NODE_CATALOG.filter((n) => n.category === cat).map((n) => (
                                <SelectItem key={n.pieceKey} value={n.pieceKey}>{n.name}</SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="test-input">Sample input (JSON)</Label>
                      <Textarea id="test-input" value={testInput} onChange={(e) => setTestInput(e.target.value)} rows={3} className="font-mono text-xs" />
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <Button variant="outline" size="sm" disabled={testing} onClick={() => void runTest()}>
                      {testing ? <Spinner className="mr-2 h-3 w-3" /> : <Play className="mr-1.5 h-3.5 w-3.5" />} Run test
                    </Button>
                    <p className="text-[11px] text-muted-foreground">Safe sample data only — never production passport data.</p>
                  </div>
                  {testResult && (
                    <Card className={cn("mt-4 rounded-md border p-4", testResult.ok ? "border-olive/50 bg-olive/5" : "border-coral/50 bg-coral/5")}>
                      {testResult.ok ? (
                        <>
                          <p className="flex items-center gap-2 text-sm font-medium text-olive-ink"><CheckCircle2 className="h-4 w-4" /> Step executed</p>
                          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-iron-ink">
                            {JSON.stringify(testResult.output ?? {}, null, 2)}
                          </pre>
                        </>
                      ) : (
                        <p className="text-sm text-danger-ink">{testResult.error ?? "Step failed."}</p>
                      )}
                    </Card>
                  )}
                </Card>
                )}
              </div>

              {/* right rail — node palette + graph summary */}
              <div className="space-y-6 xl:col-span-2">
                {canWrite && <NodePalette onAdd={addPieceFromCatalog} />}
                <Card className="gap-0 rounded-md border-border p-6">
                  <Eyebrow>How editing works</Eyebrow>
                  <ol className="mt-3 space-y-3 text-sm leading-relaxed text-iron-ink">
                    <li className="flex gap-3"><span className="font-editorial text-gold-ink">1.</span> Build the draft graph — add, edit, reorder or remove nodes; nodes run in the order shown.</li>
                    <li className="flex gap-3"><span className="font-editorial text-gold-ink">2.</span> Test run executes the latest version end-to-end in dry-run mode — every step recorded, zero side effects.</li>
                    <li className="flex gap-3"><span className="font-editorial text-gold-ink">3.</span> Save the draft; the validator checks triggers, reachability and node caps.</li>
                    <li className="flex gap-3"><span className="font-editorial text-gold-ink">4.</span> Publish with a changelog — the version becomes immutable and starts receiving runs.</li>
                  </ol>
                  <div className="my-5 h-px bg-gold/30" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Published versions are immutable; drafts never mutate active runs. Approval gates pause the run and wait for
                    an authorised human decision — never an unaudited boolean. Conditions branch: an unmatched condition skips
                    the next step.
                  </p>
                </Card>
              </div>
            </div>
            </CanvasDnd>
          </TabsContent>

          {/* ── Versions ── */}
          <TabsContent value="versions">
            <div className="mb-4 flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Published versions are immutable; drafts never mutate active runs.</p>
            </div>
            <div className="max-h-150 space-y-3 overflow-y-auto pr-1">
              {wf.versions.map((v) => (
                <Card key={v.version} className="flex flex-wrap items-center justify-between gap-4 rounded-md border-border p-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-editorial text-lg text-cobble-ink">v{v.version}</span>
                      {v.publishedAt ? <StateBadge state="PUBLISHED" /> : <StatusBadge status="Draft" tone="neutral" />}
                    </div>
                    <p className="mt-1 text-sm text-iron-ink">{v.changelog || "No changelog."}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {v.publishedAt ? `Published ${fmtDate(v.publishedAt)}` : `Updated ${fmtDate(v.publishedAt)}`} · {v.nodes.length} node{v.nodes.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canWrite && !v.publishedAt && (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => { setChangelog(""); setPublishOpen(true); }}>
                        Publish
                      </Button>
                    )}
                    {canWrite && v.publishedAt && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRollbackVersion(v.version)}>
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Roll back to this version
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ── Runs ── */}
          <TabsContent value="runs">
            <div className="max-h-150 space-y-3 overflow-y-auto pr-1">
              {wf.runs.length === 0 && (
                <EmptyState title="No runs yet" hint="Runs appear here when a case event triggers this workflow." />
              )}
              {wf.runs.map((r) => (
                <Card key={r.id} className="flex flex-wrap items-center justify-between gap-4 rounded-md border-border p-5">
                  <div className="flex min-w-0 items-center gap-4">
                    <StateBadge state={r.status} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-cobble-ink">
                        Trigger: {r.trigger}{r.case ? <span className="ml-2 font-mono text-xs text-muted-foreground">{r.case.reference}</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">Started {fmtDate(r.startedAt)}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setView("studio-runs")}>
                    Inspect in Run Inspector <ChevronRight className="ml-1.5 h-3.5 w-3.5 text-gold-ink" />
                  </Button>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Add / edit node dialog */}
      <Dialog open={nodeOpen} onOpenChange={(o) => { if (!o) setNodeOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{nodeMode === "add" ? "Add node" : "Edit node"}</DialogTitle>
            <DialogDescription>
              {nodeMode === "add"
                ? "Choose where the node runs and configure it — structured fields with a JSON fallback for full control."
                : "Update the name or configuration of this node. The piece itself stays fixed — remove and re-add to change it."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="node-piece">Piece</Label>
              <Select
                value={formPiece}
                disabled={nodeMode === "edit"}
                onValueChange={(v) => {
                  setFormPiece(v);
                  const meta = nodeMetaByKey(v);
                  if (meta) {
                    if (!formName.trim()) setFormName(meta.name);
                    setFormConfig(defaultConfigForNode(meta));
                  }
                  setConfigMode("fields");
                }}
              >
                <SelectTrigger id="node-piece" className="w-full" aria-label="Piece"><SelectValue placeholder="Choose a piece" /></SelectTrigger>
                <SelectContent className="max-h-96 overflow-y-auto">
                  {NODE_CATEGORIES.map((cat) => (
                    <SelectGroup key={cat}>
                      <SelectLabel>{t(`studio.category.${cat}`)}</SelectLabel>
                      {NODE_CATALOG.filter((n) => n.category === cat).map((n) => (
                        <SelectItem key={n.pieceKey} value={n.pieceKey}>{n.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {nodeMode === "add" && nodes.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="node-position">Position</Label>
                <Select value={insertPos} onValueChange={setInsertPos}>
                  <SelectTrigger id="node-position" className="w-full" aria-label="Position"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {nodes.map((n, i) => (
                      <SelectItem key={n.key} value={String(i)}>After “{n.name}”</SelectItem>
                    ))}
                    <SelectItem value="end">Append at end</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="node-name">Node name</Label>
              <Input id="node-name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Defaults to the piece name" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="node-config">Configuration</Label>
                {nodeFields.length > 0 && (
                  <Button
                    type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]"
                    onClick={() => setConfigMode(configMode === "fields" ? "json" : "fields")}
                    aria-label={configMode === "fields" ? "Switch to raw JSON" : "Switch to structured fields"}
                  >
                    {configMode === "fields" ? "Edit as JSON" : "Use fields"}
                  </Button>
                )}
              </div>
              {configMode === "fields" && nodeFields.length > 0 ? (
                <div className="max-h-96 space-y-3 overflow-y-auto rounded-md border border-border/70 p-3">
                  {(() => {
                    const cfg = safeParseObject(formConfig) ?? {};
                    return nodeFields.map((f) => {
                      const val = cfg[f.key];
                      const reqMarker = f.required ? <span aria-hidden="true" className="ml-1 text-gold-ink">*</span> : null;
                      if (f.type === "select") {
                        const opts = f.options ?? [];
                        // Legacy saved values that are no longer in the option list stay editable.
                        const legacy = typeof val === "string" && val !== "" && !opts.includes(val) ? [val] : [];
                        return (
                          <div key={f.key} className="space-y-1">
                            <Label htmlFor={`field-${f.key}`} className="text-xs">{f.label}{reqMarker}</Label>
                            <Select value={String(val ?? opts[0] ?? "")} onValueChange={(v) => setConfigField(f, v)}>
                              <SelectTrigger id={`field-${f.key}`} className="w-full" aria-label={f.label}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {opts.concat(legacy).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
                          </div>
                        );
                      }
                      if (f.type === "boolean") {
                        return (
                          <div key={f.key} className="flex items-center justify-between gap-3 rounded-sm border border-border/60 px-3 py-2">
                            <div className="min-w-0">
                              <Label htmlFor={`field-${f.key}`} className="text-xs">{f.label}{reqMarker}</Label>
                              {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
                            </div>
                            <Switch
                              id={`field-${f.key}`}
                              checked={val === true}
                              onCheckedChange={(c) => setConfigField(f, c === true)}
                              aria-label={f.label}
                            />
                          </div>
                        );
                      }
                      if (f.type === "textarea") {
                        return (
                          <div key={f.key} className="space-y-1">
                            <Label htmlFor={`field-${f.key}`} className="text-xs">{f.label}{reqMarker}</Label>
                            <Textarea
                              id={`field-${f.key}`}
                              value={String(val ?? "")}
                              onChange={(e) => setConfigField(f, e.target.value)}
                              rows={3}
                              placeholder={f.placeholder}
                            />
                            {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
                          </div>
                        );
                      }
                      return (
                        <div key={f.key} className="space-y-1">
                          <Label htmlFor={`field-${f.key}`} className="text-xs">{f.label}{reqMarker}</Label>
                          <Input
                            id={`field-${f.key}`}
                            type={f.type === "number" ? "number" : "text"}
                            value={String(val ?? "")}
                            onChange={(e) => setConfigField(f, e.target.value)}
                            placeholder={f.placeholder}
                          />
                          {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <Textarea
                  id="node-config"
                  value={formConfig}
                  onChange={(e) => setFormConfig(e.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                  aria-label="Node configuration JSON"
                />
              )}
              {configMode === "fields" && nodeFields.length === 0 && formPiece && (
                <p className="text-[11px] text-muted-foreground">This piece needs no configuration.</p>
              )}
            </div>
            {formErr && <p className="text-sm text-danger-ink">{formErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNodeOpen(false)}>Cancel</Button>
            <Button onClick={submitNode}>{nodeMode === "add" ? "Add to canvas" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish dialog */}
      <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              Publishing versions the current draft and makes it live for new runs. Published versions are immutable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="publish-changelog">Changelog (required)</Label>
            <Input id="publish-changelog" value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="What changed in this version?" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={changelog.trim().length < 3 || busy}
              onClick={(e) => { e.preventDefault(); void publish(); }}
            >
              Publish version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rollback confirm */}
      <AlertDialog open={rollbackVersion !== null} onOpenChange={(o) => !o && setRollbackVersion(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Roll back to v{rollbackVersion}?</AlertDialogTitle>
            <AlertDialogDescription>
              The published graph of v{rollbackVersion} is copied into a new draft. Active runs keep their current version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void rollback(); }}>
              Roll back
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────── studio: run inspector

export function StudioRuns() {
  const session = useApp((s) => s.session);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [wfFilter, setWfFilter] = useState("ALL");
  const workflowsApi = useApiData(() => api.workflows());

  const runsLoader = useCallback(() => {
    return api.runs({
      status: statusFilter === "ALL" ? undefined : statusFilter,
      workflowId: wfFilter === "ALL" ? undefined : wfFilter,
    });
  }, [statusFilter, wfFilter]);
  const { data, error, loading, reload } = useApiData(runsLoader);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [decision, setDecision] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [cancelTarget, setCancelTarget] = useState<RunDetail | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRun = useCallback(async (id: string) => {
    setRunLoading(true);
    try {
      const res = await api.run(id);
      setRun(res.run);
    } catch (e) {
      toast({ title: "Run load failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      setRun(null);
    } finally {
      setRunLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRunId) void loadRun(selectedRunId);
    else setRun(null);
  }, [selectedRunId, loadRun]);

  const waitingNode = useMemo(
    () => run?.nodeRuns.find((n) => n.status === "WAITING_APPROVAL") ?? null,
    [run]
  );
  const waitingWorkflowNode = useMemo(
    () => run?.nodeRuns.find((n) => n.status === "WAITING_WORKFLOW") ?? null,
    [run]
  );
  const canApprove = !!session && session.role !== "AUDITOR" && session.role !== "CLIENT";

  async function submitApproval() {
    if (!run || !waitingNode || !decision || approvalReason.trim().length < 3) return;
    setBusy(true);
    try {
      await api.approveRun(run.id, waitingNode.id, decision === "APPROVED" ? "APPROVED" : "REJECTED", approvalReason.trim());
      toast({ title: `Decision submitted: ${decision}`, description: "The run resumes or terminates accordingly." });
      setDecision("");
      setApprovalReason("");
      await loadRun(run.id);
      await reload();
    } catch (e) {
      toast({ title: "Approval failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function retryRun(r: RunRow | RunDetail) {
    setBusy(true);
    try {
      await api.retryRun(r.id);
      toast({ title: "Run retried", description: `Run ${shortId(r.id)} restarted from the failed node.` });
      if (selectedRunId === r.id) await loadRun(r.id);
      await reload();
    } catch (e) {
      toast({ title: "Retry failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      await api.cancelRun(cancelTarget.id, cancelReason.trim() || undefined);
      toast({ title: "Run cancelled", description: `Run ${shortId(cancelTarget.id)} stopped.` });
      setCancelTarget(null);
      setCancelReason("");
      if (selectedRunId === cancelTarget.id) await loadRun(cancelTarget.id);
      await reload();
    } catch (e) {
      toast({ title: "Cancel failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <div className="mb-8">
        <Eyebrow>Workflow Studio</Eyebrow>
        <SectionTitle className="mt-1.5">Run Inspector</SectionTitle>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every workflow run across the platform — node-level timeline, human approval decisions, retry and cancel.
        </p>
      </div>

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="run-status">Status</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
            <SelectTrigger id="run-status" className="w-48" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {RUN_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="run-workflow">Workflow</Label>
          <Select value={wfFilter} onValueChange={(v) => setWfFilter(v)}>
            <SelectTrigger id="run-workflow" className="w-64" aria-label="Filter by workflow"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All workflows</SelectItem>
              {(workflowsApi.data?.workflows ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? <LoadingBlock /> : error || !data ? <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} /> : (
        <>
          <Card className="gap-0 rounded-md border-border p-0">
            <div className="overflow-x-auto">
              <DataTable
                columns={[
                  createColumnHelper<any>()
                    .accessor("id", ({ row }) => (
                      <TableCell className="font-mono text-xs text-cobble-ink">
                        {shortId(row.id)}
                      </TableCell>
                    ))
                    .header("Run"),
                  createColumnHelper<any>()
                    .accessor("workflow", ({ row }) => (
                      <TableCell className="text-sm text-cobble-ink">
                        {truncate(row.workflow.name, 26)}
                      </TableCell>
                    ))
                    .header("Workflow"),
                  createColumnHelper<any>()
                    .accessor("case", ({ row }) => (
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.case?.reference ?? "—"}
                      </TableCell>
                    ))
                    .header("Case"),
                  createColumnHelper<any>()
                    .accessor("trigger", ({ row }) => (
                      <TableCell className="text-sm text-iron-ink">
                        {truncate(row.trigger, 18)}
                      </TableCell>
                    ))
                    .header("Trigger"),
                  createColumnHelper<any>()
                    .accessor("version", ({ row }) => (
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        v{row.version}
                      </TableCell>
                    ))
                    .header("Ver."),
                  createColumnHelper<any>()
                    .accessor("status", ({ row }) => (
                      <TableCell>
                        <StateBadge state={row.status} />
                      </TableCell>
                    ))
                    .header("Status"),
                  createColumnHelper<any>()
                    .accessor("startedAt", ({ row }) => (
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDate(row.startedAt)}
                      </TableCell>
                    ))
                    .header("Started"),
                  createColumnHelper<any>()
                    .accessor("finishedAt", ({ row }) => (
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDate(row.finishedAt)}
                      </TableCell>
                    ))
                    .header("Finished"),
                  createColumnHelper<any>()
                    .accessor("id", ({ row }) => (
                      <TableCell>
                        {row.error ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-danger-ink" onClick={(e) => e.stopPropagation()}>
                                {truncate(row.error, 22)}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80" align="end">
                              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Error</p>
                              <p className="mt-1 break-words font-mono text-xs leading-relaxed text-danger-ink">{row.error}</p>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ))
                    .header("Error"),
                ]}
                data={data.runs}
                enableSorting={true}
                enablePagination={false}
                className="w-full"
                emptyMessage="No runs match these filters."
              />
            </div>
          </Card>

          {/* detail panel */}
          {selectedRunId && (
            <Card className="mt-6 gap-0 rounded-md border-border p-6">
              {runLoading ? <LoadingBlock label="Loading run…" /> : !run ? (
                <p className="text-sm text-muted-foreground">Run could not be loaded.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <Eyebrow>Run detail</Eyebrow>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        <span className="font-editorial text-xl text-cobble-ink">Run {shortId(run.id)}</span>
                        <StateBadge state={run.status} />
                      </div>
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {run.workflow.name} · trigger {run.trigger} · v{run.version}
                        {run.case ? ` · case ${run.case.reference}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">Started {fmtDate(run.startedAt)}{run.finishedAt ? ` · finished ${fmtDate(run.finishedAt)}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {run.status === "FAILED" && (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => void retryRun(run)}>
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
                        </Button>
                      )}
                      {(run.status === "RUNNING" || run.status === "WAITING_APPROVAL" || run.status === "WAITING_WORKFLOW") && (
                        <Button variant="ghost" size="sm" className="text-danger-ink hover:text-danger-ink" disabled={busy} onClick={() => { setCancelReason(""); setCancelTarget(run); }}>
                          <Ban className="mr-1.5 h-3.5 w-3.5" /> Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  {run.error && (
                    <p className="mt-4 rounded-md border border-coral/50 bg-coral/5 px-4 py-3 font-mono text-xs leading-relaxed text-danger-ink">{run.error}</p>
                  )}

                  {/* node timeline */}
                  <div className="mt-6">
                    <Eyebrow>Node timeline</Eyebrow>
                    <div className="mt-3 max-h-150 space-y-0 overflow-y-auto pr-1">
                      {run.nodeRuns.map((n, idx) => (
                        <div key={n.id}>
                          {idx > 0 && <div className="ml-[7px] h-4 w-px bg-gold/50" aria-hidden />}
                          <div className="flex gap-3">
                            <div className="mt-2 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-gold bg-background" aria-hidden />
                            <Card className="flex-1 rounded-md border-border p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-cobble-ink">{n.name}</span>
                                  <span className="font-mono text-[11px] text-muted-foreground">{n.pieceKey}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {n.approvalDecision && (
                                    <StatusBadge status={n.approvalDecision} tone={n.approvalDecision === "APPROVED" ? "green" : "red"} />
                                  )}
                                  <StateBadge state={n.status} />
                                </div>
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-2">
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Input</p>
                                  <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-iron-ink">
                                    {n.inputPreview || "{}"}
                                  </pre>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Output</p>
                                  <pre className={cn(
                                    "mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded px-2 py-1.5 font-mono text-[11px] leading-relaxed",
                                    n.status === "FAILED" ? "bg-coral/10 text-danger-ink" : "bg-muted/60 text-iron-ink"
                                  )}>
                                    {n.error ?? (n.outputPreview || "—")}
                                  </pre>
                                </div>
                              </div>
                              {n.error && <p className="mt-2 text-xs font-medium text-danger-ink">{n.error}</p>}
                              <p className="mt-1.5 text-[10px] text-muted-foreground">
                                {n.startedAt ? `Started ${fmtDate(n.startedAt)}` : "Not started"}{n.finishedAt ? ` · finished ${fmtDate(n.finishedAt)}` : ""}
                              </p>
                            </Card>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* approval panel */}
                  {run.status === "WAITING_APPROVAL" && canApprove && waitingNode && (
                    <div className="mt-6 rounded-md border border-gold/50 bg-gold/5 p-5">
                      <Eyebrow>Approval required</Eyebrow>
                      <h4 className="mt-1 font-editorial text-lg text-cobble-ink">“{waitingNode.name}” is waiting for a decision</h4>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="approval-decision">Decision</Label>
                          <Select value={decision} onValueChange={setDecision}>
                            <SelectTrigger id="approval-decision" className="w-full" aria-label="Approval decision"><SelectValue placeholder="Approve or reject" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="APPROVED">Approved — resume the run</SelectItem>
                              <SelectItem value="REJECTED">Rejected — terminate the run</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="approval-reason">Reason (required, audited)</Label>
                          <Textarea id="approval-reason" value={approvalReason} onChange={(e) => setApprovalReason(e.target.value)} rows={2} placeholder="Why this decision?" />
                        </div>
                      </div>
                      <Button className="mt-4" disabled={busy || !decision || approvalReason.trim().length < 3} onClick={() => void submitApproval()}>
                        {busy ? <Spinner className="mr-2 h-3.5 w-3.5" /> : null} Submit decision
                      </Button>
                    </div>
                  )}
                  {run.status === "WAITING_APPROVAL" && !canApprove && waitingNode && (
                    <p className="mt-6 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                      This run is waiting for an approval decision. Your role is read-only — ask an RM or administrator to decide.
                    </p>
                  )}
                  {run.status === "WAITING_WORKFLOW" && waitingWorkflowNode && (
                    <div className="mt-6 rounded-md border border-blue-500/30 bg-blue-500/5 p-5">
                      <Eyebrow>Waiting for workflow</Eyebrow>
                      <h4 className="mt-1 font-editorial text-lg text-cobble-ink">“{waitingWorkflowNode.name}” is waiting for another workflow to complete</h4>
                      <p className="mt-2 text-sm text-muted-foreground">
                        This is a dependency, not an approval gate. The run will automatically resume when the target workflow completes.
                        No action is required from you.
                      </p>
                    </div>
                  )}
                </>
              )}
            </Card>
          )}
        </>
      )}

      {/* cancel dialog */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel run {shortId(cancelTarget?.id)}?</AlertDialogTitle>
            <AlertDialogDescription>
              The run stops at its current node. Already-completed node work is preserved for the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Textarea id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} placeholder="Why is this run being cancelled?" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#b04a48] text-white hover:bg-[#9a3f3d]"
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void confirmCancel(); }}
            >
              Cancel run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
