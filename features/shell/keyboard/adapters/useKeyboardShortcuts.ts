"use client";

/**
 * Keyboard Shortcuts Adapter (§H H2: the adapter implements the port contract)
 *
 * Binds the pure domain matcher to React's event system. This is the only
 * place in the keyboard feature where React imports are allowed.
 */

import { useEffect, useRef } from "react";
import {
  DEFAULT_SHORTCUTS,
  resolveShortcut,
  type ShortcutDefinition,
  type ShortcutMatch,
} from "../domain/shortcuts";

export interface ShortcutAction {
  /** Runs when the shortcut fires. */
  handler: () => void;
  /** When false the shortcut is registered but inert (e.g. role cannot open it). */
  enabled?: boolean;
}

export interface UseKeyboardShortcutsOptions {
  /** Custom registry (defaults to DEFAULT_SHORTCUTS). */
  shortcuts?: ShortcutDefinition[];
  /** Map of shortcut id → action. */
  actions: Record<string, ShortcutAction>;
  /** Master switch. */
  enabled?: boolean;
  /** Fired after a shortcut runs (telemetry / tests). */
  onShortcutTriggered?: (match: ShortcutMatch) => void;
}

/** How long a sequence prefix (\"g\") stays armed before it resets. */
const SEQUENCE_TIMEOUT_MS = 1200;

/**
 * Global keyboard-shortcut listener. One instance per app shell.
 *
 * The listener is attached once (keyed on `enabled`); the registry and actions
 * are read through a ref so re-renders never re-bind the window listener.
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const { shortcuts = DEFAULT_SHORTCUTS, actions, enabled = true, onShortcutTriggered } = options;

  const bufferRef = useRef("");
  const bufferTimeRef = useRef(0);
  const stateRef = useRef({ shortcuts, actions, onShortcutTriggered });

  useEffect(() => {
    stateRef.current = { shortcuts, actions, onShortcutTriggered };
  }, [shortcuts, actions, onShortcutTriggered]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Another handler (Radix overlay, palette) already claimed this key.
      if (event.defaultPrevented) return;
      // Bare modifier presses only arm the next key — never match on their own.
      if (event.key === "Control" || event.key === "Meta" || event.key === "Shift" || event.key === "Alt") {
        return;
      }

      const { shortcuts, actions, onShortcutTriggered } = stateRef.current;
      const now = Date.now();
      const buffer = now - bufferTimeRef.current > SEQUENCE_TIMEOUT_MS ? "" : bufferRef.current;
      const result = resolveShortcut(shortcuts, buffer, event);

      if (result.type === "match") {
        bufferRef.current = "";
        bufferTimeRef.current = 0;
        const action = actions[result.match.shortcut.id];
        if (action && action.enabled !== false) {
          event.preventDefault();
          action.handler();
          onShortcutTriggered?.(result.match);
        }
        return;
      }

      if (result.type === "pending") {
        bufferRef.current = result.buffer;
        bufferTimeRef.current = now;
        return;
      }

      bufferRef.current = "";
      bufferTimeRef.current = 0;
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/** True on Apple platforms — used to render ⌘ instead of Ctrl. */
export function isMacPlatform(): boolean {
  if (globalThis.navigator === undefined) return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
