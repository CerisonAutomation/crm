"use client";
/**
 * useLiveEvents — subscribe to the server-pushed SSE stream (`/api/events/stream`).
 *
 * The platform used to poll the notification endpoint on a timer; this hook
 * makes updates server-pushed instead. The caller passes a named-event handler
 * map and a poll fallback:
 *
 *   useLiveEvents({ notifications: () => void refresh() });
 *
 * `EventSource` authenticates with the session COOKIE only — it cannot attach the
 * bearer token used in the cross-origin iframe preview — so when the stream
 * cannot connect (or the browser lacks EventSource) the hook simply does nothing
 * and the caller's existing poll keeps working. It never throws and never
 * surfaces an error into the UI: liveness is an enhancement, not a dependency.
 *
 * The handlers map lives in a ref that is refreshed every render, while the
 * listeners are registered ONCE per event name against stable wrappers that
 * delegate to `handlersRef.current` — so a caller can pass freshly-created
 * closures without tearing down (and re-joining) the stream, and never misses
 * an update to a handler. A handler named `ready` is not registered as a
 * listener: the server pushes it once on connect, which the `open` handler
 * already surfaces (registering both would fire it twice).
 */
import { useEffect, useRef } from "react";

export function useLiveEvents(handlers: Record<string, (data: unknown) => void>, enabled = true): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    if (globalThis.window === undefined || typeof EventSource === "undefined") return;

    let source: EventSource | null = null;
    try {
      source = new EventSource("/api/events/stream");
    } catch {
      return;
    }

    const onOpen = () => {
      // The server pushes the current state on connect; a handler named "ready"
      // (if provided) lets the caller refresh immediately too.
      handlersRef.current.ready?.({});
    };
    const listeners: Array<[string, EventListener]> = [];
    for (const event of Object.keys(handlersRef.current)) {
      if (event === "ready") continue; // fired by onOpen only — see above.
      const listener: EventListener = (e) => {
        const raw = (e as MessageEvent).data;
        let data: unknown = raw;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          /* keep the raw string */
        }
        handlersRef.current[event]?.(data);
      };
      source.addEventListener(event, listener);
      listeners.push([event, listener]);
    }
    source.addEventListener("open", onOpen);
    // On error the browser retries on its own; we keep the poll fallback in the
    // caller, so no explicit reconnect is needed here.
    source.onerror = () => undefined;

    return () => {
      for (const [event, listener] of listeners) source?.removeEventListener(event, listener);
      source?.removeEventListener("open", onOpen);
      source?.close();
      source = null;
    };
    // Handlers are re-created each render by the caller and read through the
    // ref, so keying on `enabled` avoids tearing down and reconnecting the
    // stream on every render.
     
  }, [enabled]);
}
