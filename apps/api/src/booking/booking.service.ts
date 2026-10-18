/**
 * Booking service (pattern harvested from SeldonFrame bookings + appointment-types).
 *
 * Lifecycle: scheduled -> completed | cancelled. Cancellation and completion are
 * compare-and-swap updates (`WHERE status = 'scheduled'`) so double-cancel and
 * concurrent status flips settle once — the same CAS discipline SeldonFrame
 * applies to workflow-waits.
 */

import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { InjectDatabase } from "../database/database.constants";
import {
	bookingsConflict,
	BookingRuleError,
	computeDaySlots,
	validateBookingRules,
	type AvailabilityRules,
	type BookingSlot,
} from "./booking-availability";
import { isValidTimeZone } from "../routines/cron-expression";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";

export type AppointmentTypeInput = {
	slug: string;
	title: string;
	description?: string | null;
	durationMinutes: number;
	bufferMinutes: number;
	timezone: string;
	availability: AvailabilityRules;
	provider?: string;
	meetingProvider?: string;
	color?: string | null;
	enabled?: boolean;
};

export type CreateBookingInput = {
	appointmentTypeId?: string | null;
	title: string;
	fullName?: string | null;
	email?: string | null;
	notes?: string | null;
	startsAt: Date;
	provider?: string;
	meetingUrl?: string | null;
	externalEventId?: string | null;
	metadata?: Record<string, unknown>;
};

const VALID_BOOKING_STATUS = new Set(["scheduled", "completed", "cancelled"]);

@Injectable()
export class BookingService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	static validateAppointmentTypeInput(input: AppointmentTypeInput): string[] {
		const problems: string[] = [];
		if (input.slug.trim().length === 0) problems.push("slug is required");
		if (!/^[a-z0-9-]{1,64}$/.test(input.slug.trim())) {
			problems.push("slug must be lowercase letters, digits and dashes (max 64 chars)");
		}
		if (input.title.trim().length === 0) problems.push("title is required");
		if (!isValidTimeZone(input.timezone)) problems.push(`unknown timezone ${input.timezone}`);
		if (!input.availability || !Array.isArray(input.availability.windows)) {
			problems.push("availability.windows must be an array");
		} else {
			try {
				validateBookingRules(input.durationMinutes, input.bufferMinutes, input.availability);
			} catch (error) {
				problems.push(error instanceof BookingRuleError ? error.message : "invalid availability rules");
			}
		}
		return problems;
	}

	async createAppointmentType(ownerUserId: string, input: AppointmentTypeInput) {
		const problems = BookingService.validateAppointmentTypeInput(input);
		if (problems.length > 0) throw new WorkflowNonRetryableError(problems.join("; "));

		const existing = await this.db.appointmentType.findUnique({
			where: { ownerUserId_slug: { ownerUserId, slug: input.slug.trim() } },
		});
		if (existing) throw new WorkflowNonRetryableError(`slug ${input.slug} already exists for this owner`);

		return this.db.appointmentType.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				slug: input.slug.trim(),
				title: input.title,
				description: input.description ?? null,
				durationMinutes: input.durationMinutes,
				bufferMinutes: input.bufferMinutes,
				timezone: input.timezone,
				availability: input.availability as object,
				provider: input.provider ?? "manual",
				meetingProvider: input.meetingProvider ?? "none",
				color: input.color ?? null,
				enabled: input.enabled ?? true,
			},
		});
	}

	async listAppointmentTypes(ownerUserId: string) {
		return this.db.appointmentType.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
		});
	}

	async getAppointmentTypeBySlug(ownerUserId: string, slug: string) {
		return this.db.appointmentType.findUnique({
			where: { ownerUserId_slug: { ownerUserId, slug } },
		});
	}

	async removeAppointmentType(ownerUserId: string, id: string): Promise<boolean> {
		const found = await this.db.appointmentType.findFirst({ where: { id, ownerUserId } });
		if (!found) return false;
		await this.db.appointmentType.delete({ where: { id } });
		return true;
	}

	/**
	 * Free slots for a local day of an appointment type. Bookings of the same
	 * owner inside the day window are loaded once and excluded with buffers.
	 */
	async slotsForDay(ownerUserId: string, appointmentTypeId: string, day: Date, now = new Date()): Promise<BookingSlot[]> {
		const type = await this.db.appointmentType.findFirst({
			where: { id: appointmentTypeId, ownerUserId, enabled: true },
		});
		if (!type) throw new WorkflowNonRetryableError(`No appointment type ${appointmentTypeId}`);

		const dayStart = new Date(day.getTime() - DAY_MS);
		const dayEnd = new Date(day.getTime() + 2 * DAY_MS);
		const existing = await this.db.booking.findMany({
			where: {
				ownerUserId,
				status: "scheduled",
				startsAt: { gte: dayStart, lt: dayEnd },
			},
			select: { startsAt: true, endsAt: true },
		});

		try {
			return computeDaySlots({
				day,
				durationMinutes: type.durationMinutes,
				bufferMinutes: type.bufferMinutes,
				timezone: type.timezone,
				rules: type.availability as unknown as AvailabilityRules,
				existing,
				notBefore: now,
			});
		} catch (error) {
			throw new WorkflowNonRetryableError(
				error instanceof BookingRuleError ? error.message : "availability rules are invalid",
			);
		}
	}

	async createBooking(ownerUserId: string, input: CreateBookingInput) {
		const type = input.appointmentTypeId
			? await this.db.appointmentType.findFirst({
					where: { id: input.appointmentTypeId, ownerUserId, enabled: true },
				})
			: null;
		if (input.appointmentTypeId && !type) {
			throw new WorkflowNonRetryableError(`No appointment type ${input.appointmentTypeId}`);
		}

		const startsAt = input.startsAt;
		const endsAt = new Date(startsAt.getTime() + (type?.durationMinutes ?? 30) * 60_000);
		if (startsAt.getTime() <= Date.now() - 60_000) {
			throw new WorkflowNonRetryableError("Cannot book a slot in the past");
		}

		const nearby = await this.db.booking.findMany({
			where: {
				ownerUserId,
				status: "scheduled",
				startsAt: { gte: new Date(startsAt.getTime() - DAY_MS), lt: new Date(startsAt.getTime() + DAY_MS) },
			},
			select: { startsAt: true, endsAt: true },
		});
		const conflict = nearby.some((busy) =>
			bookingsConflict({ startsAt, endsAt }, { startsAt: busy.startsAt, endsAt: busy.endsAt }),
		);
		if (conflict) throw new WorkflowNonRetryableError("The requested time overlaps an existing booking");

		return this.db.booking.create({
			data: {
				id: randomUUID(),
				appointmentTypeId: type?.id ?? null,
				ownerUserId,
				title: input.title,
				fullName: input.fullName ?? null,
				email: input.email ?? null,
				notes: input.notes ?? null,
				provider: input.provider ?? "manual",
				status: "scheduled",
				startsAt,
				endsAt,
				meetingUrl: input.meetingUrl ?? null,
				externalEventId: input.externalEventId ?? null,
				metadata: (input.metadata ?? {}) as object,
			},
		});
	}

	/** CAS cancel: returns false when the booking was not `scheduled` anymore. */
	async cancelBooking(ownerUserId: string, id: string, reason?: string): Promise<boolean> {
		const result = await this.db.booking.updateMany({
			where: { id, ownerUserId, status: "scheduled" },
			data: {
				status: "cancelled",
				cancelledAt: new Date(),
				metadata: reason ? { cancelReason: reason } : undefined,
			},
		});
		return result.count === 1;
	}

	/** CAS complete. */
	async completeBooking(ownerUserId: string, id: string): Promise<boolean> {
		const result = await this.db.booking.updateMany({
			where: { id, ownerUserId, status: "scheduled" },
			data: { status: "completed", completedAt: new Date() },
		});
		return result.count === 1;
	}

	async listBookings(ownerUserId: string, from: Date, to: Date) {
		return this.db.booking.findMany({
			where: { ownerUserId, startsAt: { gte: from, lt: to } },
			orderBy: { startsAt: "asc" },
		});
	}

	static isTerminalStatus(status: string): boolean {
		return VALID_BOOKING_STATUS.has(status) && status !== "scheduled";
	}
}

const DAY_MS = 24 * 60 * 60 * 1000;
