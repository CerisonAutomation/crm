"use client";
/**
 * Lane Pages — public-facing page builder: list, Puck-style three-zone visual
 * builder (palette · canvas · inspector) with publish lifecycle and
 * workflow-bound form submissions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { api, type LaneBlock, type LaneBinding } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import {
  Eyebrow, SectionTitle, StateBadge, EmptyState, Spinner, SandboxChip,
} from "@/components/brand/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useApiData, LoadingBlock, ErrorBlock } from "@/components/brand/data-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  AlignLeft, ArrowLeft, ChevronDown, ChevronUp, ClipboardList, Copy, Eye, FileJson, Globe, GripVertical,
  Layers, LayoutGrid, Link2, ListChecks, Megaphone, MessageSquare, Minus, MousePointerClick, PanelBottom, PanelTop, Plus, Quote, RotateCcw, Send, Sparkles, StickyNote, Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useDraggable,
  useSensor, useSensors,
} from "@dnd-kit/core";
import type {
  DragEndEvent, DragOverEvent, DragStartEvent, SensorDescriptor, SensorOptions,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BlockCanvasProvider, BlockView, PageBlocksView, readFormFields, readStr,
} from "./block-renderer";
import type { FormField } from "./block-renderer";
import { pageOps } from "./page-ops";
import type { PageRevisionRow } from "./page-ops";

// ──────────────────────────────────────────────────────────── shared helpers

type PagesRes = Awaited<ReturnType<typeof api.pages>>;
type PageDetail = Awaited<ReturnType<typeof api.page>>["page"];
type Submission = NonNullable<Awaited<ReturnType<typeof api.page>>["submissions"]>[number] & { redacted?: boolean };

const BLOCK_TYPES = ["hero", "text", "form", "footer", "quote", "faq", "checklist", "note", "divider", "cta", "cards"] as const;
type BlockType = (typeof BLOCK_TYPES)[number];

const BRIEF_MAX = 2000;

const BLOCK_DEFAULTS: Record<BlockType, Record<string, unknown>> = {
  hero: {
    eyebrow: "Citizen Lane",
    headline: "A quieter path to residency",
    subline: "Tailored guidance for Zurich applicants.",
    ctaLabel: "Start a conversation",
  },
  text: {
    title: "How we work",
    body: "Citizen Lane manages your application end to end — from eligibility to approval in principle.",
  },
  form: {
    title: "Enquiry form",
    formKey: "enquiry",
    fields: [
      { key: "fullName", label: "Full name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ],
  },
  footer: { note: "© Citizen Lane GmbH — Fabrikweg 2, Brüttisellen, Zurich" },
  quote: { text: "Let's create tomorrow.", attribution: "Citizen Lane" },
  // Ported 2026-10-06 (rest) — static content blocks from the 4.8GB chunk library.
  faq: {
    title: "Questions, answered",
    items: [
      { q: "How long does approval in principle take?", a: "Most complete files receive a decision within ten working days." },
      { q: "What does Citizen Lane cost?", a: "A fixed engagement fee agreed before any work begins — no hourly billing." },
    ],
  },
  checklist: {
    title: "Before we begin",
    items: [{ text: "Valid passport or national ID" }, { text: "Proof of address (under 3 months)" }, { text: "Employment or enrolment confirmation" }],
  },
  note: { text: "Bring originals to your first appointment — copies are certified on site.", tone: "info" },
  divider: { label: "" },
  cta: { text: "Ready for a quieter path?", sub: "Tell us where you stand — we reply within one working day.", buttonLabel: "Start a conversation", tone: "cobble" },
  cards: {
    title: "Three ways forward",
    items: [
      { title: "Assess", body: "A fixed-fee eligibility review with a written opinion." },
      { title: "Prepare", body: "Document collection, certification and submission." },
      { title: "Arrive", body: "Registration, permits and settlement support." },
    ],
  },
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM HH:mm"); } catch { return "—"; }
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}


function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">{children}</div>;
}

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

const FORM_FIELD_TYPES = ["text", "email", "tel", "date", "select", "textarea"] as const;

/**
 * Form fields for the inspector — unlike readFormFields, entries with empty keys
 * are kept (as blank rows) so a freshly added field never vanishes while it is
 * being typed.
 */
function readEditableFormFields(raw: string): FormField[] {
  const cfg = safeParseObject(raw);
  if (!cfg) return [];
  const list: unknown = cfg.fields;
  if (!Array.isArray(list)) return [];
  return list.map((f): FormField => {
    if (f === null || typeof f !== "object" || Array.isArray(f)) {
      return { key: "", label: "", type: "text", required: false };
    }
    const o = f as Record<string, unknown>;
    return {
      key: typeof o.key === "string" ? o.key : "",
      label: typeof o.label === "string" ? o.label : "",
      type: (FORM_FIELD_TYPES as readonly string[]).includes(o.type as string) && typeof o.type === "string"
        ? o.type
        : "text",
      required: o.required === true,
    };
  });
}

/** Replace the fields array inside a form block config; returns null when raw is invalid. */
function writeFormFields(raw: string, fields: FormField[]): string | null {
  const cfg = safeParseObject(raw);
  if (!cfg) return null;
  cfg.fields = fields;
  return JSON.stringify(cfg, null, 2);
}

/** Parse the CURRENT raw config, set one key, and return the pretty JSON (null when raw is invalid). */
function setConfigValue(raw: string, key: string, value: unknown): string | null {
  const cfg = safeParseObject(raw);
  if (!cfg) return null;
  cfg[key] = value;
  return JSON.stringify(cfg, null, 2);
}

/** Field names derive from the label until edited by hand. */
function slugifyKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

let uidSeq = 0;
function makeUid(): string {
  uidSeq += 1;
  return `b${uidSeq}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Palette metadata for the builder's component column. */
const BLOCK_PALETTE: Array<{ type: BlockType; name: string; hint: string; icon: LucideIcon }> = [
  { type: "hero", name: "Hero", hint: "Editorial headline, subline and call-to-action", icon: PanelTop },
  { type: "text", name: "Text", hint: "A titled section of body copy", icon: AlignLeft },
  { type: "form", name: "Form", hint: "Fields that start workflow runs on submit", icon: ClipboardList },
  { type: "quote", name: "Quote", hint: "A pull-quote with attribution", icon: Quote },
  { type: "footer", name: "Footer", hint: "Small print at the end of the page", icon: PanelBottom },
  { type: "faq", name: "FAQ", hint: "Expandable questions and answers", icon: MessageSquare },
  { type: "checklist", name: "Checklist", hint: "Ticked list of requirements or steps", icon: ListChecks },
  { type: "note", name: "Note", hint: "Toned callout box (info, warn, success)", icon: StickyNote },
  { type: "divider", name: "Divider", hint: "Gold rule, optional centred label", icon: Minus },
  { type: "cta", name: "CTA", hint: "Call-to-action panel with button", icon: Megaphone },
  { type: "cards", name: "Cards", hint: "Grid of title-and-body cards", icon: LayoutGrid },
];

// ──────────────────────────────────────────────────────────── pages list

export function PagesList() {
  const session = useApp((s) => s.session);
  const setActivePage = useApp((s) => s.setActivePage);
  const { data, error, loading, reload } = useApiData(() => api.pages());
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  // "Build with AI" — in-process AI composer; mirrors the server-side workflow.write gate.
  const canSelfBuild = session?.role === "SENIOR_RM" || session?.role === "ADMIN";
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [aiTitle, setAiTitle] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  async function composeWithAi() {
    if (!aiBrief.trim()) {
      toast({ title: "Brief required", description: "Describe the page the agent should compose.", variant: "destructive" });
      return;
    }
    setAiBusy(true);
    try {
      const res = await api.selfBuildPage(aiBrief.trim(), aiTitle.trim() || undefined);
      toast({
        title: `Page drafted — “${res.page.title}”`,
        description: `Drafted via ${res.via} · ${res.provider} — now edit and publish.`,
      });
      setAiOpen(false);
      setAiBrief("");
      setAiTitle("");
      setActivePage(res.page.id);
    } catch (e) {
      toast({ title: "Compose failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setAiBusy(false);
    }
  }

  async function create() {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await api.createPage(title.trim());
      toast({ title: "Page created", description: `Draft created at /p/${res.page.slug}` });
      setNewOpen(false);
      setActivePage(res.page.id);
    } catch (e) {
      toast({ title: "Create failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Lane Pages</Eyebrow>
          <SectionTitle className="mt-1.5">Public pages</SectionTitle>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Editorial landing pages that bind form submissions to workflow runs — versioned and auditable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSelfBuild && (
            <Button variant="outline" onClick={() => setAiOpen(true)}>
              <Sparkles className="mr-2 h-4 w-4 text-gold-ink" /> Build with AI
            </Button>
          )}
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New page
          </Button>
        </div>
      </div>

      <div className="mb-6 rounded-md border border-gold/40 bg-gold/5 px-5 py-3.5">
        <p className="text-sm text-iron-ink">
          Pages bind form submissions to workflow runs and snapshot a revision on every save. <span className="font-semibold text-cobble-ink">A form block is optional</span> — without one the page publishes as an editorial article with a general enquiry form.
        </p>
      </div>

      {loading ? <LoadingBlock /> : error || !data ? <ErrorBlock message={error ?? "Unknown error"} onRetry={reload} /> : (
        <>
          {data.pages.length === 0 && (
            <EmptyState title="No pages yet" hint="Create your first public page — a hero, a form bound to a workflow, and you are live." />
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.pages.map((p) => (
              <Card
                key={p.id}
                className="cursor-pointer gap-0 rounded-md border-border p-5 transition-colors hover:border-gold/60"
                role="button"
                tabIndex={0}
                aria-label={`Open page editor for ${p.title}`}
                onClick={() => setActivePage(p.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActivePage(p.id); } }}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-editorial text-lg leading-snug text-cobble-ink">{p.title}</h3>
                  <StateBadge state={p.status} />
                </div>
                <a
                  href={`/p/${p.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1.5 block font-mono text-xs text-muted-foreground hover:text-gold-ink hover:underline"
                >
                  /p/{p.slug}
                </a>
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <span>{p.owner} · v{p.version}</span>
                  <span>{p.submissions} submission{p.submissions === 1 ? "" : "s"}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {p.publishedAt ? `Published ${fmtDate(p.publishedAt)}` : `Updated ${fmtDate(p.updatedAt)}`}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New page</DialogTitle>
            <DialogDescription>
              Created as a draft with a starter hero block. The slug is derived from the title.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="page-title">Title</Label>
            <Input id="page-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Zurich Residency Enquiry" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void create()}>
              {busy && <Spinner className="mr-2 h-3.5 w-3.5" />} Create page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Build with AI — in-process AI composer */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compose a page with AI</DialogTitle>
            <DialogDescription>
              Describe the page you need and the AI composer drafts it — blocks, copy and a form
              bound to a workflow. You stay in control: review, edit and publish it yourself.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-brief">Brief</Label>
                <span
                  id="ai-brief-counter"
                  className={cn("text-[11px] tabular-nums", aiBrief.length >= BRIEF_MAX ? "text-danger-ink" : "text-muted-foreground")}
                >
                  {aiBrief.length}/{BRIEF_MAX}
                </span>
              </div>
              <Textarea
                id="ai-brief"
                value={aiBrief}
                maxLength={BRIEF_MAX}
                rows={5}
                onChange={(e) => setAiBrief(e.target.value)}
                placeholder="A page for our Malta citizenship programme aimed at Hong Kong entrepreneurs…"
                aria-describedby="ai-brief-counter"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-page-title">Page title (optional — AI will name it)</Label>
              <Input
                id="ai-page-title"
                value={aiTitle}
                onChange={(e) => setAiTitle(e.target.value)}
                placeholder="e.g. Malta Citizenship — Hong Kong"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={aiBusy} onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button disabled={aiBusy || aiBrief.trim().length === 0} onClick={() => void composeWithAi()}>
              {aiBusy ? <Spinner className="mr-2 h-3.5 w-3.5" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />} Compose page
            </Button>
          </DialogFooter>
          {aiBusy && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Spinner className="h-3 w-3" /> AI is composing the page… this can take up to a minute.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

// ──────────────────────────────────────────────── pages editor · builder parts

type BlockDraft = { uid: string; key: string; type: string; raw: string };

/** Palette card — drag onto the canvas, or click to append at the end. */
function PaletteCard({
  type, name, hint, icon: Icon, onAdd,
}: {
  type: BlockType;
  name: string;
  hint: string;
  icon: LucideIcon;
  onAdd: (type: BlockType) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${type}`, data: { zone: "palette" } });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={() => onAdd(type)}
      aria-label={`Add ${name} block — drag onto the canvas or click to append`}
      className={cn(
        "group flex w-full cursor-grab items-start gap-3 rounded-md border border-border/80 bg-card p-3 text-left transition-colors duration-150 hover:border-gold/70 hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-cobble text-[#F5F1EA] transition-colors duration-150 group-hover:bg-gold group-hover:text-cobble-ink"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-cobble-ink">{name}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

/** Sortable layer row in the "Page structure" list — drag, click to select, arrows as fallback. */
function LayersRow({
  block, index, count, selected, onSelect, onMove, onRemove,
}: {
  block: BlockDraft;
  index: number;
  count: number;
  selected: boolean;
  onSelect: (uid: string) => void;
  onMove: (uid: string, dir: -1 | 1) => void;
  onRemove: (uid: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: `layer:${block.uid}`,
    data: { zone: "layers" },
  });
  const name = block.type.charAt(0).toUpperCase() + block.type.slice(1);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-center gap-1 rounded border px-1.5 transition-colors duration-150",
        selected ? "border-gold bg-gold/5" : "border-border/70 bg-card",
        isDragging && "opacity-50",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Reorder ${name} block`}
        className="flex h-11 w-6 cursor-grab touch-none items-center justify-center text-muted-foreground/60 hover:text-gold-ink active:cursor-grabbing lg:h-9"
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => onSelect(block.uid)} aria-pressed={selected} className="min-w-0 flex-1 py-2 text-left">
        <span className="block truncate text-xs font-semibold text-cobble-ink">{name}</span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{block.key}</span>
      </button>
      <Button
        variant="ghost" size="icon"
        className="h-11 w-9 text-muted-foreground hover:text-cobble-ink lg:h-7 lg:w-7"
        aria-label={`Move ${name} block up`}
        disabled={index === 0}
        onClick={() => onMove(block.uid, -1)}
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost" size="icon"
        className="h-11 w-9 text-muted-foreground hover:text-cobble-ink lg:h-7 lg:w-7"
        aria-label={`Move ${name} block down`}
        disabled={index === count - 1}
        onClick={() => onMove(block.uid, 1)}
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost" size="icon"
        className="h-11 w-9 text-muted-foreground hover:text-danger-ink lg:h-7 lg:w-7"
        aria-label={`Delete ${name} block`}
        onClick={() => onRemove(block.uid)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** White droppable page surface on the canvas — dropping a palette block here appends it. */
function CanvasDropArea({ className, onDeselect, children }: { className?: string; onDeselect: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas-root", data: { zone: "canvas" } });
  return (
    <div
      ref={setNodeRef}
      onClick={onDeselect}
      className={cn(
        "min-h-[24rem] rounded-b-md bg-white px-5 py-6 transition-shadow duration-150 md:px-10 md:py-10",
        isOver && "ring-2 ring-inset ring-gold/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** One sortable block on the canvas — selection ring/chip come from BlockView; the drag handle lives here (it owns the dnd listeners). */
function CanvasSortableBlock({
  sortableId, laneBlock, index, selected, invalid, onSelectKey,
}: {
  sortableId: string;
  laneBlock: LaneBlock;
  index: number;
  selected: boolean;
  invalid: boolean;
  onSelectKey: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { zone: "canvas" },
  });
  const name = laneBlock.type.charAt(0).toUpperCase() + laneBlock.type.slice(1);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group/bk relative", isDragging && "z-20 opacity-40")}
    >
      <BlockCanvasProvider
        value={{ selectedKey: selected ? laneBlock.key : null, onSelect: onSelectKey }}
      >
        {invalid ? (
          <div className="rounded-sm border border-coral/50 bg-coral/5 px-4 py-4 text-xs leading-relaxed text-danger-ink">
            Block &ldquo;{laneBlock.key}&rdquo; has invalid JSON — open the JSON panel in the inspector to fix it.
          </div>
        ) : (
          <BlockView block={laneBlock} index={index} interactive />
        )}
      </BlockCanvasProvider>
      {!invalid && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          aria-label={`Drag ${name} block to reorder`}
          className={cn(
            "absolute -top-2.5 right-3 z-10 flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-sm bg-gold text-cobble-ink shadow-md transition-opacity duration-150 hover:bg-gold/90 focus-visible:opacity-100 active:cursor-grabbing",
            selected ? "opacity-100" : "opacity-0 group-hover/bk:opacity-100",
          )}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Collapsed raw-JSON escape hatch — keeps parity with the old JSON editor. */
function JsonDisclosure({ block, onApply }: { block: BlockDraft; onApply: (raw: string) => void }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ uid: block.uid, raw: block.raw });
  const draft = state.uid === block.uid ? state.raw : block.raw;
  const dirtyDraft = draft !== block.raw;

  function apply() {
    if (safeParseObject(draft) === null) {
      toast({ title: "Invalid JSON", description: "The block config must be a JSON object.", variant: "destructive" });
      return;
    }
    onApply(draft);
    setState({ uid: block.uid, raw: draft });
    toast({ title: "JSON applied", description: `Block “${block.key}” updated.` });
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-5 border-t border-border/60 pt-3">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost" size="sm"
          className="h-11 px-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-cobble-ink lg:h-9"
          aria-expanded={open}
          aria-label={`Toggle raw JSON editor for block ${block.key}`}
        >
          <FileJson className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          JSON
          {dirtyDraft && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
          <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 pt-2">
          <Textarea
            value={draft}
            onChange={(e) => setState({ uid: block.uid, raw: e.target.value })}
            rows={block.type === "form" ? 10 : 6}
            className="font-mono text-[11px]"
            aria-label={`Raw JSON config for block ${block.key}`}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-11 lg:h-9" onClick={apply}>Apply</Button>
            <Button
              variant="ghost" size="sm" className="h-11 lg:h-9"
              onClick={() => setState({ uid: block.uid, raw: block.raw })}
            >
              Reset
            </Button>
            <p className="ml-auto text-[10px] text-muted-foreground">Power-user escape hatch.</p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** AI refine — per-block instruction → api.aiRefineBlock → applies the returned config. */
function AiRefineCard({ block, onApply }: { block: BlockDraft | null; onApply: (uid: string, config: Record<string, unknown>) => void }) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  async function refine() {
    if (!block) return;
    const cfg = safeParseObject(block.raw);
    if (cfg === null) {
      toast({ title: "Invalid JSON", description: "Fix this block’s config before refining it.", variant: "destructive" });
      return;
    }
    if (!instruction.trim()) {
      toast({ title: "Describe the change", description: "Tell the model what to refine on this block.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await api.aiRefineBlock({ key: block.key, type: block.type, config: cfg }, instruction.trim());
      if (res.changed) {
        onApply(block.uid, res.block.config);
        setInstruction("");
        toast({
          title: `Refined via ${res.provider}`,
          description: `The ${block.type} block was updated on the canvas — review it, then save.`,
        });
      } else {
        toast({
          title: "No changes suggested",
          description: res.note ?? `${res.provider} returned the block unchanged.`,
        });
      }
    } catch (e) {
      toast({ title: "Refine failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-0 rounded-md border-border p-4">
      <Eyebrow>AI assist</Eyebrow>
      <h3 className="mt-1 font-editorial text-lg text-cobble-ink">Refine with AI</h3>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {block
          ? <>Describe a change and the model rewrites the selected <span className="font-semibold text-cobble-ink">{block.type}</span> block.</>
          : "Select a block to refine it."}
      </p>
      <Textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={3}
        maxLength={500}
        disabled={!block || busy}
        placeholder="Describe the change… e.g. make the headline more confident"
        aria-label="Describe the change for AI refinement"
        className="mt-3 text-xs"
      />
      <Button className="mt-3 h-11 w-full lg:h-9" disabled={!block || busy} onClick={() => void refine()}>
        {busy ? <Spinner className="mr-2 h-3.5 w-3.5" /> : <Sparkles className="mr-2 h-3.5 w-3.5 text-gold-ink" />}
        Refine with AI
      </Button>
    </Card>
  );
}

/** Generic pair-list editor for inspector list blocks (faq items, cards).
 *  faq shape: { q, a } · cards shape: { title, body }. firstKey/secondKey map
 *  the generic editor onto the concrete shape. */
function PairListEditor({
  idBase, raw, onRawChange, firstKey, secondKey, firstLabel, secondLabel, secondTextarea, addLabel,
}: {
  idBase: string;
  raw: string;
  onRawChange: (raw: string) => void;
  firstKey: string;
  secondKey: string;
  firstLabel: string;
  secondLabel: string;
  secondTextarea?: boolean;
  addLabel: string;
}) {
  const cfg = safeParseObject(raw);
  const list: Array<Record<string, unknown>> = Array.isArray(cfg?.items)
    ? (cfg!.items as unknown[]).map((it) => (typeof it === "object" && it !== null && !Array.isArray(it) ? (it as Record<string, unknown>) : {}))
    : [];
  const write = (next: Array<Record<string, unknown>>) => {
    const out = setConfigValue(raw, "items", next);
    if (out !== null) onRawChange(out);
  };
  const set = (i: number, k: string, v: string) => {
    const next = list.map((it, j) => (j === i ? { ...it, [k]: v } : it));
    write(next);
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Items ({list.length})</p>
      {list.map((it, i) => (
        <div key={i} className="space-y-2 rounded border border-border/70 p-2.5">
          <div className="space-y-1">
            <Label htmlFor={`${idBase}-item-${i}-a`} className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{firstLabel}</Label>
            <Input id={`${idBase}-item-${i}-a`} value={typeof it[firstKey] === "string" ? (it[firstKey] as string) : ""} onChange={(e) => set(i, firstKey, e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idBase}-item-${i}-b`} className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{secondLabel}</Label>
            {secondTextarea ? (
              <Textarea id={`${idBase}-item-${i}-b`} rows={2} value={typeof it[secondKey] === "string" ? (it[secondKey] as string) : ""} onChange={(e) => set(i, secondKey, e.target.value)} />
            ) : (
              <Input id={`${idBase}-item-${i}-b`} value={typeof it[secondKey] === "string" ? (it[secondKey] as string) : ""} onChange={(e) => set(i, secondKey, e.target.value)} className="h-9" />
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-danger-ink" onClick={() => write(list.filter((_, j) => j !== i))}>
            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Remove
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-9 w-full" onClick={() => write([...list, { [firstKey]: "", [secondKey]: "" }])}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {addLabel}
      </Button>
    </div>
  );
}

/** Single-text list editor (checklist items). */
function SingleListEditor({
  idBase, raw, onRawChange, itemLabel, addLabel,
}: {
  idBase: string;
  raw: string;
  onRawChange: (raw: string) => void;
  itemLabel: string;
  addLabel: string;
}) {
  const cfg = safeParseObject(raw);
  const list: string[] = Array.isArray(cfg?.items)
    ? (cfg!.items as unknown[]).map((it) => {
        if (typeof it === "string") return it;
        if (typeof it === "object" && it !== null && !Array.isArray(it) && typeof (it as Record<string, unknown>).text === "string") {
          return (it as Record<string, unknown>).text as string;
        }
        return "";
      })
    : [];
  const write = (next: Array<{ text: string }>) => {
    const out = setConfigValue(raw, "items", next);
    if (out !== null) onRawChange(out);
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Items ({list.length})</p>
      {list.map((text, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input aria-label={`${itemLabel} ${i + 1}`} value={text} onChange={(e) => write(list.map((t, j) => ({ text: j === i ? e.target.value : t })))} className="h-9" />
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-danger-ink" aria-label={`Remove ${itemLabel} ${i + 1}`} onClick={() => write(list.filter((_, j) => j !== i).map((t) => ({ text: t })))}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-9 w-full" onClick={() => write([...list.map((t) => ({ text: t })), { text: "" }])}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {addLabel}
      </Button>
    </div>
  );
}

/** Structured inspector for the selected block — no JSON unless you open the disclosure. */
function BlockInspector({
  block, onRawChange, onDuplicate, onDelete, formKey, bindings, publishedWorkflows, workflowName, onSetBinding,
}: {
  block: BlockDraft;
  onRawChange: (raw: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  formKey: string;
  bindings: LaneBinding[];
  publishedWorkflows: Array<{ id: string; name: string }>;
  workflowName: Map<string, string>;
  onSetBinding: (formKey: string, workflowId: string | null) => void;
}) {
  const parsed = safeParseObject(block.raw);
  const cfg = parsed ?? {};
  const knownType = (BLOCK_TYPES as readonly string[]).includes(block.type);
  const idBase = `insp-${block.uid}`;
  const labelCls = "text-[11px] uppercase tracking-[0.16em] text-muted-foreground";
  const name = block.type.charAt(0).toUpperCase() + block.type.slice(1);
  const binding = bindings.find((b) => b.formKey === formKey) ?? null;

  function setSimple(key: string, value: string) {
    const next = setConfigValue(block.raw, key, value);
    if (next !== null) onRawChange(next);
  }

  function setFormField(patch: Partial<FormField>, fi: number) {
    const fields = readEditableFormFields(block.raw);
    if (fi < 0 || fi >= fields.length) return;
    const next = { ...fields[fi], ...patch };
    if (patch.label !== undefined) {
      const derived = slugifyKey(patch.label);
      if (derived) next.key = derived; // name auto-derived from label
    }
    fields[fi] = next;
    const raw = writeFormFields(block.raw, fields);
    if (raw !== null) onRawChange(raw);
  }

  function addFormField() {
    const fields = readEditableFormFields(block.raw);
    fields.push({ key: "", label: "", type: "text", required: false });
    const raw = writeFormFields(block.raw, fields);
    if (raw !== null) onRawChange(raw);
  }

  function removeFormField(fi: number) {
    const fields = readEditableFormFields(block.raw);
    if (fi < 0 || fi >= fields.length) return;
    fields.splice(fi, 1);
    const raw = writeFormFields(block.raw, fields);
    if (raw !== null) onRawChange(raw);
  }

  const formFields = block.type === "form" ? readEditableFormFields(block.raw) : [];
  const formFieldKeys = formFields.map((f) => f.key.trim());
  const formFieldKeyIssues =
    formFieldKeys.some((k) => k === "") ||
    formFieldKeys.some((k, i) => k !== "" && formFieldKeys.indexOf(k) !== i);

  return (
    <Card className="gap-0 rounded-md border-border p-4">
      {/* Inspector header */}
      <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <Eyebrow>Inspector</Eyebrow>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wider">{block.type}</Badge>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{block.key}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost" size="icon"
            className="h-11 w-11 text-muted-foreground hover:text-cobble-ink lg:h-7 lg:w-7"
            aria-label={`Duplicate ${name} block`}
            onClick={onDuplicate}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-11 w-11 text-muted-foreground hover:text-danger-ink lg:h-7 lg:w-7"
            aria-label={`Delete ${name} block`}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Structured fields per block type */}
      {parsed === null ? (
        <p className="mt-4 rounded border border-amber-brand/40 bg-amber-brand/5 px-2.5 py-1.5 text-[11px] text-amber-ink">
          Invalid JSON — fix it in the JSON panel below to edit this block with structured fields.
        </p>
      ) : !knownType ? (
        <p className="mt-4 rounded border border-amber-brand/40 bg-amber-brand/5 px-2.5 py-1.5 text-[11px] text-amber-ink">
          Unknown block type — edit it with raw JSON below.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {block.type === "hero" && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-eyebrow`} className={labelCls}>Eyebrow</Label>
                <Input id={`${idBase}-eyebrow`} value={readStr(cfg, "eyebrow")} onChange={(e) => setSimple("eyebrow", e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-headline`} className={labelCls}>Headline</Label>
                <Input id={`${idBase}-headline`} value={readStr(cfg, "headline")} onChange={(e) => setSimple("headline", e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-subline`} className={labelCls}>Subline</Label>
                <Input id={`${idBase}-subline`} value={readStr(cfg, "subline")} onChange={(e) => setSimple("subline", e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-ctaLabel`} className={labelCls}>CTA label</Label>
                <Input id={`${idBase}-ctaLabel`} value={readStr(cfg, "ctaLabel")} onChange={(e) => setSimple("ctaLabel", e.target.value)} className="h-9" placeholder="e.g. Start a conversation" />
              </div>
            </>
          )}
          {block.type === "text" && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-title`} className={labelCls}>Title</Label>
                <Input id={`${idBase}-title`} value={readStr(cfg, "title")} onChange={(e) => setSimple("title", e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-body`} className={labelCls}>Body</Label>
                <Textarea
                  id={`${idBase}-body`}
                  rows={4}
                  value={readStr(cfg, "body")}
                  onChange={(e) => setSimple("body", e.target.value)}
                />
              </div>
            </>
          )}
          {block.type === "quote" && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-quote-text`} className={labelCls}>Quote</Label>
                <Textarea
                  id={`${idBase}-quote-text`}
                  rows={3}
                  value={readStr(cfg, "text")}
                  onChange={(e) => setSimple("text", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-attribution`} className={labelCls}>Attribution</Label>
                <Input id={`${idBase}-attribution`} value={readStr(cfg, "attribution")} onChange={(e) => setSimple("attribution", e.target.value)} className="h-9" />
              </div>
            </>
          )}
          {block.type === "footer" && (
            <div className="space-y-1">
              <Label htmlFor={`${idBase}-note`} className={labelCls}>Footer note</Label>
              <Input id={`${idBase}-note`} value={readStr(cfg, "note")} onChange={(e) => setSimple("note", e.target.value)} className="h-9" />
            </div>
          )}
          {block.type === "faq" && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-faq-title`} className={labelCls}>Title</Label>
                <Input id={`${idBase}-faq-title`} value={readStr(cfg, "title")} onChange={(e) => setSimple("title", e.target.value)} className="h-9" />
              </div>
              <PairListEditor
                idBase={idBase}
                raw={block.raw}
                onRawChange={onRawChange}
                firstKey="q"
                secondKey="a"
                firstLabel="Question"
                secondLabel="Answer"
                secondTextarea
                addLabel="Add question"
              />
            </>
          )}
          {block.type === "checklist" && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-checklist-title`} className={labelCls}>Title</Label>
                <Input id={`${idBase}-checklist-title`} value={readStr(cfg, "title")} onChange={(e) => setSimple("title", e.target.value)} className="h-9" />
              </div>
              <SingleListEditor
                idBase={idBase}
                raw={block.raw}
                onRawChange={onRawChange}
                itemLabel="Item"
                addLabel="Add item"
              />
            </>
          )}
          {block.type === "note" && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-note-text`} className={labelCls}>Text</Label>
                <Textarea id={`${idBase}-note-text`} rows={3} value={readStr(cfg, "text")} onChange={(e) => setSimple("text", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-note-tone`} className={labelCls}>Tone</Label>
                <Select value={readStr(cfg, "tone") || "warn"} onValueChange={(v) => setSimple("tone", v)}>
                  <SelectTrigger id={`${idBase}-note-tone`} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warn">Warn</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {block.type === "divider" && (
            <div className="space-y-1">
              <Label htmlFor={`${idBase}-divider-label`} className={labelCls}>Label (optional)</Label>
              <Input id={`${idBase}-divider-label`} value={readStr(cfg, "label")} onChange={(e) => setSimple("label", e.target.value)} className="h-9" />
            </div>
          )}
          {block.type === "cta" && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-cta-text`} className={labelCls}>Text</Label>
                <Input id={`${idBase}-cta-text`} value={readStr(cfg, "text")} onChange={(e) => setSimple("text", e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-cta-sub`} className={labelCls}>Subline</Label>
                <Input id={`${idBase}-cta-sub`} value={readStr(cfg, "sub")} onChange={(e) => setSimple("sub", e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-cta-button`} className={labelCls}>Button label</Label>
                <Input id={`${idBase}-cta-button`} value={readStr(cfg, "buttonLabel")} onChange={(e) => setSimple("buttonLabel", e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-cta-tone`} className={labelCls}>Tone</Label>
                <Select value={readStr(cfg, "tone") || "cobble"} onValueChange={(v) => setSimple("tone", v)}>
                  <SelectTrigger id={`${idBase}-cta-tone`} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cobble">Cobble</SelectItem>
                    <SelectItem value="gold">Gold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {block.type === "cards" && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-cards-title`} className={labelCls}>Title</Label>
                <Input id={`${idBase}-cards-title`} value={readStr(cfg, "title")} onChange={(e) => setSimple("title", e.target.value)} className="h-9" />
              </div>
              <PairListEditor
                idBase={idBase}
                raw={block.raw}
                onRawChange={onRawChange}
                firstKey="title"
                secondKey="body"
                firstLabel="Card title"
                secondLabel="Card body"
                secondTextarea
                addLabel="Add card"
              />
            </>
          )}
          {block.type === "form" && (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-title`} className={labelCls}>Title</Label>
                <Input id={`${idBase}-title`} value={readStr(cfg, "title")} onChange={(e) => setSimple("title", e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-formKey`} className={labelCls}>Form key</Label>
                <Input
                  id={`${idBase}-formKey`}
                  value={readStr(cfg, "formKey")}
                  onChange={(e) => setSimple("formKey", e.target.value)}
                  placeholder="e.g. enquiry"
                  pattern="[a-z0-9\-]*"
                  className="h-9 font-mono text-xs"
                  aria-describedby={`${idBase}-formKey-hint`}
                />
                <p id={`${idBase}-formKey-hint`} className="text-[11px] text-muted-foreground">
                  Lowercase letters, numbers and dashes — bindings reference this key.
                </p>
              </div>
              <div className="space-y-2">
                <p className={cn("font-medium", labelCls)}>Fields</p>
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {formFields.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">No fields yet.</p>
                  )}
                  {formFields.map((f, fi) => (
                    <div key={fi} className="rounded border border-border/70 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Field {fi + 1}
                        </p>
                        <Button
                          variant="ghost" size="icon"
                          className="h-11 w-11 text-muted-foreground hover:text-danger-ink lg:h-7 lg:w-7"
                          aria-label={`Remove field ${fi + 1}`}
                          onClick={() => removeFormField(fi)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <div className="col-span-2 space-y-1">
                          <Label htmlFor={`${idBase}-f${fi}-label`} className={labelCls}>Label</Label>
                          <Input
                            id={`${idBase}-f${fi}-label`}
                            value={f.label}
                            onChange={(e) => setFormField({ label: e.target.value }, fi)}
                            className="h-9 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${idBase}-f${fi}-type`} className={labelCls}>Type</Label>
                          <Select value={f.type} onValueChange={(v) => setFormField({ type: v }, fi)}>
                            <SelectTrigger
                              id={`${idBase}-f${fi}-type`}
                              className="h-9 w-full text-xs"
                              aria-label={`Type for field ${fi + 1}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FORM_FIELD_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${idBase}-f${fi}-key`} className={labelCls}>Name</Label>
                          <Input
                            id={`${idBase}-f${fi}-key`}
                            value={f.key}
                            onChange={(e) => setFormField({ key: e.target.value }, fi)}
                            placeholder="field_name"
                            className="h-9 font-mono text-xs"
                          />
                        </div>
                        <div className="col-span-2 flex h-9 items-center gap-2">
                          <Checkbox
                            id={`${idBase}-f${fi}-required`}
                            checked={f.required}
                            onCheckedChange={(v) => setFormField({ required: v === true }, fi)}
                            aria-label={`Required for field ${fi + 1}`}
                          />
                          <Label htmlFor={`${idBase}-f${fi}-required`} className="cursor-pointer text-xs font-normal text-iron-ink">
                            Required field
                          </Label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {formFieldKeyIssues && (
                  <p className="rounded border border-amber-brand/40 bg-amber-brand/5 px-2.5 py-1.5 text-[11px] text-amber-ink">
                    Field names must be non-empty and unique.
                  </p>
                )}
                <Button variant="outline" size="sm" className="h-11 lg:h-9" onClick={addFormField}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add field
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Workflow binding — lives inside the inspector when a form block is selected */}
      {block.type === "form" && parsed !== null && (
        <div className="mt-5 border-t border-border/60 pt-4">
          <Eyebrow>Workflow binding</Eyebrow>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {formKey
              ? <>Submissions of <span className="font-mono">{formKey}</span> start an auditable run in the bound workflow.</>
              : "Set a form key above to bind this form to a workflow."}
          </p>
          {formKey && (
            publishedWorkflows.length === 0 && !binding ? (
              <p className="mt-2 text-[11px] text-muted-foreground">No published workflows available to bind.</p>
            ) : (
              <Select
                value={binding?.workflowId ?? "none"}
                onValueChange={(v) => onSetBinding(formKey, v === "none" ? null : v)}
              >
                <SelectTrigger className="mt-2 h-9 w-full text-xs" aria-label={`Workflow bound to form ${formKey}`}>
                  <SelectValue placeholder="Not bound" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not bound</SelectItem>
                  {publishedWorkflows.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  {/* Keep a stale target selectable so the control renders its value instead of
                      blank — picking it re-selects the same (dead) workflow, never a new one. */}
                  {binding && !publishedWorkflows.some((w) => w.id === binding.workflowId) && (
                    <SelectItem value={binding.workflowId}>
                      {workflowName.get(binding.workflowId) ?? shortId(binding.workflowId)} — not live
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )
          )}
          {formKey && binding && !publishedWorkflows.some((w) => w.id === binding.workflowId) && (
            <p className="mt-2 rounded border border-amber-brand/40 bg-amber-brand/5 px-2.5 py-1.5 text-[11px] text-amber-ink">
              The bound workflow is no longer published or enabled. Submissions still arrive, but they will
              not start a run — rebind here or republish the workflow.
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Binding applies when you press “Save draft”.</p>
        </div>
      )}

      <JsonDisclosure block={block} onApply={onRawChange} />
    </Card>
  );
}

/** Right panel — the whole DndContext so the canvas, palette and layers share it. */
function BuilderDnd({
  sensors, onDragStart, onDragOver, onDragEnd, onDragCancel, overlay, children,
}: {
  sensors: SensorDescriptor<SensorOptions>[];
  onDragStart: (e: DragStartEvent) => void;
  onDragOver: (e: DragOverEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  onDragCancel: () => void;
  overlay: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {children}
      <DragOverlay dropAnimation={null}>{overlay}</DragOverlay>
    </DndContext>
  );
}

function useIsDesktop() {
  // PagesEditor only mounts after client navigation — lazy init avoids a flash.
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => globalThis.window !== undefined && window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

// ──────────────────────────────────────────────────────────── pages editor

export function PagesEditor() {
  const activePageId = useApp((s) => s.activePageId);
  const setActivePage = useApp((s) => s.setActivePage);
  const isDesktop = useIsDesktop();

  const [page, setPage] = useState<PageDetail | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const workflowsApi = useApiData(() => api.workflows());

  const [blocks, setBlocks] = useState<BlockDraft[]>([]);
  const [bindings, setBindings] = useState<LaneBinding[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const [bindOpen, setBindOpen] = useState(false);
  const [bindFormKey, setBindFormKey] = useState("");
  const [bindWfId, setBindWfId] = useState("");
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [revisions, setRevisions] = useState<PageRevisionRow[]>([]);

  // preview form state (test submissions)
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // dnd transient state
  const [dndActive, setDndActive] = useState<
    { kind: "block"; uid: string } | { kind: "palette"; type: BlockType } | null
  >(null);
  const dragStartAt = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const touch = useCallback(() => setDirty(true), []);

  /** Whether the current draft has a form block — publish no longer requires one. */
  const hasForm = useMemo(() => blocks.some((b) => b.type === "form"), [blocks]);

  /**
   * Palette clicks append a block — but after a real drag dnd-kit lets a click
   * event through, so guard on the drag-start timestamp to avoid double adds.
   */
  function addFromPalette(type: BlockType) {
    if (Date.now() - dragStartAt.current < 250) return;
    addBlockOfType(type);
  }

  const load = useCallback(async () => {
    if (!activePageId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.page(activePageId, true);
      setPage(res.page);
      setSubmissions(res.submissions ?? []);
      setBlocks(res.page.blocks.map((b) => ({
        uid: makeUid(), key: b.key, type: b.type, raw: JSON.stringify(b.config, null, 2),
      })));
      setBindings(res.page.bindings.map((b) => ({ ...b })));
      setSelectedUid(null);
      setDirty(false);
      // Revision history — best-effort: a failure must not blank the editor.
      void pageOps.revisions(activePageId).then((r) => setRevisions(r.revisions)).catch(() => setRevisions([]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [activePageId]);

  useEffect(() => { void load(); }, [load]);

  const workflowName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workflowsApi.data?.workflows ?? []) map.set(w.id, w.name);
    return map;
  }, [workflowsApi.data]);

  const formKeys = useMemo(() => {
    const keys: string[] = [];
    for (const b of blocks) {
      if (b.type !== "form") continue;
      const cfg = safeParseObject(b.raw);
      if (!cfg) continue;
      const k = readStr(cfg, "formKey");
      if (k && !keys.includes(k)) keys.push(k);
    }
    return keys;
  }, [blocks]);

  const publishedWorkflows = useMemo(
    () => (workflowsApi.data?.workflows ?? [])
      .filter((w) => w.status === "PUBLISHED" && !w.disabled)
      .map((w) => ({ id: w.id, name: w.name })),
    [workflowsApi.data],
  );

  /** Bindings whose target workflow is no longer live (unpublished, disabled or
   * deleted since the draft was saved) — submissions against them record no run. */
  const staleBindings = useMemo(() => {
    const live = new Set(publishedWorkflows.map((w) => w.id));
    return bindings.filter((b) => !live.has(b.workflowId));
  }, [bindings, publishedWorkflows]);

  const selected = useMemo(() => blocks.find((b) => b.uid === selectedUid) ?? null, [blocks, selectedUid]);

  /** LaneBlocks for the canvas — parsed once per edit. */
  const laneBlocks = useMemo(() => blocks.map((b) => {
    const cfg = safeParseObject(b.raw);
    return { key: b.key, type: b.type, config: cfg ?? {} };
  }), [blocks]);

  const invalidRaw = useMemo(
    () => new Set(blocks.filter((b) => safeParseObject(b.raw) === null).map((b) => b.uid)),
    [blocks],
  );

  const firstFormBlock = useMemo(() => blocks.find((b) => b.type === "form") ?? null, [blocks]);
  const firstFormFields = useMemo(() => {
    if (!firstFormBlock) return [];
    const cfg = safeParseObject(firstFormBlock.raw);
    return cfg ? readFormFields(cfg) : [];
  }, [firstFormBlock]);
  const firstFormKey = useMemo(() => {
    if (!firstFormBlock) return undefined;
    const cfg = safeParseObject(firstFormBlock.raw);
    return cfg ? readStr(cfg, "formKey") : undefined;
  }, [firstFormBlock]);
  const pageStatus = page?.status ?? "DRAFT";

  // ── block mutations ──

  function updateBlockRaw(uid: string, raw: string) {
    setBlocks((bs) => bs.map((b) => (b.uid === uid ? { ...b, raw } : b)));
    touch();
  }

  function addBlockOfType(type: BlockType, at?: number) {
    let n = blocks.filter((b) => b.type === type).length + 1;
    let key = `${type}-${n}`;
    while (blocks.some((b) => b.key === key)) { n += 1; key = `${type}-${n}`; }
    const uid = makeUid();
    const draft: BlockDraft = { uid, key, type, raw: JSON.stringify(BLOCK_DEFAULTS[type], null, 2) };
    const idx = at === undefined ? blocks.length : Math.min(Math.max(at, 0), blocks.length);
    setBlocks((bs) => {
      const next = [...bs];
      next.splice(idx, 0, draft);
      return next;
    });
    setSelectedUid(uid);
    touch();
  }

  function duplicateBlock(uid: string) {
    const i = blocks.findIndex((b) => b.uid === uid);
    if (i < 0) return;
    const src = blocks[i];
    let n = blocks.filter((b) => b.type === src.type).length + 1;
    let key = `${src.type}-${n}`;
    while (blocks.some((b) => b.key === key)) { n += 1; key = `${src.type}-${n}`; }
    const copy: BlockDraft = { ...src, uid: makeUid(), key };
    setBlocks((bs) => {
      const next = [...bs];
      next.splice(i + 1, 0, copy);
      return next;
    });
    setSelectedUid(copy.uid);
    touch();
  }

  function removeBlock(uid: string) {
    setBlocks((bs) => bs.filter((b) => b.uid !== uid));
    setSelectedUid((cur) => (cur === uid ? null : cur));
    touch();
  }

  function moveBlock(uid: string, dir: -1 | 1) {
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.uid === uid);
      const target = i + dir;
      if (i < 0 || target < 0 || target >= bs.length) return bs;
      return arrayMove(bs, i, target);
    });
    touch();
  }

  /** Canvas clicks report block keys — map back to the stable uid. */
  function selectByKey(key: string) {
    const found = blocks.find((b) => b.key === key);
    setSelectedUid(found ? found.uid : null);
  }

  function setBindingFor(formKey: string, workflowId: string | null) {
    setBindings((bs) => [
      ...bs.filter((b) => b.formKey !== formKey),
      ...(workflowId ? [{ formKey, workflowId }] : []),
    ]);
    touch();
  }

  // ── dnd ──

  function uidFromDndId(id: string): string | null {
    if (id.startsWith("layer:")) return id.slice("layer:".length);
    if (id.startsWith("palette:")) return null;
    return blocks.some((b) => b.uid === id) ? id : null;
  }

  function onDragStart(ev: DragStartEvent) {
    dragStartAt.current = Date.now();    const id = String(ev.active.id);
    if (id.startsWith("palette:")) {
      const t = id.slice("palette:".length) as BlockType;
      if ((BLOCK_TYPES as readonly string[]).includes(t)) setDndActive({ kind: "palette", type: t });
    } else if (blocks.some((b) => b.uid === id)) {
      setDndActive({ kind: "block", uid: id });
    }
  }

  function onDragOver(ev: DragOverEvent) {
    const over = ev.over;
    if (!over) return;
    const fromUid = uidFromDndId(String(ev.active.id));
    const toUid = uidFromDndId(String(over.id));
    if (!fromUid || !toUid || fromUid === toUid) return;
    setBlocks((bs) => {
      const from = bs.findIndex((b) => b.uid === fromUid);
      const to = bs.findIndex((b) => b.uid === toUid);
      if (from < 0 || to < 0 || from === to) return bs;
      return arrayMove(bs, from, to);
    });
    touch();
  }

  function onDragEnd(ev: DragEndEvent) {
    const activeId = String(ev.active.id);
    if (activeId.startsWith("palette:")) {
      const t = activeId.slice("palette:".length) as BlockType;
      let at = blocks.length;
      if (ev.over) {
        const overId = String(ev.over.id);
        if (overId !== "canvas-root") {
          const toUid = uidFromDndId(overId);
          const idx = toUid ? blocks.findIndex((b) => b.uid === toUid) : -1;
          if (idx >= 0) at = idx; // insert before the hovered block
        }
      }
      addBlockOfType(t, at);
    }
    setDndActive(null);
  }

  function onDragCancel() {
    setDndActive(null);
  }

  // ── lifecycle flows (unchanged contracts) ──

  /** Parse block drafts into LaneBlocks; returns null + toast on invalid JSON. */
  function parseBlocks(): LaneBlock[] | null {
    const out: LaneBlock[] = [];
    for (const b of blocks) {
      const cfg = safeParseObject(b.raw);
      if (!cfg) {
        toast({ title: "Invalid JSON", description: `Block “${b.key}” config must be a JSON object.`, variant: "destructive" });
        return null;
      }
      out.push({ key: b.key, type: b.type, config: cfg });
    }
    return out;
  }

  async function saveDraft(): Promise<boolean> {
    if (!activePageId) return false;
    const parsed = parseBlocks();
    if (!parsed) return false;
    setBusy(true);
    try {
      await api.savePage(activePageId, parsed, bindings);
      toast({ title: "Draft saved", description: `${parsed.length} block${parsed.length === 1 ? "" : "s"} · ${bindings.length} binding${bindings.length === 1 ? "" : "s"}.` });
      await load();
      return true;
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function bindForm() {
    if (!activePageId || !bindFormKey || !bindWfId) {
      toast({ title: "Pick a form and a workflow", variant: "destructive" });
      return;
    }
    const parsed = parseBlocks();
    if (!parsed) return;
    const next = [...bindings.filter((b) => b.formKey !== bindFormKey), { formKey: bindFormKey, workflowId: bindWfId }];
    setBusy(true);
    try {
      await api.savePage(activePageId, parsed, next);
      toast({ title: "Form bound", description: `“${bindFormKey}” now creates runs in ${workflowName.get(bindWfId) ?? "the workflow"}.` });
      setBindOpen(false);
      await load();
    } catch (e) {
      toast({ title: "Binding failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!activePageId) return;
    setBusy(true);
    try {
      const res = await api.publishPage(activePageId);
      toast({ title: "Page published", description: `Live and versioned as v${res.version}.` });
      setPublishConfirm(false);
      await load();
    } catch (e) {
      toast({
        title: "Publish blocked",
        description: e instanceof Error ? e.message : "The page could not be published.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!activePageId) return;
    setBusy(true);
    try {
      await api.unpublishPage(activePageId);
      toast({ title: "Page unpublished", description: "The public page is no longer reachable." });
      await load();
    } catch (e) {
      toast({ title: "Unpublish failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  /** Roll a page back onto an earlier immutable revision (a pointer move). */
  async function rollbackTo(revisionId: string) {
    if (!activePageId) return;
    setBusy(true);
    try {
      const res = await pageOps.rollback(activePageId, revisionId);
      toast({
        title: `Rolled back to v${res.version}`,
        description: res.published
          ? "The live page now serves this revision."
          : "The working draft now matches this revision; publish to make it live.",
      });
      await load();
    } catch (e) {
      toast({ title: "Rollback failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  /** Mint + copy a signed, expiring draft-preview link for a reviewer. */
  async function copyPreviewLink() {
    if (!activePageId) return;
    try {
      const res = await pageOps.previewLink(activePageId);
      const url = `${window.location.origin}${res.url}`;
      if (navigator.clipboard) await navigator.clipboard.writeText(url).catch(() => {});
      toast({ title: "Preview link copied", description: url });
    } catch (e) {
      toast({ title: "Preview unavailable", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  }

  async function submitTestForm() {
    if (!activePageId) return;
    if (!firstFormBlock) {
      toast({ title: "No form block", description: "Add a form block before submitting.", variant: "destructive" });
      return;
    }
    const cfg = safeParseObject(firstFormBlock.raw);
    const fields = cfg ? readFormFields(cfg) : [];
    const missing = fields.filter((f) => f.required && !(formData[f.key] ?? "").trim());
    if (missing.length > 0) {
      toast({ title: "Required fields missing", description: `Fill in: ${missing.map((m) => m.label).join(", ")}`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.submitPage(activePageId, { ...formData }, firstFormKey);
      toast({
        title: res.runId ? `Run ${shortId(res.runId)} started` : "Submission recorded",
        description: res.correlated
          ? "Correlated with the bound workflow — the run is now auditable."
          : "No workflow correlation — the form is not bound to a workflow yet.",
      });
      setFormData({});
      await load();
    } catch (e) {
      toast({ title: "Submit failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  function requestBack() {
    if (dirty) setLeaveConfirm(true);
    else setActivePage(null);
  }

  // ── drag overlay content ──

  const overlay = (() => {
    if (dndActive?.kind === "palette") {
      const meta = BLOCK_PALETTE.find((p) => p.type === dndActive.type);
      const Icon = meta?.icon ?? Plus;
      return (
        <div className="flex items-center gap-2 rounded-md border border-gold bg-card px-4 py-2.5 shadow-xl">
          <Icon className="h-4 w-4 text-gold-ink" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cobble-ink">
            Add {meta?.name ?? dndActive.type}
          </span>
        </div>
      );
    }
    if (dndActive?.kind === "block") {
      const idx = blocks.findIndex((b) => b.uid === dndActive.uid);
      const lb = idx >= 0 ? laneBlocks[idx] : null;
      if (!lb || invalidRaw.has(dndActive.uid)) return null;
      return (
        <div className="w-[min(42rem,86vw)] rotate-[0.5deg] bg-white px-5 py-4 shadow-[0_28px_60px_-24px_rgba(18,40,58,0.55)] ring-2 ring-gold">
          <BlockView block={lb} index={idx} />
        </div>
      );
    }
    return null;
  })();

  // ── zone renderers (shared between the desktop grid and the mobile tabs) ──

  function renderLeftColumn(sticky: boolean) {
    return (
      <div className={cn("space-y-5", sticky && "lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1")}>
        <Card className="gap-0 rounded-md border-border p-4">
          <Eyebrow>Components</Eyebrow>
          <h3 className="mt-1 font-editorial text-lg text-cobble-ink">Blocks</h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Drag onto the canvas — or click to append.
          </p>
          <div className="mt-4 space-y-2">
            {BLOCK_PALETTE.map((p) => (
              <PaletteCard key={p.type} type={p.type} name={p.name} hint={p.hint} icon={p.icon} onAdd={addFromPalette} />
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <MousePointerClick className="h-3 w-3" aria-hidden="true" />
            Publishing requires no form block — add one only if you want submissions to start a workflow.
          </p>
        </Card>

        <Card className="gap-0 rounded-md border-border p-4">
          <Eyebrow>Page structure</Eyebrow>
          <h3 className="mt-1 flex items-center gap-2 font-editorial text-lg text-cobble-ink">
            <Layers className="h-4 w-4 text-gold-ink" aria-hidden="true" /> Layers
          </h3>
          {blocks.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">No blocks yet.</p>
          ) : (
            <SortableContext items={blocks.map((b) => `layer:${b.uid}`)} strategy={verticalListSortingStrategy}>
              <div className="mt-3 max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {blocks.map((b, i) => (
                  <LayersRow
                    key={`layer-${b.uid}`}
                    block={b}
                    index={i}
                    count={blocks.length}
                    selected={selectedUid === b.uid}
                    onSelect={setSelectedUid}
                    onMove={moveBlock}
                    onRemove={removeBlock}
                  />
                ))}
              </div>
            </SortableContext>
          )}
        </Card>
      </div>
    );
  }

  function renderCanvasColumn() {
    const hasForm = blocks.some((b) => b.type === "form");
    return (
      <div className="min-w-0">
        {/* Canvas — framed preview of the real published look */}
        <div className="rounded-lg border border-border bg-cobble p-3 shadow-inner md:p-5">
          <div className="mx-auto w-full max-w-3xl">
            <div className="flex items-center gap-2 rounded-t-md bg-[#0E1B27] px-4 py-2.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-coral/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-brand/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-olive/80" />
              <span className="ml-2 truncate rounded-sm bg-white/10 px-2 py-0.5 font-mono text-[10px] text-[#B9C4CE]">
                citizen-lane.com/p/{page?.slug ?? "…"}
              </span>
            </div>
            <CanvasDropArea onDeselect={() => selectByKey("")}>
              {blocks.length === 0 ? (
                <div className="flex min-h-[20rem] flex-col items-center justify-center rounded-md border-2 border-dashed border-limestone px-6 text-center">
                  <MousePointerClick className="h-6 w-6 text-limestone-ink" aria-hidden="true" />
                  <p className="mt-3 font-editorial text-lg text-cobble-ink">Drag your first block here</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    — or pick one from the palette. A form block is optional; without one the page is editorial.
                  </p>
                </div>
              ) : (
                <SortableContext items={blocks.map((b) => b.uid)} strategy={verticalListSortingStrategy}>
                  <PageBlocksView
                    blocks={laneBlocks}
                    className="gap-3"
                    renderBlock={(lb, i) => (
                      <CanvasSortableBlock
                        key={blocks[i]?.uid ?? `${lb.key}-${i}`}
                        sortableId={blocks[i]?.uid ?? ""}
                        laneBlock={lb}
                        index={i}
                        selected={blocks[i]?.uid === selectedUid}
                        invalid={blocks[i] ? invalidRaw.has(blocks[i].uid) : false}
                        onSelectKey={selectByKey}
                      />
                    )}
                  />
                </SortableContext>
              )}
            </CanvasDropArea>
          </div>
        </div>

        {/* Test submission — kept from the old Preview tab */}
        <Card className="mt-5 gap-0 rounded-md border-border p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>Test submission</Eyebrow>
            {pageStatus === "PUBLISHED" && (
              <SandboxChip
                label={
                  bindings.length > 0 && staleBindings.length === bindings.length
                    ? "Submissions arrive but start no run — bindings are not live"
                    : "Submission creates an auditable workflow run"
                }
              />
            )}
          </div>
          {pageStatus === "PUBLISHED" ? (
            <>
              {firstFormFields.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {firstFormFields.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label htmlFor={`test-${f.key}`} className="text-xs text-iron-ink">
                        {f.label}
                        {f.required && <span className="ml-1 text-gold-ink" aria-hidden="true">*</span>}
                      </Label>
                      {f.type === "textarea" ? (
                        <Textarea
                          id={`test-${f.key}`}
                          rows={2}
                          value={formData[f.key] ?? ""}
                          onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                          className="min-h-11"
                        />
                      ) : (
                        <Input
                          id={`test-${f.key}`}
                          type={f.type === "email" ? "email" : f.type === "tel" ? "tel" : f.type === "date" ? "date" : "text"}
                          value={formData[f.key] ?? ""}
                          onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                          required={f.required}
                          className="h-11"
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">The first form block has no fields yet.</p>
              )}
              <Button
                className="mt-4 h-11 w-full sm:w-auto"
                disabled={submitting || !hasForm}
                onClick={() => void submitTestForm()}
              >
                {submitting ? <Spinner className="mr-2 h-3.5 w-3.5" /> : <Send className="mr-2 h-3.5 w-3.5" />}
                Submit test form
              </Button>
              {!hasForm && (
                <p className="mt-2 text-[11px] text-muted-foreground">Add a form block to enable submissions.</p>
              )}
            </>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Publish the page to enable test submissions.</p>
          )}
        </Card>
      </div>
    );
  }

  function renderRightPanel(sticky: boolean) {
    return (
      <div className={cn("space-y-5", sticky && "lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1")}>
        {selected ? (
          <BlockInspector
            key={selected.uid}
            block={selected}
            onRawChange={(raw) => updateBlockRaw(selected.uid, raw)}
            onDuplicate={() => duplicateBlock(selected.uid)}
            onDelete={() => removeBlock(selected.uid)}
            formKey={selected.type === "form" ? (safeParseObject(selected.raw) ? readStr(safeParseObject(selected.raw) as Record<string, unknown>, "formKey") : "") : ""}
            bindings={bindings}
            publishedWorkflows={publishedWorkflows}
            workflowName={workflowName}
            onSetBinding={setBindingFor}
          />
        ) : (
          <Card className="gap-0 rounded-md border-border p-4">
            <Eyebrow>Page</Eyebrow>
            <h3 className="mt-1 font-editorial text-lg text-cobble-ink">Nothing selected</h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Click a block on the canvas — or in Layers — to edit it here.
            </p>
            <div className="mt-4 border-t border-border/60 pt-4">
              <Eyebrow>Bindings</Eyebrow>
              <h4 className="mt-1 font-editorial text-base text-cobble-ink">Forms → workflows</h4>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                A bound form creates an auditable run in the linked workflow for every submission.
              </p>
              <div className="mt-3 space-y-2">
                {bindings.length === 0 && <p className="text-xs text-muted-foreground">No bindings yet.</p>}
                {bindings.map((b) => (
                  <div key={b.formKey} className="flex items-center justify-between gap-2 rounded border border-border/70 px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-cobble-ink">{b.formKey}</p>
                      <p className="truncate text-xs text-muted-foreground">→ {workflowName.get(b.workflowId) ?? shortId(b.workflowId)}</p>
                      {!staleBindings.some((s) => s.formKey === b.formKey) ? null : (
                        <p className="mt-1 text-[11px] text-amber-ink">
                          Not live — submissions will not start a run.
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="h-11 w-11 text-muted-foreground hover:text-danger-ink lg:h-7 lg:w-7"
                      aria-label={`Unbind form ${b.formKey}`}
                      onClick={() => { setBindings(bindings.filter((x) => x.formKey !== b.formKey)); touch(); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline" size="sm" className="mt-3 h-11 w-full lg:h-9"
                disabled={formKeys.length === 0 || publishedWorkflows.length === 0}
                onClick={() => { setBindFormKey(formKeys[0] ?? ""); setBindWfId(""); setBindOpen(true); }}
              >
                <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Bind form to workflow
              </Button>
              {formKeys.length === 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">Add a form block first.</p>
              )}
              {formKeys.length > 0 && publishedWorkflows.length === 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">No published workflows available to bind.</p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Unbinding only takes effect after “Save draft”.
              </p>
            </div>
          </Card>
        )}

        <AiRefineCard
          block={selected}
          onApply={(uid, config) => updateBlockRaw(uid, JSON.stringify(config, null, 2))}
        />

        {/* Checklist */}
        <Card className="gap-0 rounded-md border-border p-4">
          <Eyebrow>Checklist</Eyebrow>
          <ul className="mt-3 space-y-2 text-sm text-iron-ink">
            <li className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full", blocks.length > 0 ? "bg-olive" : "bg-muted-foreground/40")} />
              At least one block
            </li>
            <li className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full", formKeys.length > 0 ? "bg-olive" : "bg-muted-foreground/40")} />
              A form block (required to publish)
            </li>
            <li className="flex items-center gap-2">
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                bindings.length === 0
                  ? "bg-muted-foreground/40"
                  : staleBindings.length > 0
                    ? "bg-amber-brand/80"
                    : "bg-olive",
              )} />
              {bindings.length === 0
                ? "Form bound to a workflow"
                : staleBindings.length > 0
                  ? `${staleBindings.length} binding${staleBindings.length === 1 ? "" : "s"} not live`
                  : "Form bound to a live workflow"}
            </li>
            <li className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full", pageStatus === "PUBLISHED" ? "bg-olive" : "bg-muted-foreground/40")} />
              Published &amp; versioned
            </li>
          </ul>
        </Card>
      </div>
    );
  }

  // ── early exits ──

  if (!activePageId) {
    return (
      <PageShell>
        <div className="mb-8">
          <Eyebrow>Lane Pages</Eyebrow>
          <SectionTitle className="mt-1.5">Page editor</SectionTitle>
        </div>
        <EmptyState title="No page selected" hint="Pick a page from the list to build, preview and publish it." />
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => setActivePage(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to pages
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[88rem] px-4 py-6 md:px-6 md:py-8 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost" size="sm"
          className="mb-3 -ml-2 h-11 text-muted-foreground lg:h-9"
          onClick={requestBack}
          aria-label="Back to pages"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" /> All pages
        </Button>
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={() => void load()} /> : page && (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <Eyebrow>Lane Pages</Eyebrow>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <SectionTitle>{page.title}</SectionTitle>
                <StateBadge state={page.status} />
                <Badge variant="outline" className="text-[10px]">v{page.version}</Badge>
                {dirty && (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-ink">Unsaved changes</span>
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                <a
                  href={`/p/${page.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-gold-ink hover:underline"
                >
                  <Link2 className="h-3 w-3" aria-hidden="true" />/p/{page.slug}
                </a>
                <span aria-hidden="true">·</span>
                <span>owner {page.owner.name}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="h-11 lg:h-9" disabled={busy} onClick={() => void copyPreviewLink()}>
                <Eye className="mr-2 h-4 w-4" aria-hidden="true" /> Preview draft
              </Button>
              <Button variant="outline" className="h-11 lg:h-9" disabled={busy} onClick={() => void saveDraft()}>
                {busy ? <Spinner className="mr-2 h-3.5 w-3.5" /> : null} Save draft
              </Button>
              {page.status === "PUBLISHED" ? (
                <Button variant="outline" className="h-11 lg:h-9" disabled={busy} onClick={() => void unpublish()}>Unpublish</Button>
              ) : (
                <Button className="h-11 lg:h-9" disabled={busy} onClick={() => setPublishConfirm(true)}>
                  <Globe className="mr-2 h-4 w-4" aria-hidden="true" /> Publish
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {!loading && !error && page && (
        <Tabs defaultValue="builder">
          <TabsList>
            <TabsTrigger value="builder">Builder</TabsTrigger>
            <TabsTrigger value="submissions">Submissions ({submissions.length})</TabsTrigger>
            <TabsTrigger value="history">History ({revisions.length})</TabsTrigger>
          </TabsList>

          {/* ── Builder — three-zone WYSIWYG ── */}
          <TabsContent value="builder" className="mt-6">
            <BuilderDnd
              sensors={sensors}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
              overlay={overlay}
            >
              {isDesktop ? (
                <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)_21rem]">
                  {renderLeftColumn(true)}
                  {renderCanvasColumn()}
                  {renderRightPanel(true)}
                </div>
              ) : (
                /* Mobile — zones stack as tabs, click-to-add + arrow fallback for reordering */
                <Tabs defaultValue="canvas">
                  <TabsList className="grid h-11 w-full grid-cols-3">
                    <TabsTrigger value="blocks" className="h-11">Blocks</TabsTrigger>
                    <TabsTrigger value="canvas" className="h-11">Canvas</TabsTrigger>
                    <TabsTrigger value="inspector" className="h-11">Inspector</TabsTrigger>
                  </TabsList>
                  <TabsContent value="blocks" className="mt-4">{renderLeftColumn(false)}</TabsContent>
                  <TabsContent value="canvas" className="mt-4">{renderCanvasColumn()}</TabsContent>
                  <TabsContent value="inspector" className="mt-4">{renderRightPanel(false)}</TabsContent>
                </Tabs>
              )}
            </BuilderDnd>
          </TabsContent>

          {/* ── Submissions ── */}
          <TabsContent value="submissions" className="mt-6">
            <Card className="gap-0 rounded-md border-border p-0">
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-32">Time</TableHead>
                      <TableHead className="w-28">Data</TableHead>
                      <TableHead className="w-32">Run</TableHead>
                      <TableHead className="w-40">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submissions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                          No submissions yet — share the page or submit a test form.
                        </TableCell>
                      </TableRow>
                    )}
                    {submissions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(s.createdAt)}</TableCell>
                        <TableCell>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-9 px-2 text-xs lg:h-7" aria-label="View submission data">
                                View data
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 max-h-72 overflow-y-auto" align="start">
                              {s.redacted && (
                                <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                                  Raw payload redacted — your role may not read submission PII.
                                </p>
                              )}
                              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-iron-ink">
                                {prettyJson(s.data)}
                              </pre>
                            </PopoverContent>
                          </Popover>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-cobble-ink">
                          {s.runId ? shortId(s.runId) : "—"}
                        </TableCell>
                        <TableCell><StateBadge state={s.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          {/* ── History — immutable revisions + rollback ── */}
          <TabsContent value="history" className="mt-6">
            <Card className="gap-0 rounded-md border-border p-5">
              <Eyebrow>Revision history</Eyebrow>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Every save snapshots an immutable revision. Publishing moves the live pointer onto the current
                revision; rolling back moves it again — nothing is ever overwritten.
              </p>
              {revisions.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No revisions yet — press “Save draft” to snapshot the first one.
                </p>
              ) : (
                <div className="mt-4 max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-20">Version</TableHead>
                        <TableHead className="w-40">Saved</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="w-36">By</TableHead>
                        <TableHead className="w-32 text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revisions.map((rev) => (
                        <TableRow key={rev.id}>
                          <TableCell className="font-mono text-xs text-cobble-ink">v{rev.version}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(rev.createdAt)}</TableCell>
                          <TableCell className="text-sm text-iron-ink">{rev.note ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{rev.authorLabel ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 px-2 text-xs lg:h-7"
                              disabled={busy}
                              onClick={() => void rollbackTo(rev.id)}
                            >
                              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Roll back
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Bind form dialog — kept from the page overview */}
      <Dialog open={bindOpen} onOpenChange={setBindOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bind form to workflow</DialogTitle>
            <DialogDescription>
              Every submission of this form will start an auditable run in the chosen published workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bind-form">Form</Label>
              <Select value={bindFormKey} onValueChange={setBindFormKey}>
                <SelectTrigger id="bind-form" className="h-11 w-full lg:h-9" aria-label="Form"><SelectValue placeholder="Choose a form" /></SelectTrigger>
                <SelectContent>
                  {formKeys.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bind-workflow">Published workflow</Label>
              <Select value={bindWfId} onValueChange={setBindWfId}>
                <SelectTrigger id="bind-workflow" className="h-11 w-full lg:h-9" aria-label="Workflow"><SelectValue placeholder="Choose a workflow" /></SelectTrigger>
                <SelectContent>
                  {(workflowsApi.data?.workflows ?? [])
                    .filter((w) => w.status === "PUBLISHED" && !w.disabled)
                    .map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindOpen(false)}>Cancel</Button>
            <Button disabled={busy || !bindFormKey || !bindWfId} onClick={() => void bindForm()}>
              {busy && <Spinner className="mr-2 h-3.5 w-3.5" />} Save binding
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish confirm */}
      <AlertDialog open={publishConfirm} onOpenChange={setPublishConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish “{page?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Publishing promotes the current revision to the live page. Visitors can read it immediately and, where a
              form block is bound, submit it.
            </AlertDialogDescription>
            {!hasForm && (
              <p className="mt-3 rounded border border-border bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                This page has no form block — it will publish as an editorial article. Readers still see a general
                enquiry form, but no workflow will start from it.
              </p>
            )}
            {staleBindings.length > 0 && (
              <p className="mt-3 rounded border border-amber-brand/40 bg-amber-brand/5 px-2.5 py-1.5 text-[11px] text-amber-ink">
                {staleBindings.length} binding{staleBindings.length === 1 ? "" : "s"} point
                {staleBindings.length === 1 ? "s" : ""} at a workflow that is no longer live — bound forms will accept
                submissions but start no run: {staleBindings.map((b) => b.formKey).join(", ")}.
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void publish(); }}>
              Publish page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved-changes guard */}
      <AlertDialog open={leaveConfirm} onOpenChange={setLeaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave with unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits to “{page?.title ?? "this page"}” are not saved yet — leaving now will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-[#FAF8F4] hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); setLeaveConfirm(false); setActivePage(null); }}
            >
              Discard changes
            </AlertDialogAction>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setLeaveConfirm(false);
                void saveDraft().then((ok) => { if (ok) setActivePage(null); });
              }}
            >
              Save &amp; leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function prettyJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}
