/**
 * Five-field cron expressions with timezone-aware next-run computation.
 *
 * Supported syntax: `*`, `1`, `1-5`, star-slash-10 (step), `1,15`, `1-5/2`, names for month
 * and weekday (`MON`, `jan`), and the standard `7 = Sunday` alias. Days of
 * month and week combine with OR semantics when both are restricted, matching
 * Vixie cron. Timezone resolution uses `Intl`, so IANA names work without
 * extra dependencies.
 */

export const MINUTES_IN_DAY = 24 * 60;
const FIELD_LIMITS = {
	minute: { min: 0, max: 59 },
	hour: { min: 0, max: 23 },
	dayOfMonth: { min: 1, max: 31 },
	month: { min: 1, max: 12 },
	dayOfWeek: { min: 0, max: 7 },
} as const;

const MONTH_NAMES = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type FieldName = keyof typeof FIELD_LIMITS;

export type CronExpression = {
	minute: Set<number>;
	hour: Set<number>;
	dayOfMonth: Set<number>;
	month: Set<number>;
	dayOfWeek: Set<number>;
	/** True when the field was `*` or `?` — participates in the dom/dow OR rule. */
	domUnrestricted: boolean;
	dowUnrestricted: boolean;
};

export class CronParseError extends Error {
	constructor(field: string, reason: string) {
		super(`Invalid cron field ${field}: ${reason}`);
		this.name = "CronParseError";
	}
}

function parseValue(token: string, field: FieldName): number {
	const lowered = token.toLowerCase();
	const limits = FIELD_LIMITS[field];

	if (field === "month") {
		const monthIndex = MONTH_NAMES.indexOf(lowered);
		if (monthIndex >= 0) return monthIndex + 1;
	}
	if (field === "dayOfWeek") {
		const dayIndex = DAY_NAMES.indexOf(lowered);
		if (dayIndex >= 0) return dayIndex;
	}

	if (!/^\d+$/.test(token)) {
		throw new CronParseError(field, `"${token}" is not a number or name`);
	}
	const value = Number(token);
	if (field === "dayOfWeek" && value === 7) return 0;
	if (value < limits.min || value > limits.max) {
		throw new CronParseError(
			field,
			`${value} is outside ${limits.min}-${limits.max}`,
		);
	}
	return value;
}

function parseField(raw: string, field: FieldName): Set<number> {
	const text = raw.trim();
	if (text.length === 0) throw new CronParseError(field, "empty");
	if (text === "*" || text === "?") {
		const all = new Set<number>();
		const limits = FIELD_LIMITS[field];
		const max = field === "dayOfWeek" ? 6 : limits.max;
		for (let value = limits.min; value <= max; value += 1) all.add(value);
		return all;
	}

	const values = new Set<number>();

	for (const part of text.split(",")) {
		const segment = part.trim();
		if (segment.length === 0)
			throw new CronParseError(field, "empty list item");

		const rangeTokens = segment.split("/");
		const rangePart = rangeTokens[0] ?? "";
		const stepPart = rangeTokens[1];
		const step = stepPart === undefined ? 1 : Number(stepPart);
		if (!Number.isInteger(step) || step < 1) {
			throw new CronParseError(
				field,
				`step "${stepPart}" must be a positive integer`,
			);
		}

		let start: number;
		let end: number;

		if (rangePart === "*" || rangePart === "?") {
			const limits = FIELD_LIMITS[field];
			start = limits.min;
			end = field === "dayOfWeek" ? 6 : limits.max;
		} else if (rangePart.includes("-")) {
			const rangeBounds = rangePart.split("-");
			const from = rangeBounds[0] ?? "";
			const to = rangeBounds[1] ?? "";
			start = parseValue(from, field);
			end = parseValue(to, field);
			if (start > end)
				throw new CronParseError(field, `range ${rangePart} is reversed`);
		} else {
			start = parseValue(rangePart, field);
			end =
				stepPart === undefined
					? start
					: field === "dayOfWeek"
						? 6
						: FIELD_LIMITS[field].max;
		}

		for (let value = start; value <= end; value += step) {
			values.add(field === "dayOfWeek" && value === 7 ? 0 : value);
		}
	}

	if (values.size === 0) throw new CronParseError(field, "matches nothing");
	return values;
}

export function parseCron(expression: string): CronExpression {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new CronParseError(
			"expression",
			`expected 5 fields, found ${fields.length}`,
		);
	}

	const minute = fields[0] ?? "";
	const hour = fields[1] ?? "";
	const dayOfMonth = fields[2] ?? "";
	const month = fields[3] ?? "";
	const dayOfWeek = fields[4] ?? "";
	const domToken = dayOfMonth.trim();
	const dowToken = dayOfWeek.trim();

	return {
		minute: parseField(minute, "minute"),
		hour: parseField(hour, "hour"),
		dayOfMonth: parseField(domToken, "dayOfMonth"),
		month: parseField(month, "month"),
		dayOfWeek: parseField(dowToken, "dayOfWeek"),
		domUnrestricted: domToken === "*" || domToken === "?",
		dowUnrestricted: dowToken === "*" || dowToken === "?",
	};
}

export function isValidCron(expression: string): boolean {
	try {
		parseCron(expression);
		return true;
	} catch {
		return false;
	}
}

type ZonedParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date, timeZone: string): ZonedParts {
	let formatter = formatterCache.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		formatterCache.set(timeZone, formatter);
	}

	const parts = formatter.formatToParts(date);
	const lookup = (type: string): number => {
		const found = parts.find((part) => part.type === type);
		if (!found)
			throw new Error(
				`Intl.DateTimeFormat returned no ${type} for ${timeZone}`,
			);
		return Number(found.value);
	};

	return {
		year: lookup("year"),
		month: lookup("month"),
		day: lookup("day"),
		hour: lookup("hour"),
		minute: lookup("minute"),
	};
}

/**
 * UTC offset of `timeZone` at the given instant, in milliseconds
 * (positive east of Greenwich, matching the sign of Date.getTimezoneOffset
 * inverted). Computed by reinterpreting the wall-clock reading as if it were
 * UTC and diffing against the real instant.
 */
function timeZoneOffsetMs(instant: number, timeZone: string): number {
	const parts = zonedParts(new Date(instant), timeZone);
	const asIfUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		0,
	);
	return asIfUtc - Math.floor(instant / 60_000) * 60_000;
}

/**
 * Converts wall-clock time in `timeZone` back to an instant. Two-pass offset
 * refinement handles any fixed offset (including UTC+2 CEST) and most DST
 * edges; nonexistent local times (spring-forward gap) return null, and for
 * repeated local times (fall-back) the earlier instant wins.
 */
function zonedTimeToUtc(parts: ZonedParts, timeZone: string): Date | null {
	const localAsUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		0,
	);

	let guess = localAsUtc - timeZoneOffsetMs(localAsUtc, timeZone);
	guess = localAsUtc - timeZoneOffsetMs(guess, timeZone);

	const readBack = zonedParts(new Date(guess), timeZone);
	if (
		readBack.year === parts.year &&
		readBack.month === parts.month &&
		readBack.day === parts.day &&
		readBack.hour === parts.hour &&
		readBack.minute === parts.minute
	) {
		return new Date(guess);
	}

	return null;
}

function dayMatches(
	cron: CronExpression,
	parts: ZonedParts,
	dayOfWeek: number,
): boolean {
	const domMatch = cron.dayOfMonth.has(parts.day);
	const dowMatch = cron.dayOfWeek.has(dayOfWeek);

	if (cron.domUnrestricted && cron.dowUnrestricted) return true;
	if (cron.domUnrestricted) return dowMatch;
	if (cron.dowUnrestricted) return domMatch;
	return domMatch || dowMatch;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Next instant at or after `from` (exclusive of the exact minute) matching the
 * expression in `timeZone`. Scans up to 366 days ahead and returns `null` when
 * the expression cannot fire in that window (e.g. `0 0 30 2 *`).
 */
export function nextCronRun(
	expression: string | CronExpression,
	from: Date,
	timeZone: string,
): Date | null {
	const cron =
		typeof expression === "string" ? parseCron(expression) : expression;
	const start = new Date(from.getTime() + 60_000 - (from.getTime() % 60_000));

	let cursorDay = new Date(start.getTime());
	for (let dayOffset = 0; dayOffset <= 366; dayOffset += 1) {
		const parts = zonedParts(cursorDay, timeZone);
		const dayOfWeek = new Date(
			Date.UTC(parts.year, parts.month - 1, parts.day),
		).getUTCDay();

		if (cron.month.has(parts.month) && dayMatches(cron, parts, dayOfWeek)) {
			for (const hour of [...cron.hour].sort((a, b) => a - b)) {
				if (hour < parts.hour && dayOffset === 0) continue;
				for (const minute of [...cron.minute].sort((a, b) => a - b)) {
					if (
						dayOffset === 0 &&
						(hour < parts.hour ||
							(hour === parts.hour && minute < parts.minute))
					) {
						continue;
					}
					const instant = zonedTimeToUtc(
						{
							year: parts.year,
							month: parts.month,
							day: parts.day,
							hour,
							minute,
						},
						timeZone,
					);
					if (instant && instant.getTime() > from.getTime()) {
						return instant;
					}
				}
			}
		}

		cursorDay = new Date(cursorDay.getTime() + DAY_MS);
		const cursorParts = zonedParts(cursorDay, timeZone);
		cursorDay =
			zonedTimeToUtc(
				{
					year: cursorParts.year,
					month: cursorParts.month,
					day: cursorParts.day,
					hour: 0,
					minute: 0,
				},
				timeZone,
			) ?? new Date(cursorDay.getTime() + DAY_MS);
	}

	return null;
}

export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}
