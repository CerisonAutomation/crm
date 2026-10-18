/**
 * Keyboard Shortcuts Domain (§H H1: pure TS, zero framework imports)
 *
 * The shortcut contract and the pure matching logic that turns a keydown into
 * a resolution. No React, Next.js, or other framework imports are allowed in
 * this module — the React binding lives in ../adapters/useKeyboardShortcuts.
 */

export type ShortcutCategory = "search" | "navigation" | "help";

export interface ShortcutDefinition {
  /** Unique identifier — the key an action handler is registered under. */
  id: string;
  /** English fallback description (the UI copy is translated by the adapter). */
  description: string;
  /** Key combination, e.g. \"/\", \"g+d\", \"mod+enter\", \"?\". */
  keys: string;
  /** Grouping used by the shortcuts help overlay. */
  category: ShortcutCategory;
  /** When true the shortcut is ignored while a text field has focus. */
  disabledInInput?: boolean;
}

export interface ShortcutMatch {
  shortcut: ShortcutDefinition;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type ShortcutResolution =
  | { type: "match"; match: ShortcutMatch }
  | { type: "pending"; buffer: string }
  | { type: "none" };

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: "search",
    description: "Open the command palette",
    keys: "mod+k",
    category: "search",
  },
  {
    id: "nav-home",
    description: "Go to your home",
    keys: "g+h",
    category: "navigation",
    disabledInInput: true,
  },
  {
    id: "nav-cases",
    description: "Go to the case queue",
    keys: "g+c",
    category: "navigation",
    disabledInInput: true,
  },
  {
    id: "nav-crm",
    description: "Go to the CRM",
    keys: "g+r",
    category: "navigation",
    disabledInInput: true,
  },
  {
    id: "nav-teams",
    description: "Go to Teams",
    keys: "g+t",
    category: "navigation",
    disabledInInput: true,
  },
  {
    id: "nav-settings",
    description: "Go to settings",
    keys: "g+s",
    category: "navigation",
    disabledInInput: true,
  },
  {
    id: "help",
    description: "Show keyboard shortcuts",
    keys: "?",
    category: "help",
    disabledInInput: true,
  },
];

/** Modifier prefixes that make a combo a single chord rather than a sequence. */
const MODIFIER_PREFIX = /^(mod|ctrl|cmd|command|meta|shift|alt)\\+/i;

/** Normalize a combo for comparison (case, whitespace, common aliases). */
export function normalizeKeyCombo(combo: string): string {
  return combo
    .toLowerCase()
    .replace(/\\s+/g, "")
    .replace(/command/g, "meta")
    .replace(/cmd/g, "meta")
    .replace(/ctrl/g, "control")
    .replace(/del/g, "delete")
    .replace(/esc/g, "escape");
}

/** Split a combo into its final key and whether it needs Ctrl/Cmd. */
export function parseKeyCombo(combo: string): {
  key: string;
  requiresModifier: boolean;
} {
  const parts = normalizeKeyCombo(combo).split("+");
  return { key: parts[parts.length - 1], requiresModifier: parts.length > 1 };
}

/** True when a combo is a chord (modifier + key) rather than a key sequence. */
export function isChord(combo: string): boolean {
  return MODIFIER_PREFIX.test(normalizeKeyCombo(combo));
}

/** True when a combo is a multi-key sequence such as \"g+d\". */
export function isSequence(combo: string): boolean {
  const normalized = normalizeKeyCombo(combo);
  return normalized.includes("+") && !isChord(normalized);
}

/** True when the event target is a text-entry surface. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable === true
  );
}

function toMatch(
  shortcut: ShortcutDefinition,
  event: KeyboardEvent,
  key: string,
): ShortcutMatch {
  return {
    shortcut,
    key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  };
}

/**
 * Resolve a keydown against the shortcut registry.
 *
 * `buffer` is the pending sequence prefix from the previous keypress (\"\" when
 * none). Returns a match, a new pending buffer, or nothing.
 */
export function resolveShortcut(
  shortcuts: ShortcutDefinition[],
  buffer: string,
  event: KeyboardEvent,
): ShortcutResolution {
  const editable = isEditableTarget(event.target);
  const key = event.key.toLowerCase();
  const hasMod = event.ctrlKey || event.metaKey;
  const hasAlt = event.altKey;
  const allowed = (s: ShortcutDefinition) => !(s.disabledInInput && editable);

  // 1. Continue an in-flight sequence first — \"g\" then \"c\" must beat the
  //    single-key \"c\" binding.
  if (buffer && !hasMod && !hasAlt) {
    const candidate = `${buffer}+${key}`;
    const hit = shortcuts.find(
      (s) =>
        allowed(s) &&
        isSequence(s.keys) &&
        normalizeKeyCombo(s.keys) === candidate,
    );
    if (hit) return { type: "match", match: toMatch(hit, event, key) };
  }

  // 2. Direct match — chords (modifier + key) and single keys.
  for (const s of shortcuts) {
    if (!allowed(s) || isSequence(s.keys)) continue;
    const { key: comboKey, requiresModifier } = parseKeyCombo(s.keys);
    if (comboKey !== key || requiresModifier !== hasMod) continue;
    return { type: "match", match: toMatch(s, event, key) };
  }

  // 3. Start a sequence when this key prefixes one.
  if (!hasMod && !hasAlt) {
    const startsSequence = shortcuts.some(
      (s) =>
        allowed(s) &&
        isSequence(s.keys) &&
        normalizeKeyCombo(s.keys).startsWith(`${key}+`),
    );
    if (startsSequence) return { type: "pending", buffer: key };
  }

  return { type: "none" };
}

/** Find a shortcut by its ID. */
export function findShortcutById(
  shortcuts: ShortcutDefinition[],
  id: string,
): ShortcutDefinition | undefined {
  return shortcuts.find((s) => s.id === id);
}

/** Find a shortcut by its key combination. */
export function findShortcutByKeys(
  shortcuts: ShortcutDefinition[],
  keys: string,
): ShortcutDefinition | undefined {
  const normalized = normalizeKeyCombo(keys);
  return shortcuts.find((s) => normalizeKeyCombo(s.keys) === normalized);
}

/** Group shortcuts by category, preserving registry order within each group. */
export function groupShortcutsByCategory(
  shortcuts: ShortcutDefinition[],
): Partial<Record<ShortcutCategory, ShortcutDefinition[]>> {
  const groups: Partial<Record<ShortcutCategory, ShortcutDefinition[]>> = {};
  for (const shortcut of shortcuts) {
    (groups[shortcut.category] ??= []).push(shortcut);
  }
  return groups;
}

function keyLabel(key: string): string {
  if (key === "enter") return "Enter";
  if (key === "escape") return "Esc";
  if (key === "backspace") return "Backspace";
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Format a shortcut for display, e.g. \"⌘ + Enter\", \"G then D\", \"/\".
 * `isMac` is passed in so this module stays free of browser globals.
 */
export function formatShortcutForDisplay(
  shortcut: ShortcutDefinition,
  isMac: boolean,
): string {
  const combo = normalizeKeyCombo(shortcut.keys);
  if (isChord(combo)) {
    const { key } = parseKeyCombo(combo);
    return `${isMac ? "⌘" : "Ctrl"} + ${keyLabel(key)}`;
  }
  if (isSequence(combo)) {
    return combo.split("+").map(keyLabel).join(" then ");
  }
  return keyLabel(combo);
}
