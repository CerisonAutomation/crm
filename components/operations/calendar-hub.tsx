"use client";

import { useEffect, useState } from "react";
import { ApiError, get } from "@/lib/api-client";

type CalendarHubResponse = { eventCount: number; upcoming: Array<{ uid: string; title: string; start: string; end: string; location: string | null }>; feed: { httpUrl: string; webcalUrl: string; ttlDays: number } | null };

export function CalendarHub() {
  const [data, setData] = useState<CalendarHubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { get<CalendarHubResponse>("/api/calendar").then(setData).catch((reason: unknown) => setError(reason instanceof ApiError ? reason.message : "Calendar information could not be loaded.")); }, []);
  return <section className="rounded-lg border bg-card p-5 shadow-sm"><p className="text-sm font-medium text-primary">Calendar</p><h2 className="mt-1 text-xl font-semibold">Your confirmed schedule</h2>{error && <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}{!data && !error && <p className="mt-4 text-sm text-muted-foreground" role="status">Loading calendar…</p>}{data && <><p className="mt-2 text-sm text-muted-foreground">{data.eventCount} upcoming event{data.eventCount === 1 ? "" : "s"} are available to your signed calendar feed.</p>{data.feed ? <div className="mt-4 flex flex-wrap gap-2"><a className="min-h-10 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" href={data.feed.webcalUrl}>Subscribe in calendar</a><a className="min-h-10 rounded-md border px-3 py-2 text-sm font-medium" href={data.feed.httpUrl}>Open ICS feed</a></div> : <p className="mt-4 text-sm text-muted-foreground">Calendar subscription is unavailable until the signing secret is configured.</p>}<div className="mt-5 divide-y">{data.upcoming.map((event) => <article className="py-3" key={event.uid}><p className="font-medium">{event.title}</p><p className="mt-1 text-sm text-muted-foreground">{new Date(event.start).toLocaleString()}{event.location ? ` · ${event.location}` : ""}</p></article>)}{data.upcoming.length === 0 && <p className="py-5 text-sm text-muted-foreground">No upcoming events.</p>}</div></>}</section>;
}
