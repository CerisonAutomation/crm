import { describe, expect, it } from "bun:test";
import {
	type AvailabilityRules,
	BookingRuleError,
	bookingsConflict,
	computeDaySlots,
	validateBookingRules,
} from "../src/booking/booking-availability";

const TALLINN = "Europe/Tallinn";

function at(iso: string): Date {
	return new Date(iso);
}

const nineToFive: AvailabilityRules = {
	windows: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
};

describe("validateBookingRules", () => {
	it("rejects out-of-range durations", () => {
		expect(() => validateBookingRules(2, 0, nineToFive)).toThrow(
			BookingRuleError,
		);
		expect(() => validateBookingRules(30, -1, nineToFive)).toThrow(
			BookingRuleError,
		);
	});

	it("rejects malformed windows", () => {
		expect(() =>
			validateBookingRules(30, 0, {
				windows: [{ weekday: 9, startMinute: 0, endMinute: 60 }],
			}),
		).toThrow(BookingRuleError);
		expect(() =>
			validateBookingRules(30, 0, {
				windows: [{ weekday: 1, startMinute: 600, endMinute: 600 }],
			}),
		).toThrow(BookingRuleError);
	});
});

describe("computeDaySlots", () => {
	it("packs slots inside the window with the requested duration", () => {
		const monday = at("2026-10-19T00:00:00Z");
		const slots = computeDaySlots({
			day: monday,
			durationMinutes: 60,
			bufferMinutes: 0,
			timezone: TALLINN,
			rules: nineToFive,
			existing: [],
			notBefore: at("2026-10-01T00:00:00Z"),
		});
		expect(slots.length).toBe(8);
		expect(slots[0]?.startsAt.toISOString()).toBe("2026-10-19T06:00:00.000Z");
		expect(slots[0]?.endsAt.toISOString()).toBe("2026-10-19T07:00:00.000Z");
		expect(slots[7]?.endsAt.toISOString()).toBe("2026-10-19T14:00:00.000Z");
	});

	it("steps by duration plus buffer", () => {
		const monday = at("2026-10-19T00:00:00Z");
		const slots = computeDaySlots({
			day: monday,
			durationMinutes: 30,
			bufferMinutes: 15,
			timezone: TALLINN,
			rules: nineToFive,
			existing: [],
			notBefore: at("2026-10-01T00:00:00Z"),
		});
		expect(slots.length).toBe(11);
		expect(slots[0]?.startsAt.toISOString()).toBe("2026-10-19T06:00:00.000Z");
		expect(slots[1]?.startsAt.toISOString()).toBe("2026-10-19T06:45:00.000Z");
	});

	it("excludes existing bookings with buffer margins", () => {
		const monday = at("2026-10-19T00:00:00Z");
		const slots = computeDaySlots({
			day: monday,
			durationMinutes: 60,
			bufferMinutes: 0,
			timezone: TALLINN,
			rules: nineToFive,
			existing: [
				{
					startsAt: at("2026-10-19T08:00:00Z"),
					endsAt: at("2026-10-19T09:00:00Z"),
				},
			],
			notBefore: at("2026-10-01T00:00:00Z"),
		});
		expect(slots.length).toBe(7);
		for (const slot of slots) {
			expect(slot.startsAt.toISOString()).not.toBe("2026-10-19T08:00:00.000Z");
		}
	});

	it("skips excluded weekdays and dates", () => {
		const monday = at("2026-10-19T00:00:00Z");
		const slots = computeDaySlots({
			day: monday,
			durationMinutes: 60,
			bufferMinutes: 0,
			timezone: TALLINN,
			rules: { ...nineToFive, excludedWeekdays: [1] },
			existing: [],
			notBefore: at("2026-10-01T00:00:00Z"),
		});
		expect(slots.length).toBe(0);

		const blackout = computeDaySlots({
			day: monday,
			durationMinutes: 60,
			bufferMinutes: 0,
			timezone: TALLINN,
			rules: { ...nineToFive, excludedDates: ["2026-10-19"] },
			existing: [],
			notBefore: at("2026-10-01T00:00:00Z"),
		});
		expect(blackout.length).toBe(0);
	});

	it("never returns slots before notBefore", () => {
		const monday = at("2026-10-19T00:00:00Z");
		const slots = computeDaySlots({
			day: monday,
			durationMinutes: 60,
			bufferMinutes: 0,
			timezone: TALLINN,
			rules: nineToFive,
			existing: [],
			notBefore: at("2026-10-19T10:30:00Z"),
		});
		for (const slot of slots) {
			expect(slot.startsAt.getTime()).toBeGreaterThanOrEqual(
				at("2026-10-19T10:30:00Z").getTime(),
			);
		}
		expect(slots.length).toBeGreaterThan(0);
	});

	it("is DST-aware across the Tallinn autumn transition", () => {
		// 2026-10-25 is the EU autumn DST change (EEST -> EET at 03:00 UTC).
		const sunday = at("2026-10-25T00:00:00Z");
		const slots = computeDaySlots({
			day: sunday,
			durationMinutes: 60,
			bufferMinutes: 0,
			timezone: TALLINN,
			rules: {
				windows: [{ weekday: 0, startMinute: 2 * 60, endMinute: 6 * 60 }],
			},
			existing: [],
			notBefore: at("2026-10-01T00:00:00Z"),
		});
		// 02:00-06:00 local with the repeated hour: instants must all resolve.
		expect(slots.length).toBeGreaterThan(0);
		const keys = new Set(slots.map((slot) => slot.startsAt.toISOString()));
		expect(keys.size).toBe(slots.length);
	});
});

describe("bookingsConflict", () => {
	it("detects overlaps and honours touching edges", () => {
		expect(
			bookingsConflict(
				{
					startsAt: at("2026-10-19T09:00:00Z"),
					endsAt: at("2026-10-19T10:00:00Z"),
				},
				{
					startsAt: at("2026-10-19T09:30:00Z"),
					endsAt: at("2026-10-19T10:30:00Z"),
				},
			),
		).toBe(true);
		expect(
			bookingsConflict(
				{
					startsAt: at("2026-10-19T09:00:00Z"),
					endsAt: at("2026-10-19T10:00:00Z"),
				},
				{
					startsAt: at("2026-10-19T10:00:00Z"),
					endsAt: at("2026-10-19T11:00:00Z"),
				},
			),
		).toBe(false);
	});
});
