"use client";

/**
 * Keyboard shortcut system.
 *
 * Provides a declarative way to register global keyboard shortcuts.
 * Shortcuts are registered via a context provider and can be scoped
 * to specific views. Supports modifier keys (Ctrl, Alt, Shift, Meta).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  handler: (e: KeyboardEvent) => void;
  description?: string;
  disabled?: boolean;
}

interface ShortcutContextValue {
  register: (shortcut: Shortcut) => () => void;
  shortcuts: Shortcut[];
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function useShortcuts() {
  const ctx = useContext(ShortcutContext);
  if (!ctx) throw new Error("useShortcuts must be used within ShortcutProvider");
  return ctx;
}

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);

  const register = useCallback((shortcut: Shortcut) => {
    setShortcuts((prev) => [...prev, shortcut]);
    return () => {
      setShortcuts((prev) => prev.filter((s) => s !== shortcut));
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const s of shortcuts) {
        if (s.disabled) continue;
        const keyMatch = e.key.toLowerCase() === s.key.toLowerCase();
        const ctrlMatch = !!s.ctrl === (e.ctrlKey || e.metaKey);
        const altMatch = !!s.alt === e.altKey;
        const shiftMatch = !!s.shift === e.shiftKey;
        const metaMatch = !!s.meta === e.metaKey;
        if (keyMatch && ctrlMatch && altMatch && shiftMatch && metaMatch) {
          e.preventDefault();
          s.handler(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);

  const value = useMemo(() => ({ register, shortcuts }), [register, shortcuts]);
  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}

/**
 * Hook to register a single shortcut.
 * Automatically cleans up on unmount.
 */
export function useKeyboardShortcut(shortcut: Shortcut) {
  const { register } = useShortcuts();
  useEffect(() => register(shortcut), [register, shortcut]);
}
