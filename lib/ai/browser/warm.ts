"use client";

/**
 * Background chat warm-up scheduler - the app-shell mount calls this once.
 *
 * requestIdleCallback (with a bounded timeout so a busy main thread still
 * warms) schedules warmChat from ./cascade; setTimeout is the fallback where
 * requestIdleCallback does not exist. Consent, budget and cache guards live
 * inside warmChat, progress stays silent, and cancel() aborts both the
 * pending idle callback and an in-flight download.
 *
 * Prisma-free and window-guarded at call time (never at import), so unit
 * specs can inject a fake scheduler and fake warm.
 */

import { warmChat, type ChatWarmOutcome } from "./cascade";

/** Beacon states for the shell status surface (aria-live, visually hidden). */
export type ChatWarmState =
  | "idle"
  | "warming"
  | "cached"
  | "ready"
  | "unavailable";

export type IdleScheduler = (
  cb: () => void,
  opts?: { timeout: number }
) => number | unknown;

export type IdleCanceller = (handle: number | unknown) => void;

export type ScheduleIdleChatWarmOpts = {
  idleTimeoutMs?: number;
  onState?: (state: ChatWarmState) => void;
  onProgress?: (progress: number) => void;
  schedule?: IdleScheduler;
  cancelSchedule?: IdleCanceller;
  runWarm?: typeof warmChat;
};

const FALLBACK_DELAY_MS = 1500;

const defaultSchedule: IdleScheduler = (cb, opts) => {
  const timeout =
    opts && typeof opts.timeout === "number" ? opts.timeout : 2000;
  try {
    const w =
      globalThis.window !== undefined
        ? (window as unknown as {
            requestIdleCallback?: (
              c: () => void,
              o?: { timeout: number }
            ) => number;
          })
        : null;
    const ric = w ? w.requestIdleCallback : undefined;
    if (typeof ric === "function") return ric(cb, { timeout });
    if (globalThis.window !== undefined)
      return window.setTimeout(cb, FALLBACK_DELAY_MS);
  } catch {
    void 0;
  }
  return setTimeout(cb, FALLBACK_DELAY_MS);
};

function defaultCancel(handle: number | unknown): void {
  try {
    const w =
      globalThis.window !== undefined
        ? (window as unknown as { cancelIdleCallback?: (h: number) => void })
        : null;
    if (
      w &&
      typeof w.cancelIdleCallback === "function" &&
      typeof handle === "number"
    ) {
      w.cancelIdleCallback.call(w, handle);
      return;
    }
    if (
      globalThis.window !== undefined &&
      (typeof handle === "number" ||
        (typeof handle === "object" && handle !== null))
    ) {
      window.clearTimeout(handle as number);
      return;
    }
  } catch {
    void 0;
  }
  try {
    clearTimeout(handle as unknown as number);
  } catch {
    void 0;
  }
}

function emit(
  onState: ((s: ChatWarmState) => void) | undefined,
  s: ChatWarmState
): void {
  try {
    if (onState) onState(s);
  } catch {
    void 0;
  }
}

const OUTCOME_TO_STATE: Record<ChatWarmOutcome, ChatWarmState> = {
  cached: "cached",
  ready: "ready",
  unavailable: "unavailable",
  cancelled: "unavailable",
  "skipped-no-consent": "unavailable",
  "skipped-over-budget": "unavailable",
};

/**
 * Schedule one background chat warm during idle. Returns cancel() plus a
 * settled promise that always resolves (never rejects) with the outcome.
 */
export function scheduleIdleChatWarm(opts?: ScheduleIdleChatWarmOpts): {
  cancel: () => void;
  settled: Promise<ChatWarmOutcome>;
} {
  const idleTimeoutMs =
    opts && typeof opts.idleTimeoutMs === "number" ? opts.idleTimeoutMs : 2000;
  const doSchedule = opts && opts.schedule ? opts.schedule : defaultSchedule;
  const doCancelSchedule =
    opts && opts.cancelSchedule ? opts.cancelSchedule : defaultCancel;
  const run = opts && opts.runWarm ? opts.runWarm : warmChat;
  const sinkState = opts && opts.onState ? opts.onState : undefined;
  const sinkProgress = opts && opts.onProgress ? opts.onProgress : undefined;
  const inner = new AbortController();
  let cancelWarm: (() => void) | null = null;
  let fired = false;
  let handle: number | unknown | null = null;
  let resolveSettled: (o: ChatWarmOutcome) => void = () => undefined;
  const settled = new Promise<ChatWarmOutcome>((resolve) => {
    resolveSettled = resolve;
  });
  const cancel = (): void => {
    try {
      if (!fired && handle !== null) {
        try {
          doCancelSchedule(handle);
        } catch {
          void 0;
        }
        handle = null;
      }
      try {
        if (cancelWarm) cancelWarm();
      } catch {
        void 0;
      }
      try {
        inner.abort();
      } catch {
        void 0;
      }
      if (!fired) {
        fired = true;
        emit(sinkState, "unavailable");
        resolveSettled("cancelled");
      }
    } catch {
      void 0;
    }
  };
  try {
    handle = doSchedule(
      () => {
        fired = true;
        handle = null;
        if (inner.signal.aborted) {
          emit(sinkState, "unavailable");
          resolveSettled("cancelled");
          return;
        }
        emit(sinkState, "warming");
        try {
          cancelWarm = run({
            signal: inner.signal,
            onProgress: sinkProgress,
            onSettled: (outcome) => {
              emit(sinkState, OUTCOME_TO_STATE[outcome]);
              resolveSettled(outcome);
            },
          });
        } catch {
          emit(sinkState, "unavailable");
          resolveSettled("unavailable");
        }
      },
      { timeout: idleTimeoutMs }
    );
  } catch {
    emit(sinkState, "unavailable");
    resolveSettled("unavailable");
  }
  return { cancel, settled };
}
