/**
 * Brain routes: organizational memory — brains, tag-indexed notes, outcomes.
 */

import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { auth } from "@crm/auth";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { BrainService, type NoteInput, type OutcomeInput } from "./brain.service";

type CrmSession = UserSession<typeof auth>;

@ApiTags("Brain")
@Controller("api/brain")
export class BrainController {
	constructor(private readonly brains: BrainService) {}

	@Post()
	@ApiOperation({ summary: "Create a brain (memory space)" })
	async create(@Session() session: CrmSession, @Body() body: { name: string; description?: string }) {
		return { brain: await this.brains.createBrain(session.user.id, body.name, body.description ?? null) };
	}

	@Get()
	@ApiOperation({ summary: "List brains" })
	async list(@Session() session: CrmSession) {
		return { brains: await this.brains.brainsFor(session.user.id) };
	}

	@Post(":brainId/notes")
	@ApiOperation({ summary: "Add a note" })
	async addNote(@Session() session: CrmSession, @Param("brainId") brainId: string, @Body() body: NoteInput) {
		return { note: await this.brains.addNote(session.user.id, brainId, body) };
	}

	@Get(":brainId/notes")
	@ApiOperation({ summary: "List notes (optionally by tag)" })
	async notes(
		@Session() session: CrmSession,
		@Param("brainId") brainId: string,
		@Query("tag") tag?: string,
	) {
		const notes = tag
			? await this.brains.notesByTag(session.user.id, brainId, tag)
			: await this.brains.listNotes(session.user.id, brainId);
		return { notes };
	}

	@Post(":brainId/outcomes")
	@ApiOperation({ summary: "Record an outcome linked to notes" })
	async addOutcome(
		@Session() session: CrmSession,
		@Param("brainId") brainId: string,
		@Body() body: OutcomeInput & { occurredAt: string },
	) {
		const occurredAt = new Date(body.occurredAt);
		return { outcome: await this.brains.addOutcome(session.user.id, brainId, { ...body, occurredAt }) };
	}

	@Get(":brainId/outcomes")
	@ApiOperation({ summary: "List outcomes" })
	async outcomes(@Session() session: CrmSession, @Param("brainId") brainId: string) {
		return { outcomes: await this.brains.outcomes(session.user.id, brainId) };
	}
}
