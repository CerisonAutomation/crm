import { describe, expect, it } from "bun:test";
import {
	CronParseError,
	isValidCron,
	isValidTimeZone,
	nextCronRun,
	parseCron,
} from "../src/routines/cron-expression";
import { RoutinesService } from "../src/routines/routines.service";

describe("cron expressions", () => {
	it("parses stars, lists, ranges and steps", () => {
		const cron = parseCron("*/15 9-17 * * 1-5");
		expect([...cron.minute].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
		expect([...cron.hour].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
		expect(cron.domUnrestricted).toBe(true);
		expect(cron.dowUnrestricted).toBe(false);
		expect(cron.dayOfWeek.has(0)).toBe(false);
		expect(cron.dayOfWeek.has(5)).toBe(true);
	});

	it("accepts names and the 7-means-Sunday alias", () => {
		const cron = parseCron("0 0 * jan,mar SUN");
		expect(cron.month.has(1)).toBe(true);
		expect(cron.month.has(3)).toBe(true);
		expect(cron.dayOfWeek.has(0)).toBe(true);
	});

	it("rejects malformed expressions with field-level errors", () => {
		expect(() => parseCron("61 * * * *")).toThrow(CronParseError);
		expect(() => parseCron("* 24 * * *")).toThrow(CronParseError);
		expect(() => parseCron("* * 0 * *")).toThrow(CronParseError);
		expect(() => parseCron("* * * 13 *")).toThrow(CronParseError);
		expect(() => parseCron("* * * * 8")).toThrow(CronParseError);
		expect(() => parseCron("*/0 * * * *")).toThrow(CronParseError);
		expect(() => parseCron("5-1 * * * *")).toThrow(CronParseError);
		expect(() => parseCron("* * * *")).toThrow(CronParseError);
		expect(() => parseCron("not a cron")).toThrow(CronParseError);
		expect(isValidCron("0 3 * * *")).toBe(true);
		expect(isValidCron("0 3 * *")).toBe(false);
	});

	it("computes the next run in UTC", () => {
		const from = new Date("2026-10-13T10:00:00.000Z");
		const next = nextCronRun("30 14 * * *", from, "UTC");
		expect(next?.toISOString()).toBe("2026-10-13T14:30:00.000Z");
	});

	it("computes the next run across midnight", () => {
		const from = new Date("2026-10-13T23:45:00.000Z");
		const next = nextCronRun("10 2 * * *", from, "UTC");
		expect(next?.toISOString()).toBe("2026-10-14T02:10:00.000Z");
	});

	it("respects the timezone (Europe/Berlin is UTC+2 in October)", () => {
		const justBefore = new Date("2026-10-13T09:59:59.000Z");
		const next = nextCronRun("0 12 * * *", justBefore, "Europe/Berlin");
		expect(next?.toISOString()).toBe("2026-10-13T10:00:00.000Z");
		const later = nextCronRun("0 12 * * *", new Date("2026-10-13T10:00:01.000Z"), "Europe/Berlin");
		expect(later?.toISOString()).toBe("2026-10-14T10:00:00.000Z");
	});

	it("returns null for impossible dates instead of hanging", () => {
		const from = new Date("2026-10-13T10:00:00.000Z");
		expect(nextCronRun("0 0 30 2 *", from, "UTC")).toBeNull();
	});

	it("validates IANA timezones", () => {
		expect(isValidTimeZone("UTC")).toBe(true);
		expect(isValidTimeZone("America/New_York")).toBe(true);
		expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
	});
});

describe("routine validation", () => {
	it("requires name, prompt and a cron expression for cron routines", () => {
		expect(
			RoutinesService.validateInput({ name: "", prompt: "", triggerKind: "manual" }),
		).toContain("name is required");

		expect(
			RoutinesService.validateInput({
				name: "n",
				prompt: "p",
				triggerKind: "cron",
				cronExpression: "bad",
			}),
		).toContain("cron trigger needs a valid five-field cron expression");

		expect(
			RoutinesService.validateInput({
				name: "n",
				prompt: "p",
				triggerKind: "manual",
				cronExpression: "0 0 * * *",
			}),
		).toContain("cronExpression is only allowed for cron routines");

		expect(
			RoutinesService.validateInput({
				name: "n",
				prompt: "p",
				triggerKind: "event",
			}),
		).toContain("event routines need at least one trigger event");

		expect(
			RoutinesService.validateInput({
				name: "n",
				prompt: "p",
				triggerKind: "manual",
				timezone: "Nowhere/Nothing",
			}),
		).toContain("unknown timezone Nowhere/Nothing");

		expect(
			RoutinesService.validateInput({
				name: "n",
				prompt: "p",
				triggerKind: "manual",
				debounceSeconds: 90_000,
			}),
		).toContain("debounceSeconds must be between 0 and 86400");

		expect(
			RoutinesService.validateInput({
				name: "nightly digest",
				prompt: "summarize today",
				triggerKind: "cron",
				cronExpression: "0 3 * * *",
				timezone: "Europe/Malta",
			}),
		).toEqual([]);
	});
});

describe("event trigger matching", () => {
	const matcher = {
		matchesEventTrigger: RoutinesService.prototype.matchesEventTrigger,
	};

	it("matches on event name and optional changed-field overlap", () => {
		const routine = {
			triggerEvents: ["deal.updated", "contact.created"],
			changedFields: ["stage", "amount"],
		};

		expect(
			matcher.matchesEventTrigger(routine, { event: "deal.updated", at: new Date() }),
		).toBe(true);

		expect(
			matcher.matchesEventTrigger(routine, { event: "deal.deleted", at: new Date() }),
		).toBe(false);

		expect(
			matcher.matchesEventTrigger(routine, {
				event: "deal.updated",
				changedFields: ["name"],
				at: new Date(),
			}),
		).toBe(false);

		expect(
			matcher.matchesEventTrigger(routine, {
				event: "deal.updated",
				changedFields: ["amount", "closeDate"],
				at: new Date(),
			}),
		).toBe(true);
	});

	it("lets routines without changed-field filters match any payload", () => {
		const routine = { triggerEvents: ["contact.created"], changedFields: [] };
		expect(
			matcher.matchesEventTrigger(routine, {
				event: "contact.created",
				changedFields: ["email"],
				at: new Date(),
			}),
		).toBe(true);
	});
});
