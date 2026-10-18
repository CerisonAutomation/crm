/**
 * Named workflow registry (extracted from Customermates `workflows/registry.ts`).
 *
 * A workflow is a named async handler composed of named steps. The registry
 * gives operators a stable surface: the cron controller, the routines engine
 * and the n8n trigger endpoint all dispatch through these ids.
 */

import { Injectable } from "@nestjs/common";
import type {
	RunWorkflowOptions,
	RunWorkflowResult,
	WorkflowDefinition,
	WorkflowRunner,
} from "./workflow-runner.service";

@Injectable()
export class WorkflowRegistry {
	private readonly definitions = new Map<
		string,
		WorkflowDefinition<never, unknown>
	>();

	register<TInput, TResult>(
		definition: WorkflowDefinition<TInput, TResult>,
	): void {
		if (this.definitions.has(definition.name)) {
			throw new Error(`Workflow ${definition.name} is already registered`);
		}
		this.definitions.set(
			definition.name,
			definition as WorkflowDefinition<never, unknown>,
		);
	}

	names(): string[] {
		return [...this.definitions.keys()].sort();
	}

	has(name: string): boolean {
		return this.definitions.has(name);
	}

	async dispatch<TInput, TResult>(
		runner: WorkflowRunner,
		name: string,
		input: TInput,
		options?: RunWorkflowOptions,
	): Promise<RunWorkflowResult<TResult>> {
		const definition = this.definitions.get(name);
		if (!definition) {
			throw new Error(`Workflow ${name} is not registered`);
		}
		return runner.run(
			definition as WorkflowDefinition<TInput, TResult>,
			input,
			options,
		);
	}
}
