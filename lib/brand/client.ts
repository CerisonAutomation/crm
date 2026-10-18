"use client";

/**
 * Runtime brand for the UI — the missing half of the brand settings pipeline.
 *
 * The pipeline was documented as `/api/brand → BrandProvider → CSS variables`
 * (see the header of `brand/defaults.ts`), but the provider did not exist: the
 * API was written, the admin editor was written, and every device still read the
 * CANON constant. So an admin could edit the wordmark, the tagline, the slogan
 * and the palette, and nothing on screen moved — the settings reached the PDF
 * letterhead and the favicon and stopped there.
 *
 * This is the provider, built on the same module-singleton + `useSyncExternalStore`
 * idiom as `policy.ts` and `ui-mode.ts`, for three reasons: the devices that need
 * it (seal, wordmark, slogan ring) are rendered deep in trees that would
 * otherwise all need a context provider threaded through them; the brand is
 * global and changes once per session; and canon is always a valid answer, so a
 * failed fetch degrades to the brand rather than to a blank.
 *
 * `/api/brand` is public (the landing and sign-in render pre-auth), so no
 * credential is involved and nothing here is secret.
 */
import { useSyncExternalStore } from "react";
import { applyBrandTokens } from "@/lib/theme";
import { CANON_BRAND, type CanonBrand } from "./defaults";

let current: CanonBrand = CANON_BRAND;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  // Paint the brand as CSS variables (`--cl-*`) before anyone re-renders, so
  // the theme layer — editorial, client portal and staff workspace alike —
  // repaints from ONE source the moment an administrator changes the palette.
  applyBrandTokens(current);
  for (const l of listeners) l();
}

/** The merged brand, or canon before the fetch resolves and if it fails. */
function snapshot(): CanonBrand {
  return current;
}

/** Server render always uses canon: one deterministic value, no hydration gap. */
function serverSnapshot(): CanonBrand {
  return CANON_BRAND;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

async function load(): Promise<void> {
  if (started || globalThis.window === undefined) return;
  started = true;
  // Canon first: the stylesheet already falls back to the canon hexes, so this
  // only makes the variables explicit before the fetch resolves. Idempotent.
  applyBrandTokens(current);
  try {
    const res = await fetch("/api/brand", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const body = (await res.json()) as { settings?: CanonBrand };
    const settings = body?.settings;
    if (!settings) return;
    // Section-wise merge over canon, so a partially configured row (or a future
    // field the server has not heard of yet) cannot blank a section.
    current = {
      ...CANON_BRAND,
      ...settings,
      tokens: { ...CANON_BRAND.tokens, ...settings.tokens },
      wordmark: { ...CANON_BRAND.wordmark, ...settings.wordmark },
      contact: { ...CANON_BRAND.contact, ...settings.contact },
      hero: { ...CANON_BRAND.hero, ...settings.hero },
      logo: { ...CANON_BRAND.logo, ...settings.logo },
    };
    emit();
  } catch {
    /* keep canon — a brand fetch must never blank the interface */
  }
}

/** The live brand. Safe in any client component, at any depth. */
export function useBrand(): CanonBrand {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** For non-React callers (event handlers, imperative helpers). */
export function currentBrand(): CanonBrand {
  return current;
}
