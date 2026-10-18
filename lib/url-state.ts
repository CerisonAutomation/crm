"use client";

import { useQueryState, parseAsString, parseAsInteger } from "nuqs";

/**
 * URL-synchronized view state for shareable URLs.
 * 
 * The view is stored in the URL as `?view=<view>&sub=<sub>` so users can
 * bookmark or share links to specific views.
 */

export type ViewState = {
  view: string;
  sub: string | null;
};

export function useViewState() {
  const [view, setView] = useQueryState(
    "view",
    parseAsString.withDefault("dashboard")
  );
  const [sub, setSub] = useQueryState(
    "sub",
    parseAsString
  );

  return {
    view,
    sub,
    setView,
    setSub,
  };
}

export function useAdminPanelState() {
  const [panel, setPanel] = useQueryState(
    "panel",
    parseAsString.withDefault("automation")
  );

  return {
    panel,
    setPanel,
  };
}

export function usePaginationState() {
  const [page, setPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1)
  );
  const [pageSize, setPageSize] = useQueryState(
    "pageSize",
    parseAsInteger.withDefault(25)
  );

  return {
    page,
    pageSize,
    setPage,
    setPageSize,
  };
}

export function useSearchState() {
  const [search, setSearch] = useQueryState(
    "search",
    parseAsString.withDefault("")
  );

  return {
    search,
    setSearch,
  };
}

export function useSortState() {
  const [sortBy, setSortBy] = useQueryState(
    "sortBy",
    parseAsString.withDefault("createdAt")
  );
  const [sortDir, setSortDir] = useQueryState(
    "sortDir",
    parseAsString.withDefault("desc")
  );

  return {
    sortBy,
    sortDir,
    setSortBy,
    setSortDir,
  };
}
