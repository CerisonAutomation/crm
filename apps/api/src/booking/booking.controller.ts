/**
 * Booking routes: session-authenticated admin CRUD plus a public booking
 * surface (`/api/booking/public/...`) for hosted booking pages.
 */

import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	NotFoundException,
	Param,
	Post,
	Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { auth } from "@crm/auth";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { EventDispatcherService } from "../events/event-dispatcher.service";
import { BookingCalendarService } from "./booking-calendar.service";
import {
	BookingService,
	type AppointmentTypeInput,
	type CreateBookingInput,
} from "./booking.service";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";

type CrmSession = UserSession<typeof auth>;

type PublicBookingBody = {
	title: string;
	fullName?: string;
	email?: string;
	notes?: string;
	startsAt: string;
};

@ApiTags("Booking")
@Controller("api/booking")
export class BookingController {
	constructor(
		private readonly bookings: BookingService,
		private readonly events: EventDispatcherService,
		private readonly calendar: BookingCalendarService,
	) {}

	private async publishBookingEvent(
		event: "booking.created" | "booking.cancelled" | "booking.completed",
		ownerUserId: string,
		booking: { id: string; startsAt: Date; endsAt: Date; title: string; status: string },
	): Promise<void> {
		await this.events.dispatch({
			event,
			ownerUserId,
			entityId: booking.id,
			at: new Date(),
			payload: {
				bookingId: booking.id,
				title: booking.title,
				status: booking.status,
				startsAt: booking.startsAt.toISOString(),
				endsAt: booking.endsAt.toISOString(),
			},
		});
	}

	@Get("appointment-types")
	@ApiOperation({ summary: "List your appointment types (booking pages)" })
	async listTypes(@Session() session: CrmSession) {
		return { appointmentTypes: await this.bookings.listAppointmentTypes(session.user.id) };
	}

	@Post("appointment-types")
	@ApiOperation({ summary: "Create an appointment type" })
	async createType(@Session() session: CrmSession, @Body() body: AppointmentTypeInput) {
		try {
			return { appointmentType: await this.bookings.createAppointmentType(session.user.id, body) };
		} catch (error) {
			throw this.toBadRequest(error);
		}
	}

	@Delete("appointment-types/:id")
	@ApiOperation({ summary: "Delete an appointment type" })
	async removeType(@Session() session: CrmSession, @Param("id") id: string) {
		const removed = await this.bookings.removeAppointmentType(session.user.id, id);
		if (!removed) throw new NotFoundException(`No appointment type with id ${id}`);
		return { deleted: true };
	}

	@Get("bookings")
	@ApiOperation({ summary: "List bookings in a date range" })
	async listBookings(
		@Session() session: CrmSession,
		@Query("from") from?: string,
		@Query("to") to?: string,
	) {
		const fromDate = from ? new Date(from) : new Date();
		const toDate = to ? new Date(to) : new Date(fromDate.getTime() + 30 * 24 * 60 * 60 * 1000);
		if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
			throw new BadRequestException("from/to must be ISO date strings");
		}
		return { bookings: await this.bookings.listBookings(session.user.id, fromDate, toDate) };
	}

	@Post("bookings")
	@ApiOperation({ summary: "Create a booking manually" })
	async createBooking(@Session() session: CrmSession, @Body() body: CreateBookingInput & { startsAt: string }) {
		try {
			const startsAt = new Date(body.startsAt);
			if (Number.isNaN(startsAt.getTime())) throw new BadRequestException("startsAt must be an ISO date string");
			const booking = await this.bookings.createBooking(session.user.id, { ...body, startsAt });
			await this.publishBookingEvent("booking.created", session.user.id, booking);
			return { booking };
		} catch (error) {
			throw this.toBadRequest(error);
		}
	}

	@Post("bookings/:id/cancel")
	@ApiOperation({ summary: "Cancel a scheduled booking (compare-and-swap)" })
	async cancelBooking(@Session() session: CrmSession, @Param("id") id: string, @Body() body: { reason?: string }) {
		const cancelled = await this.bookings.cancelBooking(session.user.id, id, body?.reason);
		if (cancelled) {
			const booking = await this.bookings.listBookings(session.user.id, new Date(0), new Date(Date.now() + 3650 * 24 * 3600 * 1000));
			const row = booking.find((entry) => entry.id === id);
			if (row) await this.publishBookingEvent("booking.cancelled", session.user.id, row);
		}
		return { cancelled };
	}

	@Post("bookings/:id/complete")
	@ApiOperation({ summary: "Complete a scheduled booking (compare-and-swap)" })
	async completeBooking(@Session() session: CrmSession, @Param("id") id: string) {
		const completed = await this.bookings.completeBooking(session.user.id, id);
		if (completed) {
			const booking = await this.bookings.listBookings(session.user.id, new Date(0), new Date(Date.now() + 3650 * 24 * 3600 * 1000));
			const row = booking.find((entry) => entry.id === id);
			if (row) await this.publishBookingEvent("booking.completed", session.user.id, row);
		}
		return { completed };
	}

	@Post("bookings/:id/calendar/push")
	@ApiOperation({ summary: "Push a booking to its Google/Microsoft calendar" })
	async pushCalendar(@Session() session: CrmSession, @Param("id") id: string) {
		const pushed = await this.calendar.syncBookingToCalendar(session.user.id, id);
		return {
			externalEventId: pushed.externalEventId,
			meetingUrl: pushed.meetingUrl,
		};
	}

	@Post("bookings/:id/calendar/cancel")
	@ApiOperation({ summary: "Cancel the external calendar event for a booking" })
	async cancelCalendar(@Session() session: CrmSession, @Param("id") id: string) {
		const rows = await this.bookings.listBookings(
			session.user.id,
			new Date(0),
			new Date(Date.now() + 3650 * 24 * 3600 * 1000),
		);
		const booking = rows.find((entry) => entry.id === id);
		if (!booking) throw new NotFoundException(`No booking with id ${id}`);
		const cancelled = await this.calendar.cancelExternal(session.user.id, booking);
		return { cancelled };
	}

	@Get("public/:userId/:slug/slots")
	@ApiOperation({ summary: "Public free-slot listing for a booking page" })
	async publicSlots(
		@Param("userId") userId: string,
		@Param("slug") slug: string,
		@Query("day") day?: string,
	) {
		const type = await this.bookings.getAppointmentTypeBySlug(userId, slug);
		if (!type || !type.enabled) throw new NotFoundException("Booking page not found");
		const dayDate = day ? new Date(day) : new Date();
		if (Number.isNaN(dayDate.getTime())) throw new BadRequestException("day must be an ISO date string");
		const slots = await this.bookings.slotsForDay(userId, type.id, dayDate);
		return {
			appointmentType: {
				slug: type.slug,
				title: type.title,
				description: type.description,
				durationMinutes: type.durationMinutes,
				timezone: type.timezone,
			},
			slots,
		};
	}

	@Post("public/:userId/:slug/book")
	@ApiOperation({ summary: "Public booking submission for a booking page" })
	async publicBook(
		@Param("userId") userId: string,
		@Param("slug") slug: string,
		@Body() body: PublicBookingBody,
	) {
		const type = await this.bookings.getAppointmentTypeBySlug(userId, slug);
		if (!type || !type.enabled) throw new NotFoundException("Booking page not found");
		const startsAt = new Date(body.startsAt);
		if (Number.isNaN(startsAt.getTime())) throw new BadRequestException("startsAt must be an ISO date string");
		try {
			const booking = await this.bookings.createBooking(userId, {
				appointmentTypeId: type.id,
				title: body.title,
				fullName: body.fullName ?? null,
				email: body.email ?? null,
				notes: body.notes ?? null,
				startsAt,
				provider: "public",
			});
			await this.publishBookingEvent("booking.created", userId, booking);
			return {
				bookingId: booking.id,
				startsAt: booking.startsAt,
				endsAt: booking.endsAt,
				status: booking.status,
			};
		} catch (error) {
			throw this.toBadRequest(error);
		}
	}

	private toBadRequest(error: unknown): Error {
		if (error instanceof WorkflowNonRetryableError) return new BadRequestException(error.message);
		if (error instanceof BadRequestException) return error;
		return error instanceof Error ? error : new Error(String(error));
	}
}
