"use client";

/**
 * Undo toast (U3 — 10-second undoable mutations).
 *
 * Shows a toast with an "Undo" action for 10 seconds. If the user clicks
 * Undo, the provided callback runs and the toast dismisses. After 10s the
 * toast auto-dismisses and the mutation is committed.
 */

import { toast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { RotateCcw } from "lucide-react";

export interface UndoToastOptions {
  /** Toast title (e.g. "Case completed"). */
  title: string;
  /** Optional description. */
  description?: string;
  /** Called when the user clicks "Undo". Should revert the mutation. */
  onUndo: () => void;
  /** Label for the undo button. Defaults to "Undo". */
  undoLabel?: string;
  /** How long the toast stays before auto-dismissing (ms). Default 10s. */
  duration?: number;
}

/**
 * Show a toast with an Undo action. Returns the toast ID for manual dismissal.
 *
 * @example
 * const { showUndoToast } = useUndoToast();
 * showUndoToast({
 *   title: "Case completed",
 *   description: "Reference ABC-123",
 *   onUndo: () => api.reopenCase(id),
 * });
 */
export function showUndoToast({
  title,
  description,
  onUndo,
  undoLabel = "Undo",
  duration = 10_000,
}: UndoToastOptions): { dismiss: () => void; id: string } {
  let dismissed = false;
  const dismiss = () => {
    if (!dismissed) {
      dismissed = true;
      // The toast ID is returned by the toast call, but we don't have it here.
      // We rely on the toast's own dismiss mechanism.
    }
  };

  const action: ToastActionElement = (
    <ToastAction altText={undoLabel} onClick={() => { onUndo(); dismiss(); }}>
      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
      {undoLabel}
    </ToastAction>
  );

  const t = toast({
    title,
    description,
    action,
    duration,
  });

  // Auto-dismiss after duration if not already dismissed
  setTimeout(() => {
    if (!dismissed) t.dismiss();
  }, duration);

  return { dismiss: t.dismiss, id: t.id };
}

/**
 * React hook for showing undo toasts.
 * Prefer this over calling `showUndoToast` directly for component-scoped cleanup.
 */
export function useUndoToast() {
  return { showUndoToast };
}