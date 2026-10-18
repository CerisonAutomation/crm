/**
 * Routines module: automation scheduler + cron tick endpoint.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { RoutinesService } from "./routines.service";
import { RoutinesController } from "./routines.controller";
import { CronController } from "./cron.controller";

@Module({
	imports: [DatabaseModule, WorkflowsModule],
	providers: [RoutinesService],
	controllers: [RoutinesController, CronController],
	exports: [RoutinesService],
})
export class RoutinesModule {}
