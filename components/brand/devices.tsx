"use client";

/**
 * Citizen Lane brand devices — faithful to the "Visual Language v2" brand book
 * (upload/Citizen Lane - Visual Language - v2.pdf):
 *
 * - PassportSeal:    the OFFICIAL lattice mark (square frame + rotated diamonds
 *                    + serif L), vector-traced 1:1 from the PDF at 400 DPI —
 *                    see seal-paths.ts, no font needed
 * - Wordmark:        CITIZEN LANE in Mincho-class serif; tagline prints in
 *                    SKY BLUE on light surfaces, GOLD on dark surfaces (p.15)
 * - BrandLockup:     mark above wordmark, as on the PDF cover
 * - SloganRing:      circular "LET'S CREATE TOMORROW" stamp device (p.20/21)
 * - LatticePattern:  the graphic device (p.19) as a seamless background
 */
import { useId } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useBrand } from "@/lib/brand/client";
import { CANON_BRAND } from "@/lib/brand/defaults";
import { MARK_D, MARK_VIEWBOX, TILE_D, TILE_VIEWBOX } from "@/components/brand/seal-paths";

// Palette sourced from the canon (src/lib/brand/defaults.ts) — the only home
// of canonical hexes in code. Keep these keys: call sites depend on them.
export const BRAND = {
  gold: CANON_BRAND.tokens.gold,
  sky: CANON_BRAND.tokens.sky,
  iron: CANON_BRAND.tokens.iron,
  limestone: CANON_BRAND.tokens.limestone,
  cobble: CANON_BRAND.tokens.cobble,
  paper: CANON_BRAND.tokens.paper,
} as const;

/**
 * Mix a hex colour toward white (amount > 0) or black (amount < 0), so the
 * mark's metal can be derived from ONE brand colour instead of a second
 * hand-maintained palette. A non-hex input (a named or rgb() colour supplied
 * through settings) returns unchanged, and the mark falls back to a flat fill
 * rather than guessing.
 */
function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const to = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k));
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function PassportSeal({
  size = 48,
  color,
  className,
  title = "Citizen Lane seal",
  animated = false,
}: {
  size?: number;
  color?: string;
  className?: string;
  title?: string;
  /**
   * Opt-in gentle sway (`.seal-drift`, ±1.5°) for hero/ornamental placements.
   * Off by default so every existing call site — headers, footers, loaders —
   * stays perfectly still, and `prefers-reduced-motion` stops it.
   */
  animated?: boolean;
}) {
  // OFFICIAL mark — vector-traced 1:1 from the brand book (page 15).
  // Single evenodd path: font-independent, pixel-faithful at any size.
  const brand = useBrand();
  // DB/canon palette, or an explicit colour when the caller inverts the mark.
  const ink = color ?? brand.tokens.gold;
  const metalId = `cl-seal-metal-${size}-${ink.replace(/[^a-z0-9]/gi, "")}`;
  const metal = shade(ink, 0) === ink;
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      fill="none"
      role="img"
      aria-label={title}
      className={cn(animated && "seal-drift", className)}
    >
      <title>{title}</title>
      {/* The mark is rendered as struck metal, not a flat swatch: a flat gold at
          this size reads like a printed colour chip, and the diagonal
          highlight-to-shadow sweep is what makes it read as a metal mark.
          The gradient id is derived from the colour and size, so it is stable
          across server and client render (no hook, no hydration gap) and two
          different brands cannot share one definition. Identical instances
          repeat the id, which is harmless: the definitions are identical too. */}
      {metal ? (
        <>
          <defs>
            <linearGradient id={metalId} x1="0.12" y1="0" x2="0.88" y2="1">
              <stop offset="0%" stopColor={shade(ink, 0.42)} />
              <stop offset="34%" stopColor={shade(ink, 0.10)} />
              <stop offset="58%" stopColor={ink} />
              <stop offset="100%" stopColor={shade(ink, -0.30)} />
            </linearGradient>
          </defs>
          <path d={MARK_D} fill={`url(#${metalId})`} fillRule="evenodd" />
        </>
      ) : (
        <path d={MARK_D} fill={ink} fillRule="evenodd" />
      )}
    </svg>
  );
}

export function SloganRing({
  size = 130,
  color = BRAND.iron,
  className,
  speed = 28,
  animated = true,
}: {
  size?: number;
  color?: string;
  className?: string;
  speed?: number;
  /**
   * Set false when the CALLER spins a wrapper instead. Rotating this `<g>`
   * re-rasterises the glyphs on every frame; rotating a promoted HTML wrapper
   * lets the browser rasterise the ring once and composite the rotation.
   */
  animated?: boolean;
}) {
  // Circular stamp device — the slogan repeated around a ring with bullet
  // separators, exactly as in the brand book. Two half-circumference
  // textPaths stretched with textLength so the type closes seamlessly.
  //
  // The path id must be unique per instance: several surfaces mount more than
  // one ring on the same page, and duplicate SVG ids would make every
  // `href="#…"` resolve to the first path in the document.
  const uid = useId();
  const id = `ringPath-${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const half = (2 * Math.PI * 44) / 2; // 138.23 viewBox units
  const brand = useBrand();
  const phrase = `${brand.slogan.toUpperCase()} \u2022 `;
  const { t } = useI18n();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      role="img"
      aria-label={t("common.tagline")}
      className={cn("select-none", className)}
    >
      <title>{t("common.tagline")}</title>
      <defs>
        <path id={id} d="M 60,60 m -44,0 a 44,44 0 1,1 88,0 a 44,44 0 1,1 -88,0" />
      </defs>
      <g
        className={animated ? "ring-spin" : undefined}
        style={animated ? { animationDuration: `${speed}s` } : undefined}
        fill={color}
        fontSize="9.6"
        fontWeight={500}
        letterSpacing="0.16em"
      >
        <text>
          <textPath href={`#${id}`} startOffset="0%" textLength={half} lengthAdjust="spacing">
            {phrase}
          </textPath>
        </text>
        <text>
          <textPath href={`#${id}`} startOffset="50%" textLength={half} lengthAdjust="spacing">
            {phrase}
          </textPath>
        </text>
      </g>
    </svg>
  );
}

export function Wordmark({
  tone = "dark",
  className,
  size = "md",
  showTagline = true,
}: {
  tone?: "dark" | "light";
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showTagline?: boolean;
}) {
  /**
   * Type scale, plus the wordmark→tagline gap.
   *
   * The gap is not arbitrary. The brand book's lockup sets it at 0.37× the
   * wordmark's cap height (sampled from the reference artwork: a 19px gap under
   * a 51px cap height), and a flat 2px here left the tagline sitting on the
   * wordmark at every size. It lives in the tier so the two cannot drift apart.
   *
   * `xl` is the display lockup, for surfaces that can carry the book's own
   * composition (the hero panel). Its type is set to the book's proportions
   * rather than picked by eye: the tagline tracking is widened so its line
   * measures the same width as the wordmark above it. In the reference artwork
   * those two lines end together (measured width ratio 0.996) — that equality is
   * what makes the pair read as a lockup instead of a heading with a caption.
   */
  // Brand copy is data, not translation: an admin edit in Settings → Brand
  // renders verbatim here, and canon renders when no row exists. Every call
  // site becomes editable without touching any of them.
  const brand = useBrand();

  const sizes = {
    sm: { title: "text-sm tracking-[0.28em]", sub: "text-[7px] tracking-[0.18em]", gap: "mt-1" },
    md: { title: "text-lg tracking-[0.3em]", sub: "text-[8px] tracking-[0.2em]", gap: "mt-1.5" },
    lg: { title: "text-2xl tracking-[0.34em]", sub: "text-[10px] tracking-[0.22em]", gap: "mt-2.5" },
    xl: { title: "text-[1.75rem] tracking-[0.34em]", sub: "text-[9px] tracking-[0.43em]", gap: "mt-2.5" },
  }[size];
  return (
    <div className={cn("leading-tight", className)}>
      <div
        className={cn(
          "font-editorial uppercase whitespace-nowrap",
          sizes.title,
          // Brand rule (p.15): wordmark prints in IRON on light, WHITE on dark
          tone === "dark" ? "text-iron-ink" : "text-[#F5F1EA]"
        )}
      >
        {brand.wordmark.title}
      </div>
      {showTagline && (
        <div
          className={cn(
            "uppercase font-medium whitespace-nowrap",
            sizes.gap,
            // Hide the tagline on very narrow headers — it must never wrap
            "hidden sm:block",
            sizes.sub,
            // Brand rule (p.15): tagline prints in SKY BLUE on light surfaces,
            // GOLD on dark surfaces
            tone === "dark" ? "text-sky-ink" : "text-gold-ink"
          )}
        >
          {brand.wordmark.tagline}
        </div>
      )}
    </div>
  );
}

/** Full lockup: mark above wordmark (as on the brand book cover) */
export function BrandLockup({
  tone = "dark",
  size = "md",
  className,
}: {
  tone?: "dark" | "light";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sealSize = { sm: 40, md: 56, lg: 80 }[size];
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <PassportSeal size={sealSize} color={BRAND.gold} />
      <Wordmark tone={tone} size={size} className="text-center" />
    </div>
  );
}

/**
 * Graphic device (p.19): the mark's lattice line-work as a seamless repeating
 * background. Purely decorative — absolute-positioned, pointer-events none.
 */
export function LatticePattern({
  className,
  color = BRAND.gold,
  cell = 108,
  opacity = 0.14,
  id = "cl-lattice",
}: {
  className?: string;
  color?: string;
  cell?: number;
  opacity?: number;
  id?: string;
}) {
  const vb = TILE_VIEWBOX.split(" ").map(Number);
  const sx = cell / vb[2];
  const sy = cell / vb[3];
  return (
    <svg
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    >
      <defs>
        <pattern id={id} width={cell} height={(cell * vb[3]) / vb[2]} patternUnits="userSpaceOnUse">
          <g transform={`scale(${sx} ${sy})`}>
            <path d={TILE_D} fill={color} fillRule="evenodd" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={opacity} />
    </svg>
  );
}
