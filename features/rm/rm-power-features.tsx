"use client";
/**
 * RM Power Features — keyboard shortcuts, vitals strip, and decision rail.
 *
 * These are additive enhancements to the RM console that improve the daily
 * workflow without changing the core case management logic.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowRight, Check, Clock, FileText, Keyboard, ShieldCheck, X,
} from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";
import { caseStatusLabel } from "@/lib/domain/states";
import type { CaseProgress } from "@/lib/domain/case-progress";
import { api } from "@/lib/api-client";
import { FocusTrap } from "@/components/brand/focus-trap";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// ── Keyboard Shortcuts ──────────────────────────────────────────────────────

const SHORTCUTS: Array<{ key: string; action: string; description: string }> = [
  { key: "g q", action: "Go to Queue", description: "Navigate back to the case queue" },
  { key: "g c", action: "Go to Case", description: "Open the active case detail" },
  { key: "g d", action: "Go to Documents", description: "Jump to the documents section" },
  { key: "g t", action: "Go to Timeline", description: "Jump to the timeline section" },
  { key: "g m", action: "Go to Messages", description: "Jump to the message composer" },
  { key: "r", action: "Refresh", description: "Reload the current case data" },
  { key: "n", action: "Next Action", description: "Jump to the next best action" },
  // D1: document decisions never ride on bare single keys — Alt is mandatory.
  { key: "Alt+1", action: "Approve", description: "Approve the selected document (with confirmation)" },
  { key: "Alt+2", action: "Request Changes", description: "Request changes on the selected document" },
  { key: "Alt+3", action: "Reject", description: "Reject the selected document (with confirmation)" },
  { key: "Esc", action: "Close Dialog", description: "Close any open dialog" },
];

export function KeyboardShortcutsHelp() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground"
        aria-label="Keyboard shortcuts"
      >
        <Keyboard className="h-4 w-4" />
        <span className="sr-only">Keyboard shortcuts</span>
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rm-shortcuts-title"
        >
          <FocusTrap onEscape={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 id="rm-shortcuts-title" className="text-lg font-semibold text-cobble-ink">Keyboard Shortcuts</h2>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close keyboard shortcuts">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {SHORTCUTS.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4 py-1.5">
                  <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs">
                    {s.key}
                  </kbd>
                  <span className="text-sm text-iron-ink">{s.description}</span>
                </div>
              ))}
            </div>
          </div>
          </FocusTrap>
        </div>
      )}
    </>
  );
}

// ── Vitals Strip ────────────────────────────────────────────────────────────

export function VitalsStrip({ caseId }: { caseId: string }) {
  const [progress, setProgress] = useState<CaseProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.caseProgress(caseId)
      .then((res) => {
        if (!cancelled) setProgress(res.progress);
      })
      .catch(() => {
        if (!cancelled) setProgress(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  if (loading) {
    return (
      <div className="flex items-center gap-4 rounded-md border border-border bg-card p-3">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!progress) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Progress</span>
        <div className="flex items-center gap-2">
          <Progress value={progress.percentage} className="h-2 w-24" />
          <span className="font-medium tabular-nums text-cobble-ink">{progress.percentage}%</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Docs</span>
        <span className="font-medium tabular-nums text-cobble-ink">
          {progress.docsApproved}/{progress.docsRequired}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Pending</span>
        <span className="font-medium tabular-nums text-cobble-ink">{progress.docsPending}</span>
      </div>
      {progress.docsChangesRequested > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Changes</span>
          <span className="font-medium tabular-nums text-amber-ink">{progress.docsChangesRequested}</span>
        </div>
      )}
      {progress.docsRejected > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Rejected</span>
          <span className="font-medium tabular-nums text-danger-ink">{progress.docsRejected}</span>
        </div>
      )}
    </div>
  );
}

// ── Decision Rail ──────────────────────────────────────────────────────────

type DecisionAction = {
  id: string;
  label: string;
  icon: ReactNode;
  variant: "default" | "outline" | "destructive";
  action: () => void;
  disabled?: boolean;
};

export function DecisionRail({ actions }: { actions: DecisionAction[] }) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Quick Actions</span>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <Button
            key={a.id}
            variant={a.variant}
            size="sm"
            onClick={a.action}
            disabled={a.disabled}
          >
            {a.icon}
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ── Hook: useKeyboardShortcuts ────────────────────────────────────────────

export function useKeyboardShortcuts(handlers: Record<string, () => void>) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      // Handle "g" prefix sequences (g q, g c, etc.)
      if (e.key === "g") {
        // Wait for the next key
        const onNextKey = (nextEvent: KeyboardEvent) => {
          document.removeEventListener("keydown", onNextKey);
          const combo = `g ${nextEvent.key.toLowerCase()}`;
          if (handlers[combo]) {
            nextEvent.preventDefault();
            handlers[combo]();
          }
        };
        document.addEventListener("keydown", onNextKey);
        return;
      }

      const digit = e.key === "1" || e.key === "2" || e.key === "3";
      if (digit && !e.altKey) return;
      const lookup = e.altKey && digit ? "alt+" + e.key : e.key.toLowerCase();
      const fn = handlers[lookup];
      if (fn) {
        if (e.altKey && lookup === e.key.toLowerCase()) return;
        e.preventDefault();
        fn();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}