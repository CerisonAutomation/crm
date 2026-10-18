/**
 * Execution hook registry and lifecycle events for n8n workflow operations.
 * Provides a typed hook system that allows registering callbacks for
 * execution lifecycle events (before, after, error) without coupling
 * the execution engine to specific consumers.
 */

import type { NodeIdempotencyKind } from "./node-contracts";

export type ExecutionPhase = "before" | "after" | "error";

export type ExecutionContext = {
  pieceKey: string;
  idempotency: NodeIdempotencyKind;
  attempt: number;
  startedAt: number;
  metadata?: Record<string, unknown>;
};

export type ExecutionResult = {
  success: boolean;
  output?: unknown;
  error?: Error;
  durationMs: number;
};

export type ExecutionHook = {
  phase: ExecutionPhase;
  pieceKey?: string; // undefined = all pieces
  handler: (
    context: ExecutionContext,
    result?: ExecutionResult,
  ) => void | Promise<void>;
};

export type HookUnsubscribe = () => void;

/**
 * Registry for execution hooks. Supports filtering by phase and pieceKey.
 * Handlers are called in registration order. Errors in handlers are caught
 * and logged but never propagate to the execution itself.
 */
export class HookRegistry {
  private hooks: ExecutionHook[] = [];

  /**
   * Register a hook. Returns an unsubscribe function.
   */
  register(hook: ExecutionHook): HookUnsubscribe {
    this.hooks.push(hook);
    return () => {
      const idx = this.hooks.indexOf(hook);
      if (idx >= 0) this.hooks.splice(idx, 1);
    };
  }

  /**
   * Register a hook for a specific phase. Returns an unsubscribe function.
   */
  on(
    phase: ExecutionPhase,
    handler: ExecutionHook["handler"],
    pieceKey?: string,
  ): HookUnsubscribe {
    return this.register({ phase, pieceKey, handler });
  }

  /**
   * Remove all hooks (useful for testing).
   */
  clear(): void {
    this.hooks = [];
  }

  /**
   * Get the count of registered hooks.
   */
  get size(): number {
    return this.hooks.length;
  }

  /**
   * Execute all matching hooks for a given phase.
   * Errors in individual handlers are caught and suppressed.
   */
  async emit(
    phase: ExecutionPhase,
    context: ExecutionContext,
    result?: ExecutionResult,
  ): Promise<void> {
    const matching = this.hooks.filter(
      (h) =>
        h.phase === phase &&
        (h.pieceKey === undefined || h.pieceKey === context.pieceKey),
    );

    for (const hook of matching) {
      try {
        await hook.handler(context, result);
      } catch {
        // Hook errors must never break execution
      }
    }
  }
}

// ── Default global registry ──

let globalRegistry: HookRegistry | null = null;

/**
 * Get the global hook registry (lazy singleton).
 */
export function getGlobalHookRegistry(): HookRegistry {
  if (!globalRegistry) {
    globalRegistry = new HookRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global hook registry (useful for testing).
 */
export function resetGlobalHookRegistry(): void {
  globalRegistry = null;
}

// ── Built-in hooks ──

/**
 * Creates a logging hook that logs execution start, success, and failure.
 */
export function createLoggingHook(logger: {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}): ExecutionHook[] {
  return [
    {
      phase: "before",
      handler: (ctx) => {
        logger.info(`Executing ${ctx.pieceKey}`, {
          attempt: ctx.attempt,
          idempotency: ctx.idempotency,
        });
      },
    },
    {
      phase: "after",
      handler: (ctx, result) => {
        logger.info(`Completed ${ctx.pieceKey}`, {
          durationMs: result?.durationMs,
          success: result?.success,
        });
      },
    },
    {
      phase: "error",
      handler: (ctx, result) => {
        logger.error(`Failed ${ctx.pieceKey}`, {
          error: result?.error?.message,
          durationMs: result?.durationMs,
        });
      },
    },
  ];
}

/**
 * Creates a metrics hook that tracks execution counts and durations.
 */
export function createMetricsHook(): ExecutionHook & {
  getStats: () => {
    total: number;
    success: number;
    failure: number;
    avgDurationMs: number;
  };
} {
  let total = 0;
  let success = 0;
  let failure = 0;
  let totalDuration = 0;

  const hook: ExecutionHook & {
    getStats: () => {
      total: number;
      success: number;
      failure: number;
      avgDurationMs: number;
    };
  } = {
    phase: "after",
    handler: (_ctx, result) => {
      total++;
      totalDuration += result?.durationMs ?? 0;
      if (result?.success) success++;
      else failure++;
    },
    getStats: () => ({
      total,
      success,
      failure,
      avgDurationMs: total > 0 ? totalDuration / total : 0,
    }),
  };

  return hook;
}
