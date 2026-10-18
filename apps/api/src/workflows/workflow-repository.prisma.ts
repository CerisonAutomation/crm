/**
 * Prisma-backed adapters for the workflow runner ports.
 */

import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { Db, Prisma } from "@crm/db";
import type { WorkflowFailure } from "./workflow-errors";
import type {
	WorkflowRunRecord,
	WorkflowRunRepository,
	WorkflowStepRunRecord,
	WorkflowStepRunRepository,
} from "./workflow-repository";

@Injectable()
export class PrismaWorkflowRunRepository implements WorkflowRunRepository {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async create(record: WorkflowRunRecord): Promise<void> {
		await this.db.workflowRun.create({
			data: {
				id: record.id,
				workflowName: record.workflowName,
				tenantUserId: record.tenantUserId,
				input: record.input as unknown as Prisma.InputJsonValue,
				maxAttempts: record.maxAttempts,
			},
		});
	}

	async markRunning(id: string): Promise<number> {
		const updated = await this.db.workflowRun.update({
			where: { id },
			data: { status: "running", startedAt: new Date(), attemptCount: { increment: 1 } },
			select: { attemptCount: true },
		});
		return updated.attemptCount;
	}

	async markSucceeded(id: string): Promise<void> {
		await this.db.workflowRun.update({
			where: { id },
			data: { status: "succeeded", finishedAt: new Date() },
		});
	}

	async markFailed(id: string, failure: WorkflowFailure, expected: boolean): Promise<void> {
		await this.db.workflowRun.update({
			where: { id },
			data: {
				status: "failed",
				finishedAt: new Date(),
				failureName: failure.name ?? null,
				failureMessage: failure.message ?? null,
				failureStack: failure.stack ?? null,
				failureExpected: expected,
			},
		});
	}

	async abandonStale(before: Date): Promise<number> {
		const result = await this.db.workflowRun.updateMany({
			where: {
				status: { in: ["pending", "running"] },
				updatedAt: { lt: before },
			},
			data: {
				status: "abandoned",
				finishedAt: new Date(),
				failureName: "WorkflowAbandoned",
				failureMessage: "Run had no heartbeat before the recovery sweep; the API process likely restarted.",
				failureExpected: true,
			},
		});
		return result.count;
	}
}

@Injectable()
export class PrismaWorkflowStepRunRepository implements WorkflowStepRunRepository {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async create(record: WorkflowStepRunRecord): Promise<void> {
		await this.db.workflowStepRun.create({
			data: {
				id: record.id,
				runId: record.runId,
				stepName: record.stepName,
				maxRetries: record.maxRetries,
			},
		});
	}

	async markRunning(id: string, attempt: number): Promise<void> {
		await this.db.workflowStepRun.update({
			where: { id },
			data: { status: "pending", startedAt: new Date(), attemptCount: attempt },
		});
	}

	async markFailed(id: string, attempt: number, failure: WorkflowFailure, willRetry: boolean): Promise<void> {
		await this.db.workflowStepRun.update({
			where: { id },
			data: {
				status: willRetry ? "pending" : "failed",
				attemptCount: attempt,
				failureName: failure.name ?? null,
				failureMessage: failure.message ?? null,
				finishedAt: willRetry ? null : new Date(),
			},
		});
	}

	async markSucceeded(id: string, attempt: number): Promise<void> {
		await this.db.workflowStepRun.update({
			where: { id },
			data: { status: "succeeded", attemptCount: attempt, finishedAt: new Date() },
		});
	}
}
