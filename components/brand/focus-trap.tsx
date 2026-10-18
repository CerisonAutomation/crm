"use client";

/**
 * Focus trap for modals and dialogs.
 *
 * Traps keyboard focus within a container when active, cycling through
 * focusable elements on Tab/Shift+Tab. Essential for accessibility in
 * modal dialogs, drawers, and overlays.
 */

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function FocusTrap({
  active = true,
  children,
  className,
  onEscape,
}: {
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  /** Called on Escape (after preventDefault) — the caller decides: close, minimise, or ignore. */
  onEscape?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus management. Keyed on `active` alone on purpose: re-running this on
  // every parent render would yank focus back to the first element mid-typing.
  useEffect(() => {
    if (!active || !ref.current) return;

    const container = ref.current;
    // Return focus to whatever held it before the trap opened (B2/B3).
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable.length === 0) {
      // Dead-trap decision: a dialog with no tabbable child would strand
      // keyboard users outside it — focus the container itself instead.
      container.tabIndex = -1;
      container.focus({ preventScroll: true });
    } else {
      // Focus first element on mount
      focusable[0].focus();
    }

    return () => {
      const opener = previouslyFocused.current;
      previouslyFocused.current = null;
      // Restore the opener's focus so keyboard users are not stranded.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [active]);

  // Key handling. `onEscape` is a real dependency instead of a latest-ref: this
  // effect has no focus side effects, so re-binding the listener is free.
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onEscape) {
          e.preventDefault();
          onEscape();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const items = container.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener("keydown", handler);
    return () => container.removeEventListener("keydown", handler);
  }, [active, onEscape]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
