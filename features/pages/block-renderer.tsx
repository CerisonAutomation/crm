"use client";
/**
 * Shared block renderer — the single source of truth for how a Lane Page block
 * looks when published. Used by BOTH:
 *  - the public journal reader (pages-explorer.tsx) — the real published look;
 *  - the Lane Pages builder canvas (lane-pages.tsx) — WYSIWYG preview with
 *    interactive selection, click-to-select and drag-handle support.
 *
 * Brand editorial: font-editorial serif headings, cobble/gold palette,
 * limestone rules — kept in one place so the journal and the canvas can never
 * drift apart.
 */
import { createContext, useContext, Fragment } from "react";
import type { LaneBlock } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowRight, Check, CircleCheck, Info, TriangleAlert } from "lucide-react";

// ─────────────────────────────────────────────────────────── config helpers

export type FormField = { key: string; label: string; type: string; required: boolean };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Read a string value from a block config (missing/invalid → ""). */
export function readStr(config: Record<string, unknown>, k: string): string {
  const v: unknown = config[k];
  return typeof v === "string" ? v : "";
}

/** Strict field reader — entries without a usable key are dropped (submit-safe). */
export function readFormFields(config: Record<string, unknown>): FormField[] {
  const raw: unknown = config.fields;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f): FormField | null => {
      if (!isRecord(f)) return null;
      if (typeof f.key !== "string" || !f.key) return null;
      return {
        key: f.key,
        label: typeof f.label === "string" ? f.label : f.key,
        type: typeof f.type === "string" ? f.type : "text",
        required: f.required === true,
      };
    })
    .filter((f): f is FormField => f !== null);
}

/** Generic list reader for composite blocks (faq/checklist/cards) — malformed entries dropped. */
export function readItems<T>(config: Record<string, unknown>, pick: (r: Record<string, unknown>) => T | null): T[] {
  const raw: unknown = config.items;
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => (isRecord(it) ? pick(it) : null)).filter((v): v is T => v !== null);
}

function readPair(r: Record<string, unknown>, a: string, b: string): { a: string; b: string } | null {
  const x = r[a];
  const y = r[b];
  if (typeof x !== "string" || typeof y !== "string" || (!x && !y)) return null;
  return { a: x, b: y };
}

// ─────────────────────────────────────────────── builder canvas interactivity

export type BlockCanvasValue = {
  /** key of the currently selected block (or null) */
  selectedKey: string | null;
  /** called with a block key when the block is clicked */
  onSelect: (key: string) => void;
};

const BlockCanvasContext = createContext<BlockCanvasValue | null>(null);

export function BlockCanvasProvider({ value, children }: { value: BlockCanvasValue; children: React.ReactNode }) {
  return <BlockCanvasContext.Provider value={value}>{children}</BlockCanvasContext.Provider>;
}

function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ────────────────────────────────────────────────────────────── block views

/** Placeholder copy for empty fields — visible only while editing on the canvas. */
const FORM_PLACEHOLDER: Record<string, string> = {
  email: "name@example.com",
  tel: "+41 44 000 00 00",
  date: "dd.mm.yyyy",
  select: "Choose one…",
};

function HeroView({ cfg }: { cfg: Record<string, unknown> }) {
  const eyebrow = readStr(cfg, "eyebrow");
  const headline = readStr(cfg, "headline");
  const subline = readStr(cfg, "subline");
  const ctaLabel = readStr(cfg, "ctaLabel");
  return (
    <header>
      {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">{eyebrow}</p>}
      <h1
        className={cn(
          "font-editorial text-4xl leading-[1.1] text-cobble-ink text-balance md:text-5xl",
          eyebrow && "mt-3",
        )}
      >
        {headline || <span className="text-muted-foreground/60">Untitled hero</span>}
      </h1>
      {subline && <p className="mt-6 text-lg leading-relaxed text-iron-ink md:text-xl">{subline}</p>}
      {ctaLabel && (
        <span
          aria-hidden="true"
          className="mt-6 inline-flex h-10 items-center rounded-none border border-cobble bg-transparent px-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cobble-ink"
        >
          {ctaLabel}
        </span>
      )}
      <div className="mt-10 h-[2px] w-24 bg-gold" aria-hidden="true" />
    </header>
  );
}

function TextView({ cfg }: { cfg: Record<string, unknown> }) {
  const title = readStr(cfg, "title");
  const body = readStr(cfg, "body");
  const paras = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return (
    <section>
      {title && <h2 className="font-editorial text-2xl leading-snug text-cobble-ink">{title}</h2>}
      {paras.length === 0 ? (
        <p className={cn("text-xs text-muted-foreground", title && "mt-3")}>
          Empty text block — add body copy in the inspector.
        </p>
      ) : (
        <div className={cn("space-y-3", title && "mt-3")}>
          {paras.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-iron-ink">{p}</p>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Published-look form preview — field shells are decorative (the real page
 * renders live inputs; the builder collects test submissions separately).
 */
function FormView({ cfg }: { cfg: Record<string, unknown> }) {
  const title = readStr(cfg, "title") || "Enquiry form";
  const fields = readFormFields(cfg);
  return (
    <section>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-ink">Form</p>
      <h2 className="mt-1 font-editorial text-xl leading-snug text-cobble-ink">{title}</h2>
      <div className="mt-4 space-y-3.5">
        {fields.length === 0 && <p className="text-xs text-muted-foreground">No fields yet — add them in the inspector.</p>}
        {fields.map((f, fi) => (
          <div key={f.key || `field-${fi}`} className="space-y-1.5">
            <p className="text-xs text-iron-ink">
              {f.label || f.key}
              {f.required && <span className="ml-1 text-gold-ink" aria-hidden="true">*</span>}
            </p>
            {f.type === "textarea" ? (
              <div aria-hidden="true" className="h-16 rounded-md border border-input bg-background/70" />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-9 items-center rounded-md border border-input bg-background/70 px-3 text-[11px] text-muted-foreground/50"
              >
                {FORM_PLACEHOLDER[f.type] ?? ""}
              </div>
            )}
          </div>
        ))}
      </div>
      <span
        aria-hidden="true"
        className="mt-5 inline-flex h-10 items-center rounded-md bg-cobble px-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#F5F1EA]"
      >
        Submit
      </span>
    </section>
  );
}

function QuoteView({ cfg }: { cfg: Record<string, unknown> }) {
  const text = readStr(cfg, "text");
  const attribution = readStr(cfg, "attribution");
  if (!text && !attribution) {
    return <p className="text-xs text-muted-foreground">Empty quote — add text in the inspector.</p>;
  }
  return (
    <blockquote className="border-l-2 border-gold pl-5">
      <p className="font-editorial text-lg italic leading-relaxed text-cobble-ink">&ldquo;{text}&rdquo;</p>
      {attribution && <footer className="mt-1.5 text-xs text-muted-foreground">— {attribution}</footer>}
    </blockquote>
  );
}

function FooterView({ cfg }: { cfg: Record<string, unknown> }) {
  const note = readStr(cfg, "note");
  return (
    <footer className="border-t border-border/70 pt-4 text-center text-[11px] tracking-wide text-muted-foreground">
      {note || <span className="text-muted-foreground/60">Empty footer block</span>}
    </footer>
  );
}

// ── Ported 2026-10-06 (rest) from the 4.8GB chunk views — adapted to cfg
// records + this file's brand classes. Static content blocks: no JS behavior
// beyond the accordion, so journal and canvas stay identical.

function FaqView({ cfg }: { cfg: Record<string, unknown> }) {
  const title = readStr(cfg, "title");
  const items = readItems(cfg, (r) => readPair(r, "q", "a"));
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Empty FAQ — add questions in the inspector.</p>;
  }
  return (
    <section>
      {title && <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-gold-ink">{title}</p>}
      <Accordion type="single" collapsible className="rounded-xl border border-border bg-card px-4">
        {items.map((f, i) => (
          <AccordionItem key={i} value={`faq-${i}`}>
            <AccordionTrigger className="py-3.5 text-sm font-semibold text-cobble-ink hover:no-underline">{f.a}</AccordionTrigger>
            <AccordionContent className="text-[13px] leading-relaxed text-iron-ink/80">{f.b}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function ChecklistView({ cfg }: { cfg: Record<string, unknown> }) {
  const title = readStr(cfg, "title");
  const items = readItems(cfg, (r) => (typeof r.text === "string" && r.text ? { text: r.text } : null));
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Empty checklist — add items in the inspector.</p>;
  }
  return (
    <section>
      {title && <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.15em] text-gold-ink">{title}</p>}
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-cobble-ink">
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-gold/60 bg-gold/15">
              <Check className="h-3 w-3 text-gold-ink" />
            </span>
            <span className="leading-snug">{it.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const NOTE_TONES = {
  info: { box: "border-sky-300 bg-sky-50 text-cobble-ink", Icon: Info },
  warn: { box: "border-gold/50 bg-gold/10 text-cobble-ink", Icon: TriangleAlert },
  success: { box: "border-emerald-300 bg-emerald-50 text-cobble-ink", Icon: CircleCheck },
} as const;

function NoteView({ cfg }: { cfg: Record<string, unknown> }) {
  const text = readStr(cfg, "text");
  const tone = readStr(cfg, "tone") as keyof typeof NOTE_TONES;
  const t = NOTE_TONES[tone] ?? NOTE_TONES.warn;
  if (!text) return <p className="text-xs text-muted-foreground">Empty note — add text in the inspector.</p>;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-md border p-3.5 leading-relaxed", t.box)}>
      <t.Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="whitespace-pre-line text-[13px] font-medium">{text}</p>
    </div>
  );
}

function DividerView({ cfg }: { cfg: Record<string, unknown> }) {
  const label = readStr(cfg, "label");
  return (
    <div className="flex items-center gap-3" aria-hidden={label ? undefined : true}>
      <div className="h-px flex-1 bg-gold/50" />
      {label && (
        <span className="text-[9.5px] font-bold uppercase tracking-[0.25em] text-gold-ink">{label}</span>
      )}
      <div className="h-px flex-1 bg-gold/50" />
    </div>
  );
}

function CtaView({ cfg }: { cfg: Record<string, unknown> }) {
  const text = readStr(cfg, "text");
  const sub = readStr(cfg, "sub");
  const buttonLabel = readStr(cfg, "buttonLabel");
  const gold = readStr(cfg, "tone") === "gold";
  if (!text && !buttonLabel) {
    return <p className="text-xs text-muted-foreground">Empty CTA — add text in the inspector.</p>;
  }
  return (
    <div className={cn("flex flex-col justify-between gap-4 rounded-xl p-6 sm:flex-row sm:items-center sm:p-8", gold ? "bg-gold text-white" : "bg-cobble text-white")}>
      <div>
        <p className="font-editorial text-xl">{text}</p>
        {sub && <p className={cn("mt-1 text-[13px]", gold ? "text-white/85" : "text-white/70")}>{sub}</p>}
      </div>
      {buttonLabel && (
        <span className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-5 text-sm font-bold", gold ? "bg-white text-cobble-ink" : "bg-gold text-white")}>
          {buttonLabel} <ArrowRight className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

function CardsView({ cfg }: { cfg: Record<string, unknown> }) {
  const title = readStr(cfg, "title");
  const items = readItems(cfg, (r) => readPair(r, "title", "body"));
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Empty cards — add cards in the inspector.</p>;
  }
  return (
    <section>
      {title && <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-gold-ink">{title}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((c, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-cobble-ink">{c.a}</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-iron-ink/70">{c.b}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function renderBlockContent(type: string, cfg: Record<string, unknown>) {
  switch (type) {
    case "hero": return <HeroView cfg={cfg} />;
    case "text": return <TextView cfg={cfg} />;
    case "form": return <FormView cfg={cfg} />;
    case "quote": return <QuoteView cfg={cfg} />;
    case "footer": return <FooterView cfg={cfg} />;
    case "faq": return <FaqView cfg={cfg} />;
    case "checklist": return <ChecklistView cfg={cfg} />;
    case "note": return <NoteView cfg={cfg} />;
    case "divider": return <DividerView cfg={cfg} />;
    case "cta": return <CtaView cfg={cfg} />;
    case "cards": return <CardsView cfg={cfg} />;
    default:
      return (
        <div className="rounded border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          Unknown block type &ldquo;{type}&rdquo;.
        </div>
      );
  }
}

// ───────────────────────────────────────────────────────── public components

/**
 * Render ONE Lane Page block in the published editorial look.
 * `interactive` (builder canvas only) adds click-to-select, a gold selection
 * ring and a hover type chip. The drag handle itself is rendered by the
 * builder's sortable shell (which owns the dnd-kit listeners) on top of the
 * same box. Selection state travels through the provider, so the journal
 * renders the exact same markup without it.
 */
export function BlockView({
  block,
  index,
  interactive = false,
}: {
  block: LaneBlock;
  index?: number;
  interactive?: boolean;
}) {
  const cfg = isRecord(block.config) ? block.config : {};
  const canvas = useContext(BlockCanvasContext);
  const selectable = interactive && canvas !== null;
  const inner = renderBlockContent(block.type, cfg);

  // Published look (journal) — plain editorial markup.
  if (!selectable) {
    return (
      <div data-block-key={block.key}>
        {inner}
      </div>
    );
  }

  const selected = canvas?.selectedKey === block.key;
  const label = typeLabel(block.type);
  const nn = String((index ?? 0) + 1).padStart(2, "0");

  return (
    <div
      data-block-key={block.key}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${label} block ${nn} — click to select`}
      onClick={(e) => { e.stopPropagation(); canvas?.onSelect(block.key); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          canvas?.onSelect(block.key);
        }
      }}
      className={cn(
        "group/bk relative cursor-pointer rounded-sm px-4 py-4 outline-none transition-shadow duration-150 md:px-5",
        selected ? "ring-2 ring-gold" : "hover:ring-1 hover:ring-gold/50",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute -top-2.5 left-3 z-10 rounded-sm bg-cobble px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[#F5F1EA] transition-opacity duration-150",
          selected ? "opacity-100" : "opacity-0 group-hover/bk:opacity-100",
        )}
      >
        {label} · {nn}
      </span>
      {inner}
    </div>
  );
}

/**
 * Render a full page of blocks in order — the real published look. The builder
 * canvas passes `renderBlock` to wrap each block in its sortable shell; the
 * journal reader uses the default rendering as-is.
 */
export function PageBlocksView({
  blocks,
  className,
  renderBlock,
}: {
  blocks: LaneBlock[];
  className?: string;
  renderBlock?: (block: LaneBlock, index: number) => React.ReactNode;
}) {
  if (blocks.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-10", className)}>
      {blocks.map((b, i) =>
        renderBlock ? (
          <Fragment key={`${b.key}-${i}`}>{renderBlock(b, i)}</Fragment>
        ) : (
          <BlockView key={`${b.key}-${i}`} block={b} index={i} />
        ),
      )}
    </div>
  );
}
