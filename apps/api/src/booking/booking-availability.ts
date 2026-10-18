/**
 * Booking availability engine (pattern harvested from SeldonFrame
 * bookings/appointment-types + Caldiy slot rendering).
 *
 * Pure scheduling math, kept free of I/O so the rules are testable:
 *  - weekly availability windows per weekday (IANA timezone aware),
 *  - duration + buffer packing into slots,
 *  - conflict detection against existing bookings with buffer margins.
 */

export type WeekdayWindow = {
	/** 0 = Sunday … 6 = Saturday, matching Date#getDay. */
	weekday: number;
	/** Minutes from local midnight, inclusive. */
	startMinute: number;
	/** Minutes from local midnight, exclusive. */
	endMinute: number;
};

export type AvailabilityRules = {
	windows: WeekdayWindow[];
	/** Days disabled outright regardless of windows (0-6). */
	excludedWeekdays?: number[];
	/** ISO dates (yyyy-MM-dd in the appointment timezone) that are blacked out. */
	excludedDates?: string[];
};

export type SlotRequest = {
	/** Day to compute slots for, as a Date on any UTC instant within that local day. */
	day: Date;
	durationMinutes: number;
	bufferMinutes: number;
	timezone: string;
	rules: AvailabilityRules;
	/** Existing bookings to exclude (absolute instants). */
	existing: Array<{ startsAt: Date; endsAt: Date }>;
	/** Slots cannot start in the past relative to this instant. */
	notBefore: Date;
};

export type BookingSlot = {
	startsAt: Date;
	endsAt: Date;
};

export class BookingRuleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BookingRuleError";
	}
}

export const MIN_SLOT_MINUTES = 5;
export const MAX_SLOT_MINUTES = 24 * 60;
export const MAX_BUFFER_MINUTES = 24 * 60;

export function validateBookingRules(
	durationMinutes: number,
	bufferMinutes: number,
	rules: AvailabilityRules,
): void {
	if (
		!Number.isInteger(durationMinutes) ||
		durationMinutes < MIN_SLOT_MINUTES ||
		durationMinutes > MAX_SLOT_MINUTES
	) {
		throw new BookingRuleError(
			`durationMinutes must be an integer between ${MIN_SLOT_MINUTES} and ${MAX_SLOT_MINUTES}`,
		);
	}
	if (
		!Number.isInteger(bufferMinutes) ||
		bufferMinutes < 0 ||
		bufferMinutes > MAX_BUFFER_MINUTES
	) {
		throw new BookingRuleError(
			`bufferMinutes must be an integer between 0 and ${MAX_BUFFER_MINUTES}`,
		);
	}
	for (const window of rules.windows) {
		if (
			!Number.isInteger(window.weekday) ||
			window.weekday < 0 ||
			window.weekday > 6
		) {
			throw new BookingRuleError(`weekday ${window.weekday} is outside 0-6`);
		}
		if (
			!Number.isInteger(window.startMinute) ||
			!Number.isInteger(window.endMinute) ||
			window.startMinute < 0 ||
			window.endMinute > 24 * 60 ||
			window.startMinute >= window.endMinute
		) {
			throw new BookingRuleError(
				`window ${window.startMinute}-${window.endMinute} must satisfy 0 <= start < end <= 1440`,
			);
		}
	}
}

const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

export function localDateKey(date: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const lookup = (type: string): string =>
		parts.find((part) => part.type === type)?.value ?? "";
	return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

function localWeekday(date: Date, timeZone: string): number {
	const name = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
	}).format(date);
	const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const index = names.indexOf(name);
	if (index < 0)
		throw new BookingRuleError(`Intl returned unknown weekday ${name}`);
	return index;
}

/**
 * Wall-clock time in `timeZone` for a UTC instant, as minutes since local
 * midnight.
 */
function localMinuteOfDay(date: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
	const minute = Number(
		parts.find((part) => part.type === "minute")?.value ?? "0",
	);
	return hour * 60 + minute;
}

/**
 * Instant for `minuteOfDay` wall-clock on the local day containing `day`,
 * with DST-safe resolution (probe offsets; nonexistent times return null).
 */
function instantAtLocalMinute(
	day: Date,
	timeZone: string,
	minuteOfDay: number,
): Date | null {
	const key = localDateKey(day, timeZone);
	const parts = key.split("-");
	const year = Number(parts[0] ?? "0");
	const month = Number(parts[1] ?? "0");
	const date = Number(parts[2] ?? "0");
	const asIfUtc =
		Date.UTC(year, month - 1, date, 0, 0, 0) + minuteOfDay * 60_000;

	const offsetAt = (instant: number): number => {
		const probe = new Date(instant);
		const probeParts = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).formatToParts(probe);
		const get = (type: string): number =>
			Number(probeParts.find((part) => part.type === type)?.value ?? "0");
		const asUtc = Date.UTC(
			get("year"),
			get("month") - 1,
			get("day"),
			get("hour"),
			get("minute"),
			0,
		);
		return asUtc - Math.floor(instant / 60_000) * 60_000;
	};

	let guess = asIfUtc - offsetAt(asIfUtc);
	guess = asIfUtc - offsetAt(guess);

	const readBackMinute = localMinuteOfDay(new Date(guess), timeZone);
	const readBackDay = localDateKey(new Date(guess), timeZone);
	if (readBackDay !== key || readBackMinute !== minuteOfDay) return null;
	return new Date(guess);
}

function overlaps(
	aStart: number,
	aEnd: number,
	bStart: number,
	bEnd: number,
): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/**
 * Slots for one local day. Slots pack against window start, step by the
 * duration, and every candidate must fit the window plus its buffer and dodge
 * existing bookings (with buffers) and `notBefore`.
 */
export function computeDaySlots(request: SlotRequest): BookingSlot[] {
	validateBookingRules(
		request.durationMinutes,
		request.bufferMinutes,
		request.rules,
	);

	const weekday = localWeekday(request.day, request.timezone);
	const dateKey = localDateKey(request.day, request.timezone);
	const rules = request.rules;

	if ((rules.excludedWeekdays ?? []).includes(weekday)) return [];
	if ((rules.excludedDates ?? []).includes(dateKey)) return [];

	const windows = rules.windows.filter((window) => window.weekday === weekday);
	const stepMinutes = request.durationMinutes + request.bufferMinutes;
	const occupied = request.existing.map((booking) => ({
		start: booking.startsAt.getTime() - request.bufferMinutes * 60_000,
		end: booking.endsAt.getTime() + request.bufferMinutes * 60_000,
	}));

	const slots: BookingSlot[] = [];

	for (const window of windows) {
		for (
			let minute = window.startMinute;
			minute + request.durationMinutes <= window.endMinute;
			minute += stepMinutes
		) {
			const startsAt = instantAtLocalMinute(
				request.day,
				request.timezone,
				minute,
			);
			if (!startsAt) continue;
			const endsAt = new Date(
				startsAt.getTime() + request.durationMinutes * 60_000,
			);

			if (startsAt.getTime() < request.notBefore.getTime()) continue;

			const startWithBuffer =
				startsAt.getTime() - request.bufferMinutes * 60_000;
			const endWithBuffer = endsAt.getTime() + request.bufferMinutes * 60_000;
			const clashes = occupied.some((busy) =>
				overlaps(startWithBuffer, endWithBuffer, busy.start, busy.end),
			);
			if (clashes) continue;

			slots.push({ startsAt, endsAt });
		}
	}

	slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
	return slots;
}

/** True when two bookings overlap (used by the create guard). */
export function bookingsConflict(
	a: { startsAt: Date; endsAt: Date },
	b: { startsAt: Date; endsAt: Date },
): boolean {
	return overlaps(
		a.startsAt.getTime(),
		a.endsAt.getTime(),
		b.startsAt.getTime(),
		b.endsAt.getTime(),
	);
}

export function slotFitsWindow(
	slot: { startsAt: Date; endsAt: Date },
	window: WeekdayWindow,
	timezone: string,
): boolean {
	const startMinute = localMinuteOfDay(slot.startsAt, timezone);
	const endMinute = localMinuteOfDay(slot.endsAt, timezone);
	const sameDay =
		localDateKey(slot.startsAt, timezone) ===
		localDateKey(slot.endsAt, timezone);
	return (
		sameDay &&
		startMinute >= window.startMinute &&
		endMinute <= window.endMinute
	);
}

export function formatDayKey(day: Date, timeZone: string): string {
	return localDateKey(day, timeZone);
}

export function addDays(day: Date, days: number): Date {
	return new Date(day.getTime() + days * DAY_MS);
}

export function padMinute(minute: number): string {
	return `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
}
