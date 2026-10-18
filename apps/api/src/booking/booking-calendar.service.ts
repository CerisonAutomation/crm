/**
 * Booking ↔ calendar bridge (SeldonFrame booking `provider`/`externalEventId`
 * + google/microsoft calendar blocks, cleaned up).
 *
 * Pushes bookings into Google Calendar / Microsoft Graph as external events
 * and stores the provider event id on `Booking.externalEventId` for two-way
 * reconciliation. Tokens come from `ConnectedAccount` rows
 * (provider "google-calendar" | "microsoft-calendar") — the same connected-
 * account root every channel uses. Requests go through the SSRF guard.
 */

import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { BookingModel, Db } from "@crm/db";

type Booking = BookingModel;
import { InjectDatabase } from "../database/database.constants";
import { ssrfSafeFetch, type FetchLike } from "../http/ssrf-safe-fetch";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";

export type CalendarProviderId = "google-calendar" | "microsoft-calendar";

export type PushedEvent = {
	externalEventId: string;
	meetingUrl: string | null;
	raw: Record<string, unknown>;
};

const PROVIDER_ACCOUNT: Record<string, CalendarProviderId> = {
	google: "google-calendar",
	microsoft: "microsoft-calendar",
	"google-calendar": "google-calendar",
	"microsoft-calendar": "microsoft-calendar",
};

export function normalizeCalendarProvider(provider: string): CalendarProviderId | null {
	return PROVIDER_ACCOUNT[provider] ?? null;
}

export function googleEventBody(booking: {
	title: string;
	notes: string | null;
	startsAt: Date;
	endsAt: Date;
	meetingUrl: string | null;
}): Record<string, unknown> {
	return {
		summary: booking.title,
		description: booking.notes ?? undefined,
		start: { dateTime: booking.startsAt.toISOString(), timeZone: "UTC" },
		end: { dateTime: booking.endsAt.toISOString(), timeZone: "UTC" },
		...(booking.meetingUrl
			? { location: booking.meetingUrl }
			: { conferenceData: { createRequest: { requestId: `booking-${booking.startsAt.getTime()}` } } }),
	};
}

export function microsoftEventBody(booking: {
	title: string;
	notes: string | null;
	startsAt: Date;
	endsAt: Date;
	meetingUrl: string | null;
}): Record<string, unknown> {
	return {
		subject: booking.title,
		body: { contentType: "text", content: booking.notes ?? "" },
		start: { dateTime: booking.startsAt.toISOString(), timeZone: "UTC" },
		end: { dateTime: booking.endsAt.toISOString(), timeZone: "UTC" },
		...(booking.meetingUrl
			? { location: { displayName: booking.meetingUrl } }
			: { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" }),
	};
}

@Injectable()
export class BookingCalendarService {
	private readonly fetcher: FetchLike;

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Optional() @Inject("BOOKING_CALENDAR_FETCHER") fetcher?: FetchLike,
	) {
		this.fetcher = ssrfSafeFetch(fetcher ?? (globalThis.fetch as FetchLike));
	}

	private async connection(ownerUserId: string, provider: CalendarProviderId) {
		const account = await this.db.connectedAccount.findFirst({
			where: { ownerUserId, provider, status: "active" },
			orderBy: { createdAt: "desc" },
		});
		if (!account || !account.accessToken) {
			throw new NotFoundException(`No active ${provider} connection for this user`);
		}
		return account;
	}

	/** Creates or updates the external calendar event for a booking. */
	async pushBooking(ownerUserId: string, booking: Booking): Promise<PushedEvent> {
		const provider = normalizeCalendarProvider(booking.provider);
		if (!provider) {
			throw new WorkflowNonRetryableError(
				`Booking provider ${booking.provider} has no calendar sync (use google/microsoft)`,
			);
		}
		const account = await this.connection(ownerUserId, provider);
		const token = account.accessToken as string;

		if (provider === "google-calendar") {
			const url = booking.externalEventId
				? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(booking.externalEventId)}`
				: "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1";
			const response = await this.fetcher(url, {
				method: booking.externalEventId ? "PATCH" : "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(googleEventBody(booking)),
			});
			const raw = (await response.json()) as Record<string, unknown>;
			if (!response.ok) {
				throw new WorkflowNonRetryableError(
					`google calendar push failed with status ${response.status}: ${JSON.stringify(raw)}`,
				);
			}
			const externalEventId = typeof raw.id === "string" ? raw.id : "";
			if (!externalEventId) throw new WorkflowNonRetryableError("google calendar returned no event id");
			const meetingUrl =
				typeof raw.hangoutLink === "string"
					? raw.hangoutLink
					: typeof raw.location === "string"
						? raw.location
						: booking.meetingUrl;
			return { externalEventId, meetingUrl, raw };
		}

		const url = booking.externalEventId
			? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(booking.externalEventId)}`
			: "https://graph.microsoft.com/v1.0/me/events";
		const response = await this.fetcher(url, {
			method: booking.externalEventId ? "PATCH" : "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(microsoftEventBody(booking)),
		});
		const raw = (await response.json()) as Record<string, unknown>;
		if (!response.ok) {
			throw new WorkflowNonRetryableError(
				`microsoft calendar push failed with status ${response.status}: ${JSON.stringify(raw)}`,
			);
		}
		const externalEventId = typeof raw.id === "string" ? raw.id : "";
		if (!externalEventId) throw new WorkflowNonRetryableError("microsoft graph returned no event id");
		const onlineMeeting = raw.onlineMeeting as { joinUrl?: string } | undefined;
		return {
			externalEventId,
			meetingUrl: onlineMeeting?.joinUrl ?? booking.meetingUrl,
			raw,
		};
	}

	/** Cancels the external event (idempotent: missing external id is a no-op). */
	async cancelExternal(ownerUserId: string, booking: Booking): Promise<boolean> {
		const provider = normalizeCalendarProvider(booking.provider);
		if (!provider || !booking.externalEventId) return false;
		const account = await this.connection(ownerUserId, provider);
		const base =
			provider === "google-calendar"
				? "https://www.googleapis.com/calendar/v3/calendars/primary/events/"
				: "https://graph.microsoft.com/v1.0/me/events/";
		const response = await this.fetcher(`${base}${encodeURIComponent(booking.externalEventId)}`, {
			method: "DELETE",
			headers: { authorization: `Bearer ${account.accessToken as string}` },
		});
		return response.ok || response.status === 410;
	}

	/**
	 * Full push-and-persist: updates the booking row with the external event
	 * id and any provider-generated meeting URL.
	 */
	async syncBookingToCalendar(ownerUserId: string, bookingId: string): Promise<PushedEvent> {
		const booking = await this.db.booking.findFirst({
			where: { id: bookingId, ownerUserId },
		});
		if (!booking) throw new NotFoundException(`No booking ${bookingId}`);

		const pushed = await this.pushBooking(ownerUserId, booking);
		await this.db.booking.update({
			where: { id: booking.id },
			data: {
				externalEventId: pushed.externalEventId,
				meetingUrl: pushed.meetingUrl,
			},
		});
		return pushed;
	}
}
