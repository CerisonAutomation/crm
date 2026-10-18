/**
 * Routine CRUD + manual trigger + run history, session-authenticated.
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
	Put,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { auth } from "@crm/auth";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import type { Db } from "@crm/db";
import { InjectDatabase } from "../database/database.constants";
import { RoutinesService, type RoutineInput } from "./routines.service";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";

type CrmSession = UserSession<typeof auth>;

@ApiTags("Routines")
@Controller("api/routines")
export class RoutinesController {
	constructor(
		private readonly routines: RoutinesService,
		@InjectDatabase() private readonly db: Db,
	) {}

	@Get()
	@ApiOperation({ summary: "List your automation routines" })
	async list(@Session() session: CrmSession) {
		return { routines: await this.routines.list(session.user.id) };
	}

	@Get(":id/runs")
	@ApiOperation({ summary: "Run history for one routine" })
	async runs(@Session() session: CrmSession, @Param("id") id: string) {
		const owned = (await this.routines.list(session.user.id)).find((routine) => routine.id === id);
		if (!owned) throw new NotFoundException(`No routine with id ${id}`);
		const runs = await this.db.routineRun.findMany({
			where: { routineId: id },
			orderBy: { createdAt: "desc" },
			take: 50,
		});
		return { runs };
	}

	@Post()
	@ApiOperation({ summary: "Create a routine" })
	async create(@Session() session: CrmSession, @Body() body: RoutineInput) {
		try {
			return { routine: await this.routines.create(session.user.id, body) };
		} catch (error) {
			throw this.toBadRequest(error);
		}
	}

	@Put(":id")
	@ApiOperation({ summary: "Update a routine" })
	async update(@Session() session: CrmSession, @Param("id") id: string, @Body() body: RoutineInput) {
		const owned = (await this.routines.list(session.user.id)).find((routine) => routine.id === id);
		if (!owned) throw new NotFoundException(`No routine with id ${id}`);
		try {
			return { routine: await this.routines.update(id, body) };
		} catch (error) {
			throw this.toBadRequest(error);
		}
	}

	@Delete(":id")
	@ApiOperation({ summary: "Delete a routine" })
	async remove(@Session() session: CrmSession, @Param("id") id: string) {
		const owned = (await this.routines.list(session.user.id)).find((routine) => routine.id === id);
		if (!owned) throw new NotFoundException(`No routine with id ${id}`);
		await this.routines.remove(id);
		return { deleted: true };
	}

	@Post(":id/trigger")
	@ApiOperation({ summary: "Queue a manual run" })
	async trigger(@Session() session: CrmSession, @Param("id") id: string) {
		const owned = (await this.routines.list(session.user.id)).find((routine) => routine.id === id);
		if (!owned) throw new NotFoundException(`No routine with id ${id}`);
		const runId = await this.routines.triggerManually(id, session.user.id);
		return { runId };
	}

	private toBadRequest(error: unknown): Error {
		if (error instanceof WorkflowNonRetryableError) {
			return new BadRequestException(error.message);
		}
		return error instanceof Error ? error : new Error(String(error));
	}
}
