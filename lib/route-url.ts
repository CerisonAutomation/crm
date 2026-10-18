/**
 * route-url — pure URL (de)serialisation for the SPA's view store.
 *
 * The product is a single-route SPA (`/?view=…`): every in-app navigation
 * mirrors the store destination into the query string so Back/Forward,
 * refresh and deep links all work. This module owns that mapping — no React,
 * no network, no database — so it stays unit-testable in a plain Node env.
 *
 * Param contract:
 *   `view`   the canonical View name (aliases like `journal` are preserved
 *            verbatim by boot when they already resolve to the final view)
 *   `id`     the detail-record id (rm-case / studio-detail / pages-editor)
 *   `slug`   the published page slug for the public reader
 *   `panel`  `integrations` only — the admin-automation integrations panel
 *
 * Every other param (`token` from the reset-password / magic-link handoff,
 * …) is carried through untouched on each write: `buildRouteSearch` starts
 * from the CURRENT search string and only touches the owned params.
 */
import type { AdminSub } from "@/lib/nav";
import type { View } from "@/lib/store";

/** The store destination a URL represents: view + detail ids + admin panel. */
export type RouteState = {
  view: View;
  activeCaseId: string | null;
  activeWorkflowId: string | null;
  activePageId: string | null;
  activePublicSlug: string | null;
  adminPanel: AdminSub;
};

/** The URL params this module owns; everything else is carried through. */
export const OWNED_PARAMS = ["view", "id", "slug", "panel"] as const;

/** The detail-record id for a view, or null when the view has no record. */
export function detailIdFor(
  route: Pick<RouteState, "view" | "activeCaseId" | "activeWorkflowId" | "activePageId">,
): string | null {
  if (route.view === "rm-case") return route.activeCaseId;
  if (route.view === "studio-detail") return route.activeWorkflowId;
  if (route.view === "pages-editor") return route.activePageId;
  return null;
}

/**
 * Build the query string (no leading `?`) that mirrors `route`.
 *
 * Starts from `currentSearch` and only touches the owned params, so `token`
 * and friends survive. `landing` strips every owned param so the root stays a
 * clean `/`. `preserveView` keeps an alias param (`journal`, `dashboard`) that
 * already resolves to this view.
 */
export function buildRouteSearch(
  currentSearch: string,
  route: RouteState,
  preserveView: string | null = null,
): string {
  const params = new URLSearchParams(currentSearch);
  if (route.view === "landing") {
    for (const key of OWNED_PARAMS) params.delete(key);
    return params.toString();
  }
  params.set("view", preserveView ?? route.view);

  const id = detailIdFor(route);
  if (id) params.set("id", id);
  else params.delete("id");

  // An open reader's slug is written; an existing slug param is never
  // dropped, so deep links carry it through boot.
  if (route.activePublicSlug) params.set("slug", route.activePublicSlug);

  // The `panel` param exists only while the admin-automation view shows the
  // integrations panel — the automation panel is the default (absent) state.
  if (route.view === "admin-automation" && route.adminPanel === "integrations") {
    params.set("panel", "integrations");
  } else {
    params.delete("panel");
  }
  return params.toString();
}

/** The raw owned params of a search string; blank values become null. */
export type ParsedRoute = {
  view: string | null;
  id: string | null;
  slug: string | null;
  panel: string | null;
};

function blank(value: string | null): string | null {
  return value && value.trim() ? value : null;
}

/** Read the owned params out of a search string (with or without `?`). */
export function parseRouteSearch(search: string): ParsedRoute {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    // The raw `view` param keeps its exact casing for alias preservation;
    // resolvers lowercase it themselves.
    view: blank(params.get("view")),
    id: blank(params.get("id")),
    slug: blank(params.get("slug")),
    panel: blank(params.get("panel")),
  };
}
