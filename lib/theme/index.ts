/**
 * Theme — the consolidated product's single token layer.
 *
 * The product merged two apps' worth of surfaces into one brand: the editorial
 * public site (landing, journal, procedure) and the staff workspace (case desk,
 * CRM, workflow studio, KYC & screening, automation, admin console). They share
 * ONE palette, ONE motion vocabulary and ONE type ramp — what differs is the
 * *surface profile*: rhythm, corner radius and separator weight.
 *
 * Three things live here and nowhere else:
 *
 * 1. **Surface profiles.** `data-surface="editorial|client|workspace"` switches
 *    the skin of a subtree. `surfaceForView()` is the single mapping from a
 *    store `View` to its profile, so the shell can never disagree with the CSS.
 *    Every visual consequence is authored in `src/app/globals.css` — this module
 *    only names the switch.
 *
 * 2. **The brand → CSS bridge.** `CANON_BRAND.tokens` (src/lib/brand/defaults.ts)
 *    has always documented that "runtime truth flows through /api/brand →
 *    BrandProvider → CSS variables", but only the provider half existed: nothing
 *    wrote the variables, so an administrator could edit the palette and watch
 *    every screen stay on canon. `applyBrandTokens()` is that missing writer. It
 *    emits the `--cl-*` variables the stylesheet reads *with the canon hex as the
 *    fallback*, so the first paint and the hydrated paint are identical.
 *
 * 3. **The AA lock.** Only *fill* tokens follow the brand. The ink/status tokens
 *    that carry WCAG AA contrast (`--gold-text`, `--ink*`, `--*-text`) are
 *    deliberately NOT brand-overridable: a white-labelled instance must not be
 *    able to ship unreadable text. `AA_LOCKED_TOKENS` records the boundary and
 *    `tests/theme-surfaces.test.ts` proves the stylesheet honours it.
 *
 * Pure data + one DOM writer — safe on the server (the writer no-ops without a
 * document).
 */
import { CANON_BRAND, type BrandTokens, type CanonBrand } from "@/lib/brand/defaults";

// ── Surfaces ────────────────────────────────────────────────────────────────

export type SurfaceKey = "editorial" | "client" | "workspace";

/** The attribute a surface subtree is tagged with (read by globals.css). */
export const SURFACE_ATTRIBUTE = "data-surface" as const;

export type SurfaceProfile = {
  key: SurfaceKey;
  /** Human label (admin console / docs). */
  label: string;
  /** Who works on this surface. */
  audience: "public" | "applicant" | "staff";
  /** The CSS scope this profile is authored under in globals.css. */
  selector: string;
  /** Corner radius the surface renders with (must equal the CSS override). */
  radius: string;
  /** Rhythm: editorial pages breathe, console surfaces are denser. */
  rhythm: "editorial" | "console";
  description: string;
};

/**
 * The three skins. `editorial` is the default (an untagged subtree inherits
 * `:root`), so the profile exists to make the contract explicit and testable.
 */
export const SURFACE_PROFILES: Readonly<Record<SurfaceKey, SurfaceProfile>> = {
  editorial: {
    key: "editorial",
    label: "Editorial",
    audience: "public",
    selector: '[data-surface="editorial"]',
    radius: "0.375rem",
    rhythm: "editorial",
    description: "Public marketing, journal and procedure pages: print-like spacing, soft radii.",
  },
  client: {
    key: "client",
    label: "Client portal",
    audience: "applicant",
    selector: '[data-surface="client"]',
    radius: "0.5rem",
    rhythm: "editorial",
    description: "The applicant's own workspace: generous targets, calm reading measure.",
  },
  workspace: {
    key: "workspace",
    label: "Staff workspace",
    audience: "staff",
    selector: '[data-surface="workspace"]',
    radius: "0.25rem",
    rhythm: "console",
    description: "Case desk, CRM, studio, automation, KYC and admin: squared corners, denser rows, stronger separators.",
  },
};

/**
 * Views (src/lib/store.ts) routed to the staff console. Prefix match, so a new
 * `admin-*` or `studio-*` view is a console surface by construction instead of
 * by remembering to add it here.
 */
const WORKSPACE_VIEW_PREFIXES: readonly string[] = ["rm-", "admin-", "studio-"];

/** Views routed to the applicant's portal. */
const CLIENT_VIEW_PREFIXES: readonly string[] = ["client-"];

/**
 * Exact views with no shared prefix. `pages-list`/`pages-editor` are the admin
 * Lane Pages library (workspace); `pages-explore`/`pages-reader` are the PUBLIC
 * journal and render outside the shell, so they stay editorial by fallback.
 */
const WORKSPACE_VIEWS: readonly string[] = ["crm", "teams", "settings", "pages-list", "pages-editor"];

/**
 * Resolve the surface profile for a view. Unknown views fall back to
 * `editorial` — a new public surface renders branded without registering here,
 * and a new console view is one prefix away from being denser.
 */
export function surfaceForView(view: string): SurfaceKey {
  if (WORKSPACE_VIEWS.includes(view)) return "workspace";
  if (WORKSPACE_VIEW_PREFIXES.some((p) => view.startsWith(p))) return "workspace";
  if (CLIENT_VIEW_PREFIXES.some((p) => view.startsWith(p))) return "client";
  return "editorial";
}

// ── Brand → CSS variables ───────────────────────────────────────────────────

/**
 * The `--cl-*` variables the stylesheet reads. Every one is used with a canon
 * fallback (`var(--cl-gold, #CAAA68)`), so an unset variable is not a bug — it
 * is canon.
 */
export const BRAND_TOKEN_VARIABLES = [
  "cl-cobble",
  "cl-gold",
  "cl-sky",
  "cl-iron",
  "cl-limestone",
  "cl-paper",
  "cl-plaster",
  "cl-chrome-bg",
  "cl-chrome-border",
  "cl-chrome-text",
  "cl-chrome-text-dim",
  "cl-chrome-active",
  "cl-chrome-hover",
  "cl-secondary-1",
  "cl-secondary-2",
  "cl-secondary-3",
  "cl-secondary-4",
  "cl-secondary-5",
  "cl-secondary-6",
  "cl-secondary-7",
  "cl-secondary-8",
  "cl-secondary-9",
  "cl-secondary-10",
] as const;

export type BrandTokenVariable = (typeof BRAND_TOKEN_VARIABLES)[number];

/**
 * Map the live brand's tokens onto CSS variables.
 *
 * Order matters only for readability; the count is asserted (13 fixed tokens +
 * the 10 documented secondary slots) so a palette change that forgets a slot
 * fails a test instead of silently dropping a colour.
 */
export function brandTokenDeclarations(brand: Pick<CanonBrand, "tokens">): Array<[BrandTokenVariable, string]> {
  const t: BrandTokens = brand.tokens;
  const secondary = t.secondary ?? [];
  const declarations: Array<[BrandTokenVariable, string]> = [
    ["cl-cobble", t.cobble],
    ["cl-gold", t.gold],
    ["cl-sky", t.sky],
    ["cl-iron", t.iron],
    ["cl-limestone", t.limestone],
    ["cl-paper", t.paper],
    ["cl-plaster", t.plaster],
    ["cl-chrome-bg", t.chrome.bg],
    ["cl-chrome-border", t.chrome.border],
    ["cl-chrome-text", t.chrome.text],
    ["cl-chrome-text-dim", t.chrome.textDim],
    ["cl-chrome-active", t.chrome.active],
    ["cl-chrome-hover", t.chrome.hover],
  ];
  for (let i = 0; i < 10; i += 1) {
    const value = secondary[i];
    if (!value) break;
    declarations.push([`cl-secondary-${i + 1}` as BrandTokenVariable, value]);
  }
  return declarations;
}

/**
 * Paint the brand onto `<html>` as CSS variables.
 *
 * No-ops on the server. Idempotent — calling it twice with the same brand is
 * two identical `setProperty` calls. A failed write (detached document in a
 * test environment) is swallowed: a theme must never break a render.
 */
export function applyBrandTokens(brand: Pick<CanonBrand, "tokens"> = CANON_BRAND): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  try {
    for (const [name, value] of brandTokenDeclarations(brand)) {
      root.style.setProperty(`--${name}`, value);
    }
  } catch {
    /* detached document / blocked style — canon still paints */
  }
}

// ── Contract surface (parity-tested) ────────────────────────────────────────

/**
 * Tokens the stylesheet guarantees. `tests/theme-surfaces.test.ts` asserts each
 * one is declared in `src/app/globals.css`, so a rename cannot silently break
 * every consumer (letters, emails, charts, PDF seals read these names too).
 */
export const CSS_TOKEN_CONTRACT = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "gold-text",
  "ink",
  "ink-muted",
  "amber-text",
  "danger-text",
  "olive-text",
  "coral-text",
  "teal-text",
  "sky-text",
  "limestone-text",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "radius",
  "ease-out-expo",
  "ease-out-quint",
  "ease-out-soft",
  "ease-in-out-brand",
  "dur-fast",
  "dur-base",
  "dur-slow",
  "dur-reveal",
  "text-display",
  "text-h1",
  "text-h2",
  "text-h3",
  "text-lead",
  "text-eyebrow",
  "text-micro",
  "tracking-eyebrow",
  "tracking-eyebrow-tight",
  "measure",
  "measure-tight",
  "hairline",
  "hairline-strong",
  "gold-hairline",
] as const;

export type CssToken = (typeof CSS_TOKEN_CONTRACT)[number];

/**
 * Deliberately brand-immune: these resolve per ground (light/dark) and are
 * tuned for WCAG AA. A white-label palette must never overwrite them, so no
 * `--cl-*` writer touches them and the stylesheet declares them literally.
 */
export const AA_LOCKED_TOKENS = [
  "gold-text",
  "ink",
  "ink-muted",
  "amber-text",
  "danger-text",
  "olive-text",
  "coral-text",
  "teal-text",
  "sky-text",
  "limestone-text",
] as const satisfies readonly CssToken[];

/** Brand-owned tokens (the fill palette a white-label instance may restyle). */
export const BRAND_OWNED_CSS_VARIABLES = [
  "cl-cobble",
  "cl-gold",
  "cl-sky",
  "cl-iron",
  "cl-limestone",
  "cl-paper",
  "cl-plaster",
] as const;
