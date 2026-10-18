import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events — a long-lived `text/event-stream` the client subscribes to
 * with `EventSource`, so the UI updates WITHOUT polling. The stream itself polls
 * the database on a short interval and PUSHES a `notifications` frame only when
 * the caller's unread set actually changes, so the client holds no timer and the
 * browser sees new activity the moment the next server tick observes it.
 *
 * Deliberately NOT wrapped in `handler()`: that helper builds a normal
 * request/response and would buffer the stream. The route authenticates with
 * `requireAuth` and re-asserts same-origin, then hands back a streaming
 * `Response` directly (see HANDLER_EXEMPT in tests/route-surface.test.ts).
 *
 * A bounded lifetime (MAX_MS) closes the stream so a proxy cannot hold it open
 * forever; the client's EventSource reconnects automatically on close.
 */
const POLL_MS = 5_000;
const HEARTBEAT_MS = 25_000;
const MAX_MS = 5 * 60 * 1000;

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest) {
  const ctx = await requireAuth(req);
  assertSameOrigin(req);

  const encoder = new TextEncoder();
  let closed = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  let hardStop: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame(event, data)));
        } catch {
          /* controller already closed */
        }
      };

      let lastUnread = -1;
      let lastTopId: string | null = null;

      const tick = async () => {
        try {
          const [unread, top] = await Promise.all([
            db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
            db.notification.findFirst({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, select: { id: true } }),
          ]);
          const topId = top?.id ?? null;
          if (unread !== lastUnread || topId !== lastTopId) {
            lastUnread = unread;
            lastTopId = topId;
            send("notifications", { unread, latestId: topId, at: Date.now() });
          }
        } catch {
          /* transient DB error — the next tick retries */
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (poll) clearInterval(poll);
        if (beat) clearInterval(beat);
        if (hardStop) clearTimeout(hardStop);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Tell the client it is connected, then push the current state immediately.
      send("ready", { userId: ctx.userId, at: Date.now() });
      await tick();

      poll = setInterval(() => void tick(), POLL_MS);
      beat = setInterval(() => send("heartbeat", { at: Date.now() }), HEARTBEAT_MS);
      hardStop = setTimeout(() => {
        send("reconnect", { reason: "max lifetime reached" });
        close();
      }, MAX_MS);

      req.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (poll) clearInterval(poll);
      if (beat) clearInterval(beat);
      if (hardStop) clearTimeout(hardStop);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx / some serverless edges) so frames flush.
      "X-Accel-Buffering": "no",
    },
  });
}
