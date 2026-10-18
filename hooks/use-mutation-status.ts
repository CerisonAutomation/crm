"use client";

/**
 * Mutation status hook (U1 — pending / progress / outcome for async actions).
 *
 * Standardizes the lifecycle of a user-initiated mutation: idle → pending
 * → (optional progress) → success | error. Replaces ad-hoc `busy` booleans
 * scattered through the consoles with a single, typed contract.
 */

import { useCallback, useState } from "react";

export type MutationStatus = "idle" | "pending" | "success" | "error";

export interface UseMutationStatusReturn {
  /** Current lifecycle state. */
  status: MutationStatus;
  /** Error message when status === "error". */
  error: string | null;
  /** Optional 0–1 progress for long-running mutations (uploads, generation). */
  progress: number | null;
  /** Run a mutation, automatically managing status. */
  run: (fn: () => Promise<void>) => Promise<void>;
  /** Reset to idle (e.g. when closing a dialog). */
  reset: () => void;
  /** Update progress manually (for streaming / chunked uploads). */
  setProgress: (p: number | null) => void;
}

/**
 * Create a mutation-status controller. Call `run` with an async function;
 * the hook handles the full lifecycle and surfaces `status`, `error`, and
 * optional `progress` for the UI.
 *
 * @example
 * const { status, error, run } = useMutationStatus();
 * const handleSave = () => run(async () => { await api.save(data); });
 */
export function useMutationStatus(): UseMutationStatusReturn {
  const [status, setStatus] = useState<MutationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setStatus("pending");
    setError(null);
    setProgress(null);
    try {
      await fn();
      setStatus("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStatus("error");
      throw e;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setProgress(null);
  }, []);

  return { status, error, progress, setProgress, run, reset };
}