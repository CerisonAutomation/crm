import { NextRequest } from "next/server";
import { handler } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { buildUserCalendarFeed, verifyCalendarFeedToken } from "@/lib/services/calendar-feed";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar/feed?u=<userId>&token=<token> — the subscribable calendar.
 *
 * Session-free by design: calendar clients (Apple Calendar, Outlook, Google,
 * any CalDAV subscriber) cannot log in, so the request is authenticated by the
 * signed, expiring token instead. It grants read-only access to that one user's
 * dates. `u` is not secret — the HMAC over `calendar-feed:<u>` is.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const url = new URL(r.url);
    const userId = url.searchParams.get("u") ?? "";
    const token = url.searchParams.get("token") ?? "";
    if (!userId || !token || !verifyCalendarFeedToken(userId, token)) {
      throw new DomainError("Invalid or expired calendar link", 403);
    }
    const { ics, count } = await buildUserCalendarFeed(userId);
    return new Response(ics, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="citizen-lane-calendar.ics"',
        "cache-control": "no-store",
        "x-event-count": String(count),
      },
    });
  })(req);
}
