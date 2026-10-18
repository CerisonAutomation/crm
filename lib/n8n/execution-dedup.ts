/**
 * Data deduplication patterns for workflow executions.
 * Prevents duplicate side effects from at-least-once operations by tracking
 * execution keys and detecting replays within a configurable time window.
 */

import type { NodeIdempotencyKind } from "./node-contracts";

export type DedupEntry = {
  key: string;
  pieceKey: string;
  firstExecutedAt: number;
  lastExecutedAt: number;
  executionCount: number;
  result?: unknown;
};

export type DedupResult = {
  isDuplicate: boolean;
  originalEntry?: DedupEntry;
};

export type DedupOptions = {
  /** Time window in ms during which a duplicate is detected. Default: 5 minutes. */
  windowMs?: number;
  /** Maximum number of entries to track before evicting oldest. Default: 1000. */
  maxEntries?: number;
};

const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * Generates a deduplication key from a pieceKey and its arguments.
 * The key is a deterministic hash of the operation and its inputs.
 */
export function generateDedupKey(
  pieceKey: string,
  args: Record<string, unknown>,
): string {
  // Sort keys for deterministic serialization
  const sortedKeys = Object.keys(args).sort();
  const normalized = sortedKeys.map((k) => `${k}=${JSON.stringify(args[k])}`);
  return `${pieceKey}:${normalized.join("|")}`;
}

/**
 * In-memory deduplication store. Tracks execution keys within a time window
 * and detects replays. Supports eviction when the store grows too large.
 */
export class DedupStore {
  private entries: Map<string, DedupEntry> = new Map();
  private windowMs: number;
  private maxEntries: number;

  constructor(options: DedupOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Check if an execution is a duplicate and record it if not.
   * Returns whether this is a replay of a previous execution.
   */
  checkAndRecord(key: string, pieceKey: string, now = Date.now()): DedupResult {
    // Clean expired entries first
    this.cleanExpired(now);

    const existing = this.entries.get(key);

    if (existing && now - existing.firstExecutedAt < this.windowMs) {
      // Duplicate detected — update the existing entry
      existing.lastExecutedAt = now;
      existing.executionCount++;
      return { isDuplicate: true, originalEntry: { ...existing } };
    }

    // New execution — record it
    const entry: DedupEntry = {
      key,
      pieceKey,
      firstExecutedAt: now,
      lastExecutedAt: now,
      executionCount: 1,
    };
    this.entries.set(key, entry);

    // Evict oldest if over capacity
    if (this.entries.size > this.maxEntries) {
      this.evictOldest();
    }

    return { isDuplicate: false };
  }

  /**
   * Check if a key has been recorded without updating it.
   */
  peek(key: string, now = Date.now()): DedupResult {
    const existing = this.entries.get(key);
    if (existing && now - existing.firstExecutedAt < this.windowMs) {
      return { isDuplicate: true, originalEntry: { ...existing } };
    }
    return { isDuplicate: false };
  }

  /**
   * Store the result of an execution so duplicates can return it.
   */
  recordResult(key: string, result: unknown, now = Date.now()): void {
    this.cleanExpired(now);
    const existing = this.entries.get(key);
    if (existing) {
      existing.result = result;
      existing.lastExecutedAt = now;
    }
  }

  /**
   * Remove expired entries from the store.
   */
  private cleanExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.firstExecutedAt >= this.windowMs) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Evict the oldest entry (by firstExecutedAt).
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.firstExecutedAt < oldestTime) {
        oldestTime = entry.firstExecutedAt;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.entries.delete(oldestKey);
    }
  }

  /**
   * Get the current size of the store.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
  }
}

// ── Default global store ──

let globalStore: DedupStore | null = null;

/**
 * Get the global dedup store (lazy singleton).
 */
export function getGlobalDedupStore(options?: DedupOptions): DedupStore {
  if (!globalStore) {
    globalStore = new DedupStore(options);
  }
  return globalStore;
}

/**
 * Reset the global dedup store (useful for testing).
 */
export function resetGlobalDedupStore(): void {
  globalStore = null;
}

// ── Dedup-aware execution wrapper ──

/**
 * Options for dedup-aware execution.
 */
export type DedupExecuteOptions = {
  pieceKey: string;
  idempotency: NodeIdempotencyKind;
  args: Record<string, unknown>;
  /** Override the global store. */
  store?: DedupStore;
  /** Skip dedup check (force execution). */
  force?: boolean;
};

/**
 * Execute an operation with deduplication for at-least-once operations.
 * Idempotent operations bypass dedup entirely.
 *
 * Returns the result, or a marker indicating the execution was skipped as duplicate.
 */
export async function executeWithDedup<T>(
  options: DedupExecuteOptions,
  operation: () => Promise<T>,
): Promise<
  { skipped: true; reason: string; result: T } | { skipped: false; result: T }
> {
  const { pieceKey, idempotency, args, force } = options;
  const store = options.store ?? getGlobalDedupStore();

  // Idempotent operations don't need dedup — they're safe to replay
  if (idempotency === "idempotent" || force) {
    return { skipped: false, result: await operation() };
  }

  const key = generateDedupKey(pieceKey, args);
  const dedupResult = store.checkAndRecord(key, pieceKey);

  if (dedupResult.isDuplicate) {
    return {
      skipped: true,
      reason: `Duplicate execution detected for ${pieceKey} (original at ${dedupResult.originalEntry?.firstExecutedAt})`,
      result: dedupResult.originalEntry?.result as T,
    };
  }

  const result = await operation();
  store.recordResult(key, result);
  return { skipped: false, result };
}
