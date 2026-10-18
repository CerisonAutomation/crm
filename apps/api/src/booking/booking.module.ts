/**
 * Booking module: appointment types, scheduling engine, public booking surface.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EventsModule } from "../events/events.module";
import { BookingController } from "./booking.controller";
import { BookingService } from "./booking.service";
import { BookingCalendarService } from "./booking-calendar.service";

@Module({
	imports: [DatabaseModule, EventsModule],
	providers: [BookingService, BookingCalendarService],
	controllers: [BookingController],
	exports: [BookingService, BookingCalendarService],
})
export class BookingModule {}
