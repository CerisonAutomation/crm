"use client";

// E14 one-dialog principle — zustand react binding over the pure invariant core.
//
// Headless by design (vitest runs in node without DOM): a zustand *vanilla*
// store whose transitions delegate ENTIRELY to src/lib/dialog.ts pure
// functions (createDialogState/openDialog/closeDialog). No duplicated logic
// lives here — this file only holds the store shell so tests drive it via
// `useDialogStore.getState()` with no rendering. The optional `useDialog`
// React hook below is a thin selector layer for components.

import { createStore } from "zustand/vanilla";
import {
  closeDialog,
  createDialogState,
  openDialog,
  type ActiveDialog,
} from "@/lib/dialog";

export type DialogStoreState = {
  /** Currently visible dialog, or null when the screen is clear. */
  active: ActiveDialog | null;
  /** Ids superseded by replacement, oldest-first (C11 receipt log). */
  superseded: string[];
  /** Receipt of the most recent open: the id it replaced, or null. */
  replaced: string | null;
  /** Open `id`; returns the replaced id (null when nothing was superseded). */
  open: (id: string, nowMs?: number) => string | null;
  /** Close `id`; returns false when `id` is stale (never kills the screen). */
  close: (id: string) => boolean;
  /** Test/reset helper: return to the empty dialog state. */
  reset: () => void;
};

function nowMs(): number {
  return Date.now();
}

export const useDialogStore = createStore<DialogStoreState>()((set) => ({
  ...createDialogState(),
  replaced: null,

  open: (id, now = nowMs()) => {
    let receipt: string | null = null;
    set((s) => {
      const { state, replaced } = openDialog(
        { active: s.active, superseded: s.superseded },
        id,
        now
      );
      receipt = replaced;
      return { active: state.active, superseded: state.superseded, replaced };
    });
    return receipt;
  },

  close: (id) => {
    let closed = false;
    set((s) => {
      const { state, closed: didClose } = closeDialog(
        { active: s.active, superseded: s.superseded },
        id
      );
      closed = didClose;
      // Stale close: return current slice untouched (no state churn).
      if (!didClose) return s;
      return { active: state.active };
    });
    return closed;
  },

  reset: () => set({ ...createDialogState(), replaced: null }),
}));

/** Selector helper for components: subscribe to the active dialog only. */
export function selectActiveDialog(s: DialogStoreState): ActiveDialog | null {
  return s.active;
}
