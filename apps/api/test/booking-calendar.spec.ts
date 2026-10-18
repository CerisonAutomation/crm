import { describe, expect, it } from "bun:test";
import {
	BookingCalendarService,
	googleEventBody,
	microsoftEventBody,
	normalizeCalendarProvider,
} from "../src/booking/booking-calendar.service";
import type { FetchLike } from "../src/http/ssrf-safe-fetch";

type Row = Record<string, unknown> & { id: string };

class InMemoryBookingDb {
	accounts: Row[] = [];
	bookings: Row[] = [];

	connectedAccount = {
		findFirst: async ({ where }: { where: Record<string, unknown> }) =>
			this.accounts.find((row) =>
				Object.entries(where).every(([key, value]) => row[key] === value),
			) ?? null,
	};

	booking = {
		findFirst: async ({ where }: { where: { id: string; ownerUserId: string } }) =>
			this.bookings.find((row) => row.id === where.id && row.ownerUserId === where.ownerUserId) ?? null,
		update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
			const row = this.bookings.find((entry) => entry.id === where.id);
			if (!row) throw new Error("unknown booking");
			Object.assign(row, data);
			return row;
		},
	};
}

function fixture(providerAccount: "google-calendar" | "microsoft-calendar") {
	const db = new InMemoryBookingDb();
	db.accounts.push({
		id: "acct-1",
		ownerUserId: "user-1",
		provider: providerAccount,
		status: "active",
		accessToken: "token-123",
	});
	const booking: Row = {
		id: "booking-1",
		ownerUserId: "user-1",
		title: "Demo call",
		notes: "Discuss renewal",
		startsAt: new Date("2026-11-01T10:00:00Z"),
		endsAt: new Date("2026-11-01T10:30:00Z"),
		meetingUrl: null,
		provider: providerAccount === "google-calendar" ? "google" : "microsoft",
		externalEventId: null,
	};
	db.bookings.push(booking);

	const calls: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];
	const fetcher: FetchLike = async (url, init) => {
		calls.push({ url, method: init?.method, headers: init?.headers });
		const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
		const isGoogle = url.includes("googleapis.com");
		const response = isGoogle
			? {
					id: "gcal-event-1",
					hangoutLink: "https://meet.google.com/abc-defg-hij",
					...body,
				}
			: {
					id: "ms-event-1",
					onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/xyz" },
					...body,
				};
		return {
			ok: true,
			status: init?.method === "DELETE" ? 204 : 200,
			statusText: "OK",
			json: async () => response,
			text: async () => JSON.stringify(response),
		};
	};

	const service = new BookingCalendarService(db as never, fetcher);
	return { service, db, booking, calls };
}

describe("calendar provider mapping + event bodies", () => {
	it("maps booking providers to connected-account providers", () => {
		expect(normalizeCalendarProvider("google")).toBe("google-calendar");
		expect(normalizeCalendarProvider("microsoft")).toBe("microsoft-calendar");
		expect(normalizeCalendarProvider("manual")).toBeNull();
	});

	it("builds google and microsoft event payloads with meeting generation", () => {
		const booking = {
			title: "Demo",
			notes: "hi",
			startsAt: new Date("2026-11-01T10:00:00Z"),
			endsAt: new Date("2026-11-01T10:30:00Z"),
			meetingUrl: null,
		};
		const google = googleEventBody(booking);
		expect(google.summary).toBe("Demo");
		expect((google.start as { dateTime: string }).dateTime).toBe("2026-11-01T10:00:00.000Z");
		expect(google.conferenceData).toBeDefined();

		const microsoft = microsoftEventBody(booking);
		expect(microsoft.subject).toBe("Demo");
		expect(microsoft.isOnlineMeeting).toBe(true);
	});
});

describe("BookingCalendarService", () => {
	it("pushes a google booking and persists external id + meeting url", async () => {
		const { service, booking, calls } = fixture("google-calendar");
		const pushed = await service.syncBookingToCalendar("user-1", "booking-1");
		expect(pushed.externalEventId).toBe("gcal-event-1");
		expect(pushed.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
		expect(booking.externalEventId).toBe("gcal-event-1");
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toContain("conferenceDataVersion=1");
		expect(calls[0]?.headers?.authorization).toBe("Bearer token-123");
	});

	it("updates instead of recreating when an external id exists", async () => {
		const { service, booking, calls } = fixture("google-calendar");
		booking.externalEventId = "gcal-existing";
		await service.pushBooking("user-1", booking as never);
		expect(calls[0]?.method).toBe("PATCH");
		expect(calls[0]?.url).toContain("gcal-existing");
	});

	it("pushes a microsoft booking and captures the Teams join url", async () => {
		const { service, booking } = fixture("microsoft-calendar");
		const pushed = await service.pushBooking("user-1", booking as never);
		expect(pushed.externalEventId).toBe("ms-event-1");
		expect(pushed.meetingUrl).toBe("https://teams.microsoft.com/l/meetup-join/xyz");
	});

	it("cancels external events idempotently and no-ops without an external id", async () => {
		const { service, booking, calls } = fixture("google-calendar");
		booking.externalEventId = "gcal-event-1";
		expect(await service.cancelExternal("user-1", booking as never)).toBe(true);
		expect(calls[0]?.method).toBe("DELETE");
		booking.externalEventId = null;
		expect(await service.cancelExternal("user-1", booking as never)).toBe(false);
	});

	it("rejects providers without calendar sync and missing connections", async () => {
		const { service, booking, db } = fixture("google-calendar");
		booking.provider = "manual";
		expect(service.pushBooking("user-1", booking as never)).rejects.toThrow();
		booking.provider = "google";
		db.accounts.length = 0;
		expect(service.pushBooking("user-1", booking as never)).rejects.toThrow();
	});
});
