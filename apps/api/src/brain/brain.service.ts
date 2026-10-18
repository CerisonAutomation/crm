/**
 * Brain — persistent organizational memory (pattern harvested from SeldonFrame
 * U6: brain / brain-notes / brain-outcomes).
 *
 * Notes carry tag-indexed knowledge with a source marker; outcomes attach
 * measured results to note sets, forming the feedback loop the insight layer
 * reads.
 */

import { randomUUID } from "node:crypto";
import type { Db, Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { WorkflowNonRetryableError } from "../workflows/workflow-errors";

export type NoteInput = {
	title: string;
	body: string;
	tags?: string[];
	source?: string;
};

export type OutcomeInput = {
	label: string;
	metrics?: Record<string, unknown>;
	noteIds?: string[];
	occurredAt: Date;
};

const MAX_TAGS = 20;

export function normalizeTags(tags: string[] | undefined): string[] {
	if (!tags) return [];
	const cleaned = tags
		.map((tag) => tag.trim().toLowerCase())
		.filter((tag) => tag.length > 0 && tag.length <= 64);
	return [...new Set(cleaned)].slice(0, MAX_TAGS);
}

@Injectable()
export class BrainService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async createBrain(
		ownerUserId: string,
		name: string,
		description?: string | null,
	) {
		if (name.trim().length === 0)
			throw new WorkflowNonRetryableError("brain name is required");
		return this.db.brain.create({
			data: {
				id: randomUUID(),
				ownerUserId,
				name,
				description: description ?? null,
			},
		});
	}

	async brainsFor(ownerUserId: string) {
		return this.db.brain.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
		});
	}

	async addNote(ownerUserId: string, brainId: string, input: NoteInput) {
		await this.assertBrainOwned(ownerUserId, brainId);
		if (input.title.trim().length === 0)
			throw new WorkflowNonRetryableError("note title is required");
		return this.db.brainNote.create({
			data: {
				id: randomUUID(),
				brainId,
				title: input.title,
				body: input.body,
				tags: normalizeTags(input.tags),
				source: input.source ?? "manual",
			},
		});
	}

	async notesByTag(ownerUserId: string, brainId: string, tag: string) {
		await this.assertBrainOwned(ownerUserId, brainId);
		return this.db.brainNote.findMany({
			where: { brainId, tags: { has: tag.trim().toLowerCase() } },
			orderBy: { createdAt: "desc" },
		});
	}

	async listNotes(ownerUserId: string, brainId: string) {
		await this.assertBrainOwned(ownerUserId, brainId);
		return this.db.brainNote.findMany({
			where: { brainId },
			orderBy: { createdAt: "desc" },
		});
	}

	async addOutcome(ownerUserId: string, brainId: string, input: OutcomeInput) {
		await this.assertBrainOwned(ownerUserId, brainId);
		if (input.label.trim().length === 0)
			throw new WorkflowNonRetryableError("outcome label is required");
		return this.db.brainOutcome.create({
			data: {
				id: randomUUID(),
				brainId,
				label: input.label,
				metrics: (input.metrics ?? {}) as Prisma.InputJsonValue,
				noteIds: input.noteIds ?? [],
				occurredAt: input.occurredAt,
			},
		});
	}

	async outcomes(ownerUserId: string, brainId: string) {
		await this.assertBrainOwned(ownerUserId, brainId);
		return this.db.brainOutcome.findMany({
			where: { brainId },
			orderBy: { occurredAt: "desc" },
		});
	}

	private async assertBrainOwned(
		ownerUserId: string,
		brainId: string,
	): Promise<void> {
		const brain = await this.db.brain.findFirst({
			where: { id: brainId, ownerUserId },
		});
		if (!brain)
			throw new WorkflowNonRetryableError(`No brain ${brainId} for this owner`);
	}
}
