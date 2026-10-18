/**
 * Shared list-pagination helpers for API route handlers.
 *
 * Pure module (no Prisma, no fetch) so it stays unit-testable under the
 * Prisma-free test rule. Two styles are supported:
 *
 * - Keyset/cursor paging for append-heavy lists (audit, events, notifications):
 *   callers fetch `limit + 1` rows and `nextPage` trims the sentinel row and
 *   encodes the last row's sort key as an opaque cursor. Stable under
 *   concurrent inserts — no skipped/duplicated rows across pages.
 * - Offset (`page`) paging for bounded admin lists where a total is shown.
 *
 * Responses stay additive: existing `{ items: [...] }` keys are preserved and
 * `nextCursor` is added, so current consumers keep working unchanged.
 */
import { DomainError } from "@/lib/domain/states";

export type ListParams = {
  /** Page size, bounded to [1, maxLimit] (invalid input → 400). */
  limit: number;
  /** 1-based page number for offset paging (invalid input → 1, lenient). */
  page: number;
  /** Rows to skip for offset paging: (page - 1) * limit. */
  offset: number;
  /** Opaque `?cursor=` value, when the caller sent one. */
  cursor?: string;
};

/** Parse `limit` / `page` / `cursor` from a list endpoint's query string. */
export function parseListParams(
  url: URL,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): ListParams {
  const defaultLimit = opts.defaultLimit ?? 25;
  const maxLimit = opts.maxLimit ?? 100;

  let limit = defaultLimit;
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) throw new DomainError("Invalid limit", 400);
    limit = Math.min(parsed, maxLimit);
  }

  // `page` is a UI affordance, not a contract: fall back to 1 instead of erroring.
  let page = 1;
  const rawPage = url.searchParams.get("page");
  if (rawPage !== null) {
    const parsed = Number(rawPage);
    if (Number.isInteger(parsed) && parsed >= 1) page = parsed;
  }

  const cursor = url.searchParams.get("cursor");
  return { limit, page, offset: (page - 1) * limit, ...(cursor ? { cursor } : undefined) };
}

/** Encode a sort key (record id) as an opaque cursor. */
export function encodeCursor(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

/** Decode an opaque cursor, rejecting junk with a 400 instead of a Prisma error. */
export function decodeCursor(cursor: string): string {
  const key = Buffer.from(cursor, "base64url").toString("utf8");
  if (!key || key.length > 64 || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new DomainError("Invalid cursor", 400);
  }
  return key;
}

/**
 * Turn a `limit + 1` fetch into a page. Trims the sentinel row and returns
 * the cursor for the next page (`null` when this is the last page).
 */
export function nextPage<T>(
  items: T[],
  limit: number,
  keyOf: (item: T) => string,
): { items: T[]; nextCursor: string | null } {
  const hasMore = items.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;
  const last = pageItems[pageItems.length - 1];
  return {
    items: pageItems,
    nextCursor: hasMore && last !== undefined ? encodeCursor(keyOf(last)) : null,
  };
}
