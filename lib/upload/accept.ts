/**
 * Shared upload accept-list helpers (client-safe).
 *
 * `fileAccepted`, `clampUploadMb`, `extensionRegex` and `acceptAttribute` are
 * shared by the client portal and the drag-and-drop dropzone. The 1–50 MB clamp
 * and the image/PDF accept rules mirror the server-side caps exactly.
 */

/** Fallback upload cap (bytes) — mirrors the server cap when no setting is stored. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Canonical accept-list regex, used when the settings extension list is empty. */
export const ACCEPTED_EXT = /\.(pdf|jpe?g|png|bmp)$/i;

export function fileAccepted(file: File, extRe: RegExp = ACCEPTED_EXT): boolean {
  return file.type.startsWith("image/") || file.type === "application/pdf" || extRe.test(file.name);
}

/** Clamp the admin-configured upload cap to the same 1–50 MB envelope the server enforces. */
export function clampUploadMb(mb: number): number {
  return Number.isFinite(mb) ? Math.min(50, Math.max(1, Math.round(mb))) : MAX_UPLOAD_BYTES / (1024 * 1024);
}

/** Build the accept-list regex from the settings extension list (canon fallback). */
export function extensionRegex(exts: string[]): RegExp {
  const clean = exts.map((e) => e.toLowerCase().replace(/^\./, "").replace(/[^a-z0-9]/g, "")).filter(Boolean);
  return clean.length > 0 ? new RegExp(`\\.(${clean.join("|")})$`, "i") : ACCEPTED_EXT;
}

export function acceptAttribute(exts: string[]): string {
  const clean = exts.map((e) => e.toLowerCase().replace(/^\./, "").replace(/[^a-z0-9]/g, "")).filter(Boolean);
  return [...clean.map((e) => `.${e}`), "image/*"].join(",");
}
