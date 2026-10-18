/**
 * Brand colour math — WCAG contrast + derivation helpers.
 *
 * Used by (a) the Brand Studio contrast guard (intelligent guardrail that
 * warns when a token pair fails WCAG AA) and (b) the surfaces that derive
 * scene tints from live tokens instead of hardcoding hex literals.
 * Pure functions — safe on server and client.
 */

export type Rgb = { r: number; g: number; b: number }; // 0–255

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

export function isHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 0, g: 0, b: 0 };
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * WCAG contrast ratio between two colours (1…21).
 * ≥4.5 passes AA for normal text; ≥3 passes for large text.
 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear mix of two hex colours (t=0 → a, t=1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

/** Darken a colour toward black (amount 0…1). */
export function shade(hex: string, amount: number): string {
  return mixHex(hex, "#000000", Math.max(0, Math.min(1, amount)));
}

/** Lighten a colour toward white (amount 0…1). */
export function tint(hex: string, amount: number): string {
  return mixHex(hex, "#FFFFFF", Math.max(0, Math.min(1, amount)));
}

/** Composite hex@alpha over an opaque background → opaque hex (for SVG scenes). */
export function alphaOver(hex: string, alpha: number, bg: string): string {
  return mixHex(bg, hex, Math.max(0, Math.min(1, alpha)));
}
