/**
 * Citizen Lane — CANON brand defaults (single source of truth).
 *
 * This module is the ONLY place canonical hex values and canonical brand
 * copy live. Every device (seal, wordmark, slogan ring, lattice), every
 * surface (landing, login, shell, footer, favicon) and the Brand Settings
 * API consume these types/defaults. A `BrandSetting` DB row (see
 * prisma/schema.prisma) overrides sections on top of this canon via a deep
 * per-section merge — absence of the row (or of any key) always falls back
 * to canon, so the platform renders perfectly with zero configuration.
 *
 * Canon sources:
 *  - Palette      : "Citizen Lane — Visual Language v2" pp. 10–11
 *  - Copy         : print ad p.25 (contact line) + landing hero copy
 *  - Logo colours : p.15 (gold mark on white octagon panel)
 *  - Dark lockup  : p.15 — tagline prints the same cream as the title
 *                   (critique §2.3); gold is an OPTIONAL settings override.
 *
 * Keep the static `--cl-*` fallbacks in src/app/globals.css in sync with
 * the token hexes below — they exist only so the first paint (before the
 * BrandProvider hydrates) already shows canon and no flash occurs; runtime
 * truth always flows through /api/brand → BrandProvider → CSS variables.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type BrandTokens = {
  gold: string;
  sky: string;
  iron: string;
  limestone: string;
  cobble: string;
  paper: string;
  /** Warm plaster surface tint (paper-texture bands, dividers). */
  plaster: string;
  /** Optional secondary palette (PDF p.11) — 10 slots, used sparingly. */
  secondary?: string[];
  /** Derived shell chrome tones (sidebar/drawer cobble system). */
  chrome: BrandChrome;
};

export type BrandChrome = {
  /** Sidebar / drawer background (canon: cobble). */
  bg: string;
  /** Hairline borders inside chrome (canon: lifted cobble). */
  border: string;
  /** Primary text on chrome (canon: warm cream). */
  text: string;
  /** Dimmed text on chrome (canon: silvered cream). */
  textDim: string;
  /** Active nav item wash (canon: lifted cobble). */
  active: string;
  /** Hover wash inside chrome. */
  hover: string;
};

export type BrandWordmark = { title: string; tagline: string };
export type BrandContact = { city: string; email: string; phone: string; site: string };
export type BrandHero = {
  eyebrow: string;
  headline: string;
  subtext: string;
  ctaPrimary: string;
  ctaSecondary: string;
};
export type BrandLogo = {
  /** Lattice + seal stroke colour. */
  markColor: string;
  /** Monogram fill colour (canon: same gold as the mark). */
  monogramColor: string;
  /** Inner octagon panel fill (canon: white). */
  panelFill: string;
  /** Panel fill opacity 0–1. */
  panelOpacity: number;
  /** Dark-surface tagline tone — canon prints it cream like the title (§2.3). */
  darkTagline: "cream" | "gold";
};

/** The fully-merged brand settings shape the whole app consumes. */
export type CanonBrand = {
  tokens: BrandTokens;
  wordmark: BrandWordmark;
  slogan: string;
  contact: BrandContact;
  hero: BrandHero;
  logo: BrandLogo;
  /** Free-form future tokens (socials, radius, heroImage…) — never required. */
  extras: Record<string, unknown>;
};

// ── Canon values (the ONLY home of canonical hexes/copy in code) ────────────

export const CANON_BRAND: CanonBrand = {
  tokens: {
    gold: "#CAAA68",
    sky: "#81A2C3",
    iron: "#4A4A49",
    limestone: "#D6C0A2",
    cobble: "#12283A",
    paper: "#FAF8F4",
    plaster: "#F5F1EA",
    secondary: [
      "#1CA5B1", // teal
      "#FFB115", // amber
      "#73576C", // plum
      "#96624D", // clay
      "#577445", // olive
      "#DC6B3A", // rust
      "#006182", // deepsea
      "#F28482", // coral
      "#D1D3D4", // silver
      "#D3C0DA", // lilac
    ],
    chrome: {
      bg: "#12283A",
      border: "#24405A",
      text: "#F5F1EA",
      textDim: "#B9C4CE",
      active: "#1B3A54",
      hover: "#16324A",
    },
  },
  wordmark: {
    title: "Citizen Lane",
    tagline: "Citizenship & Residence by Investment",
  },
  slogan: "Let's create tomorrow",
  contact: {
    city: "Zurich",
    email: "info@citizen-lane.com",
    phone: "+41 55 511 54 00",
    site: "www.citizen-lane.com",
  },
  hero: {
    eyebrow: "Citizenship & Residence Planning",
    headline: "Your personal partner for citizenship and residence planning",
    subtext:
      "Relocating is easier than you might think — a discreet atelier for individuals and families expanding their citizenship and passport portfolio.",
    ctaPrimary: "Begin your journey",
    ctaSecondary: "Explore our services",
  },
  logo: {
    markColor: "#B08C52",
    monogramColor: "#B08C52",
    panelFill: "#FFFFFF",
    panelOpacity: 1,
    darkTagline: "cream",
  },
  extras: {},
};

// ── Deep per-section merge (DB row over canon) ──────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merge `patch` over `base` per section. Objects merge key-wise (missing
 * keys fall back to base); arrays and primitives replace wholesale. Used by
 * the /api/brand route (server-authoritative) and defensively by the client
 * store. Validation happens separately — see merge.ts.
 */
export function deepMergeBrand<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  if (!isPlainObject(base)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMergeBrand(current, value) : value;
  }
  return out as T;
}
