// E14 one-dialog principle — single-active dialog controller (pure, Prisma-free).
//
// Only one dialog may hold the screen at a time (focus-trap + Esc live in
// src/components/brand/focus-trap.tsx; confirm/typed-confirm live beside it).
// Opening a second dialog REPLACES the first and receipts what it superseded
// (C11) so the handoff is auditable instead of silently stacked. Stale closes
// (an id that is no longer active) are ignored — a late async close must never
// kill the dialog the user is looking at.
//
// Framework-free on purpose: the zustand/react binding reads this state;
// the invariant itself stays unit-testable in node.

export type ActiveDialog = { id: string; openedAtMs: number };

export type DialogState = {
  active: ActiveDialog | null;
  /** Ids superseded by replacement, oldest-first (bounded by caller retention). */
  superseded: string[];
};

export function createDialogState(): DialogState {
  return { active: null, superseded: [] };
}

/** Open `id`. Replaces any active dialog and receipts the replaced id (if any). */
export function openDialog(
  state: DialogState,
  id: string,
  nowMs: number
): { state: DialogState; replaced: string | null } {
  if (!id) throw new Error("dialog id is required");
  const replaced =
    state.active && state.active.id !== id ? state.active.id : null;
  return {
    state: {
      active: { id, openedAtMs: nowMs },
      superseded: replaced ? [...state.superseded, replaced] : state.superseded,
    },
    replaced,
  };
}

/** Close `id`. Returns closed:false when `id` is not the active dialog (stale). */
export function closeDialog(
  state: DialogState,
  id: string
): { state: DialogState; closed: boolean } {
  if (!state.active || state.active.id !== id) return { state, closed: false };
  return {
    state: { active: null, superseded: state.superseded },
    closed: true,
  };
}

/** Invariant check for tests and the react binding: at most one active dialog. */
export function singleActiveInvariant(state: DialogState): boolean {
  return state.active === null || typeof state.active.id === "string";
}
