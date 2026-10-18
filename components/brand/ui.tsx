"use client";
/** Shared brand-aware UI primitives used across every console. */
import { AlertCircle, CheckCircle2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND, PassportSeal, SloganRing } from "@/components/brand/devices";

/* ── Skeleton primitives ──────────────────────────────────────────────
   A skeleton is a promise of content: it mirrors the shape of what is
   loading so the layout never jumps when data arrives. The shimmer is a
   slow gold sweep — the same device as the loader, so a loading surface
   reads as the brand, not as a generic grey pulse. */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton skeleton-text", className)} />;
}

export function SkeletonCircle({ className, size = "h-10 w-10" }: { className?: string; size?: string }) {
  return <div className={cn("skeleton skeleton-circle", size, className)} />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("skeleton skeleton-card p-6", className)}>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-5/6" />
      <Skeleton className="mt-2 h-3 w-2/3" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-4 flex-1" />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={`r-${r}`} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={`r-${r}-c-${c}`} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ items = 3 }: { items?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <SkeletonCircle size="h-10 w-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Section title. Renders an `<h2>` by default — the correct level for a titled
 * block inside a page. A PAGE-LEVEL title may opt into `as="h1"` so a screen
 * with no other h1 (RM Queue, Admin Overview) still exposes exactly one
 * top-level heading. The visual styling is identical either way (the `type-h2`
 * skin), so switching the level never changes the look.
 */
export function SectionTitle({
  children,
  className,
  as,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2";
}) {
  const Tag: React.ElementType = as ?? "h2";
  return (
    <Tag className={cn("font-editorial type-h2 text-cobble-ink brand-rule-gold", className)}>
      {children}
    </Tag>
  );
}

/**
 * The uppercase letter-spaced eyebrow. One definition (`.eyebrow`) drives the
 * tracking everywhere; `tone` only switches the ink so the same rhythm works on
 * cream and on cobble.
 */
export function Eyebrow({
  children,
  className,
  tone = "gold",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "gold" | "iron" | "cream";
}) {
  return (
    <p
      className={cn(
        "eyebrow",
        tone === "gold" && "text-gold-ink",
        tone === "iron" && "text-iron-ink",
        tone === "cream" && "text-[#F5F1EA]/80",
        className,
      )}
    >
      {children}
    </p>
  );
}

const TONES: Record<string, string> = {
  // calm status tones — secondary palette, used sparingly
  neutral: "bg-muted text-iron-ink border-border",
  gold: "bg-gold/15 text-amber-ink border-gold/40",
  sky: "bg-sky/20 text-[#3d6285] border-sky/50",
  green: "bg-olive/15 text-olive-ink border-olive/40",
  red: "bg-coral/20 text-danger-ink border-coral/50",
  amber: "bg-amber-brand/15 text-amber-ink border-amber-brand/40",
  teal: "bg-teal/15 text-[#0e7c86] border-teal/40",
  cobble: "bg-cobble text-[#F5F1EA] border-cobble",
};

export function StatusBadge({ status, tone, className }: { status: string; tone?: keyof typeof TONES; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap",
        TONES[tone ?? "neutral"],
        className
      )}
    >
      {status}
    </span>
  );
}

const STATE_TONES: Record<string, keyof typeof TONES> = {
  ONBOARDING: "sky",
  DATA_SUBMITTED: "amber",
  DATA_APPROVED: "green",
  SERVICE_SELECTED: "amber",
  SERVICE_APPROVED: "green",
  DOCS_REQUESTED: "sky",
  IN_PROGRESS: "sky",
  DISPATCHED: "teal",
  FOLLOW_UP: "amber",
  APPROVED_IN_PRINCIPLE: "green",
  COMPLETED: "cobble",
  CANCELLED: "red",
  // document states
  UPLOADED: "neutral",
  OCR_PROCESSING: "amber",
  OCR_PROCESSED: "amber",
  CLIENT_CONFIRMED: "sky",
  IN_REVIEW: "amber",
  RM_APPROVED: "green",
  RM_REJECTED: "red",
  CHANGES_REQUESTED: "red",
  // run states
  RUNNING: "amber",
  WAITING_APPROVAL: "amber",
  SUCCEEDED: "green",
  FAILED: "red",
  // generic
  DRAFT: "neutral",
  PUBLISHED: "green",
  UNPUBLISHED: "neutral",
  DISABLED: "red",
  OPEN: "amber",
  FULFILLED: "green",
  APPROVED: "green",
  REJECTED: "red",
  REQUEST_CHANGES: "red",
  DELIVERED: "green",
  PENDING: "amber",
  ACTIVE: "green",
  INVITED: "amber",
  DEACTIVATED: "red",
  DEAD_LETTER: "red",
  QUEUED: "amber",
};

export function StateBadge({ state, label, className }: { state: string | null | undefined; label?: string; className?: string }) {
  if (!state) return <span className="text-muted-foreground text-xs">—</span>;
  // `label` lets the caller show the human, translated status ("Approved",
  // "Reading your document") instead of the raw enum. Without it the badge
  // title-cases the value, which leaks internal vocabulary: "RM_APPROVED"
  // renders as "Rm Approved" — an internal role acronym printed on an
  // applicant's own passport. Pass `label` on every client-facing surface; the
  // fallback is only for values that have no plain-language name.
  const resolved = label ?? state.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return <StatusBadge status={resolved} tone={STATE_TONES[state] ?? "neutral"} className={className} />;
}

/**
 * EmptyState — a designed quiet moment, not a raw "no data" box. The rotating
 * slogan ring is the same device the loader uses, so an empty surface reads as
 * an intentional phase of the brand rather than a failure. Optional `action`
 * lets a caller offer the one thing the visitor should do next.
 */
export function EmptyState({
  title,
  hint,
  action,
  className,
  icon,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col items-center justify-center overflow-hidden border border-dashed border-limestone bg-card/50 px-6 py-14 text-center",
        className,
      )}
    >
      {/* Gold hairline that warms to full gold on hover — the same rule that
          opens a printed section, drawn here as the frame of the empty state. */}
      <span aria-hidden="true" className="gold-hairline-top pointer-events-none absolute inset-x-0 top-0" />
      {icon ? (
        <div className="seal-drift-hover">{icon}</div>
      ) : (
        <SloganRing size={58} color="#D6C0A2" speed={64} className="seal-drift-hover" />
      )}
      <p className="mt-5 font-editorial type-h3 text-cobble-ink">{title}</p>
      {hint && <p className="measure-tight mt-2 text-sm leading-relaxed text-muted-foreground">{hint}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/**
 * ErrorState — the designed counterpart to EmptyState. Never a raw stack or a
 * bare sentence: an eyebrow, a serif line, the detail, and a remedy action,
 * set on a soft coral wash so it reads as a considered notice.
 */
export function ErrorState({
  title,
  detail,
  action,
  className,
  onRetry,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
  className?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "relative border border-coral/40 bg-coral/[0.06] px-6 py-8 text-left",
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[2px] bg-coral" />
      <p className="eyebrow text-danger-ink">{title}</p>
      {detail && <p className="measure-tight mt-2 text-sm leading-relaxed text-iron-ink">{detail}</p>}
      {(action || onRetry) && (
        <div className="mt-5 flex items-center gap-3">
          {action}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="btn-press inline-flex items-center gap-2 rounded border border-coral/40 bg-card px-4 py-2 text-sm font-medium text-danger-ink transition-colors hover:bg-coral/10"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 80 ? "bg-olive" : pct >= 55 ? "bg-gold" : "bg-coral";
  return (
    <div className="flex items-center gap-2" title={`Extraction confidence: ${pct}%`}>
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  );
}

/**
 * Client-facing extraction signal. A raw percentage ("74%") reads as a grade
 * to an anxious applicant uploading a passport — it creates doubt without an
 * action. This keeps the colour signal but speaks in outcomes: fields below
 * the review threshold say "worth a check", which is exactly what the confirm
 * step asks them to do. Staff keep the numeric ConfidenceBar.
 */
export function ExtractionQuality({ value, threshold = 0.55 }: { value: number; threshold?: number }) {
  const ok = value >= threshold;
  const tone = value >= 0.8 ? "bg-olive" : ok ? "bg-gold" : "bg-coral";
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2" title={`Extraction quality: ${ok ? "looks good" : "worth a check"} (${pct}% internal score)`}>
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-semibold text-muted-foreground">{ok ? "Looks good" : "Worth a check"}</span>
    </div>
  );
}

export function SandboxChip({ label = "Sandbox adapter" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-ink" title="Deterministic sandbox provider — no live external system was contacted">
      {label}
    </span>
  );
}

export function ProvisionalChip() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-amber-brand/50 bg-amber-brand/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-ink"
      title="AI-generated result — provisional until a human confirms it"
    >
      AI · Provisional
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent", className)}
    />
  );
}

/**
 * ProgressBar — a refined progress indicator with a gold shimmer.
 * Used for file uploads, multi-step processes, and any determinate progress.
 */
export function ProgressBar({
  value,
  className,
  tone = "gold",
}: {
  value: number;
  className?: string;
  tone?: "gold" | "olive" | "coral";
}) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));
  const tones = {
    gold: "bg-gold",
    olive: "bg-olive",
    coral: "bg-coral",
  };
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-500", tones[tone])}
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

/**
 * LiveDot — a pulsing dot for real-time indicators.
 * Used for "online" status, live counters, and active processes.
 * Decorative by design: always pair it with visible status text (or use
 * StatusIndicator) — screen readers skip the dot itself.
 */
export function LiveDot({ className, tone = "olive" }: { className?: string; tone?: "olive" | "gold" | "coral" }) {
  const tones = {
    olive: "bg-olive",
    gold: "bg-gold",
    coral: "bg-coral",
  };
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)} aria-hidden="true">
      <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-75", tones[tone])} />
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", tones[tone])} />
    </span>
  );
}

/** Below this the slogan ring stops being legible, so the loader degrades. */
const FULL_DETAIL_SIZE = 64;

/**
 * BrandLoader — the canonical loading device: the "LET'S CREATE TOMORROW" stamp
 * turning as a ring around the breathing seal.
 *
 * Size-adaptive, following the same rule as the seal itself: the full device
 * needs room to read, so below `FULL_DETAIL_SIZE` it falls back to the plain
 * gold arc. Use it for surface and block loading states (view transitions,
 * boot, console panels); inline spinners sitting next to a text label stay
 * `Spinner`, where a 12–20px ring would only be visual noise.
 *
 * The ring is decorative — the accessible name is the sr-only status text, and
 * `prefers-reduced-motion` stops both animations.
 */
export function BrandLoader({
  size = 96,
  label = "Loading",
  className,
}: {
  size?: number;
  /** Announced to assistive tech — pass a localised string where one exists. */
  label?: string;
  className?: string;
}) {
  if (size < FULL_DETAIL_SIZE) return <Spinner className={cn("h-5 w-5", className)} />;
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("relative inline-flex items-center justify-center", className)}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      {/* The ring turns as a PROMOTED HTML LAYER, not by animating the SVG
          `<g>`: transforming live `<textPath>` glyphs forces the browser to
          re-rasterise the type every frame, and this loader runs precisely
          during route transitions where that jank is most visible. With
          `will-change: transform` the ring is rasterised once and the
          compositor rotates the bitmap — same motion, none of the repaint. */}
      <span aria-hidden="true" className="ring-spin-layer" style={{ animationDuration: "7s" }}>
        <SloganRing size={size} color={BRAND.gold} animated={false} />
      </span>
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        <PassportSeal size={Math.round(size * 0.44)} className="seal-pulse" />
      </span>
    </span>
  );
}

/**
 * SurfaceLoader — the full-viewport loading state for a whole route or app
 * segment. One definition shared by the Suspense boundary (page.tsx) and the
 * route loader (loading.tsx), so a first paint and a route transition show the
 * SAME device at the same size. The centring lives on this wrapper (not on
 * BrandLoader's own `inline-flex`), so a parent flex row can never stretch it.
 */
export function SurfaceLoader({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        "min-h-screen flex items-center justify-center bg-background",
        className,
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <BrandLoader size={96} label={label} />
    </div>
  );
}

/**
 * MutationStatus — a concise status indicator for a mutation lifecycle.
 *
 * Shows a spinner while pending, a checkmark on success, or an error message
 * on failure. Optionally renders a progress bar when progress is provided.
 *
 * @example
 * const { status, error, progress, run } = useMutationStatus();
 * <MutationStatus status={status} error={error} progress={progress} label="Generating letter" />
 */
export function MutationStatus({
  status,
  error,
  progress,
  label,
  className,
}: {
  status: "idle" | "pending" | "success" | "error";
  error?: string | null;
  progress?: number | null;
  label?: string;
  className?: string;
}) {
  if (status === "idle") return null;

  return (
      <div className={cn("flex items-center gap-2 text-sm", className)}>
        {status === "pending" && (() => {
          const p = progress != null ? progress : 0;
          return (
            <>
              <Spinner className="h-4 w-4" />
              <span className="text-iron-ink">{label ?? "Working…"}</span>
              {progress != null && <ProgressBar value={p} className="w-32" />}
            </>
          );
        })()}
      {status === "success" && (
        <>
          <CheckCircle2 className="h-4 w-4 text-olive" />
          <span className="text-olive-ink">{label ?? "Done"}</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-4 w-4 text-coral" />
          <span className="text-danger-ink">{error ?? "Error"}</span>
        </>
      )}
    </div>
  );
}
