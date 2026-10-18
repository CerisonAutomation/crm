import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { webcalUrl } from "@/lib/integrations/calendar-links";
import { calendarFeedPath, calendarFeedToken, collectFeedEvents } from "@/lib/services/calendar-feed";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar — the caller's calendar integration hub:
 * the signed, expiring subscribe URL (`webcal://` for Apple Calendar/macOS,
 * http(s) for Google/Outlook/CalDAV) plus a preview of upcoming dates.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const [events, token] = [await collectFeedEvents(ctx.userId), calendarFeedToken(ctx.userId)];
    const origin = new URL(r.url).origin;
    const path = token ? calendarFeedPath(ctx.userId, token) : null;
    const httpUrl = path ? `${origin}${path}` : null;

    return jsonOk({
      eventCount: events.length,
      upcoming: events.slice(0, 20).map((e) => ({
        uid: e.uid,
        title: e.title,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        location: e.location ?? null,
      })),
      // Null when AUTH_SECRET is unconfigured — the token scheme fails closed.
      feed: httpUrl
        ? { token, path, httpUrl, webcalUrl: webcalUrl(httpUrl), ttlDays: 14 }
        : null,
    });
  })(req);
}
