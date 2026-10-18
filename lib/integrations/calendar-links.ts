/**
 * Add-to-calendar deep links — pure, client-safe, zero-dependency.
 *
 * H A R V E S T E D  from verified sources (not invented):
 *  · Google / Outlook / Yahoo URL formats: the community-reverse-engineered
 *    specs in `InteractionDesignFoundation/add-event-to-calendar-docs`
 *    (services/google.md, outlook-web.md, yahoo.md — last verified 2026-08).
 *  · Service matrix (Google, Outlook, Office 365, Yahoo, iCal, webcal) mirrored
 *    from `spatie/calendar-links`.
 *
 * Key verified facts encoded here:
 *  · Google uses `…/calendar/render?action=TEMPLATE` (the `render` form is the
 *    only one that reaches the event editor on Android) and needs BOTH dates as
 *    `YYYYMMDDTHHmmSSZ` — the pair is treated as UTC only when both carry `Z`.
 *  · Outlook uses `…/calendar/deeplink/compose?path=/calendar/action/compose&rru=addevent`
 *    with ISO-8601 UTC `startdt`/`enddt`.
 *  · Yahoo uses `calendar.yahoo.com?v=60` with `TITLE/ST/ET` and LOCAL time —
 *    its documented behaviour is that a trailing `Z` is NOT honoured, so we
 *    deliberately emit local stamps.
 *  · Apple Calendar & other RFC-5545 clients consume an `.ics` (download) or a
 *    `webcal://` subscription URL — no query-param deep link exists.
 */

export type CalendarEvent = {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  /** IANA timezone (e.g. "Europe/Zurich"). Google honours this via `ctz`. */
  timeZone?: string;
  /** Absolute URL of the event page, folded into the description where useful. */
  url?: string;
};

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Google compact UTC stamp: `YYYYMMDDTHHMMSSZ`. */
export function toGoogleStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Compact LOCAL stamp (no `Z`) — Yahoo stores the value verbatim. */
export function toLocalStamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** Outlook ISO-8601 UTC stamp: `YYYY-MM-DDTHH:mm:ssZ`. */
export function toOutlookStamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Google Calendar "add event" link (works on desktop, iOS and Android). */
export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toGoogleStamp(event.start)}/${toGoogleStamp(event.end)}`,
  });
  if (event.description) params.set("details", event.description);
  if (event.location) params.set("location", event.location);
  if (event.timeZone) params.set("ctz", event.timeZone);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook Web "compose" deep link — `live` (outlook.live.com) or `office365`. */
export function outlookCalendarUrl(event: CalendarEvent, host: "live" | "office365" = "live"): string {
  const base =
    host === "office365"
      ? "https://outlook.office.com/calendar/deeplink/compose"
      : "https://outlook.live.com/calendar/deeplink/compose";
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    startdt: toOutlookStamp(event.start),
    enddt: toOutlookStamp(event.end),
    subject: event.title,
  });
  if (event.description) params.set("body", event.description);
  if (event.location) params.set("location", event.location);
  return `${base}?${params.toString()}`;
}

/** Yahoo Calendar link (local time by design — see the header note). */
export function yahooCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    v: "60",
    TITLE: event.title,
    ST: toLocalStamp(event.start),
    ET: toLocalStamp(event.end),
  });
  if (event.description) params.set("DESC", event.description);
  if (event.location) params.set("in_loc", event.location);
  return `https://calendar.yahoo.com/?${params.toString()}`;
}

/** Inline `.ics` payload as a data URI (used for "download .ics" without a route hit). */
export function icsDataUri(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

/** `webcal://` subscription form of an http(s) URL (Apple Calendar, Outlook, Google). */
export function webcalUrl(httpUrl: string): string {
  return httpUrl.replace(/^https?:\/\//i, "webcal://");
}

export type CalendarLinkSet = {
  google: string;
  outlook: string;
  office365: string;
  yahoo: string;
};

/** Every provider deep link for one event. */
export function calendarLinks(event: CalendarEvent): CalendarLinkSet {
  return {
    google: googleCalendarUrl(event),
    outlook: outlookCalendarUrl(event, "live"),
    office365: outlookCalendarUrl(event, "office365"),
    yahoo: yahooCalendarUrl(event),
  };
}
