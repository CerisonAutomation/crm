/**
 * MCP tool contracts (extracted from Customermates `features/mcp-tools/mcp-tool.ts`).
 *
 * A tool carries a Zod input schema and returns either plain text, a failure
 * record, or structured content. Failures serialize into a stable shape so AI
 * clients can react to validation/authentication/authorization problems
 * without parsing prose.
 */

import { z } from "zod";

export const VALIDATION_ERROR_PREFIX = "Validation error:";

export type InteractorFailureKind = "validation" | "authentication" | "authorization" | "notFound" | "conflict";

export type SerializedInteractorFailure = {
	kind: InteractorFailureKind;
	issues: Array<{ code: string; path: Array<string | number>; message: string }>;
};

export type McpToolFailureResult = {
	text: string;
	failure: SerializedInteractorFailure;
};

export type McpToolResult =
	| string
	| McpToolFailureResult
	| { text: string; structuredContent: Record<string, unknown> };

export type McpToolExecutionResult =
	| {
			ok: true;
			result: string;
			structuredContent?: Record<string, unknown>;
	  }
	| {
			ok: false;
			result: string;
			failure: SerializedInteractorFailure;
	  };

export type McpTool = {
	name: string;
	title: string;
	description: string;
	/** MCP tool annotations, e.g. { readOnlyHint: true }. */
	annotations?: Record<string, boolean>;
	inputSchema: z.ZodType;
	execute: (input: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;
};

export function mcpToolResultText(result: McpToolResult): string {
	return typeof result === "string" ? result : result.text;
}

export function validationError(error: z.ZodError): string {
	return `${VALIDATION_ERROR_PREFIX} ${z.prettifyError(error)}`;
}

export function serializeZodFailure(error: z.ZodError, kind: InteractorFailureKind): SerializedInteractorFailure {
	return {
		kind,
		issues: error.issues.map((issue) => ({
			code: issue.code,
			path: [...issue.path] as Array<string | number>,
			message: issue.message,
		})),
	};
}

export function mcpValidationFailure(error: z.ZodError): McpToolFailureResult {
	return {
		text: validationError(error),
		failure: serializeZodFailure(error, "validation"),
	};
}

export function mcpFailure(
	kind: InteractorFailureKind,
	message: string,
	path: Array<string | number> = [],
): McpToolFailureResult {
	return {
		text: message,
		failure: {
			kind,
			issues: [{ code: "custom", path, message }],
		},
	};
}

export async function executeMcpTool(
	tool: McpTool,
	rawInput: Record<string, unknown>,
): Promise<McpToolExecutionResult> {
	const parsed = tool.inputSchema.safeParse(rawInput);
	if (!parsed.success) {
		const failure = mcpValidationFailure(parsed.error);
		return {
			ok: false,
			result: failure.text,
			failure: failure.failure,
		};
	}

	try {
		const result = await tool.execute(parsed.data as Record<string, unknown>);
		if (typeof result === "string") {
			return { ok: true, result };
		}
		if ("failure" in result) {
			return { ok: false, result: result.text, failure: result.failure };
		}
		return { ok: true, result: result.text, structuredContent: result.structuredContent };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			result: message,
			failure: {
				kind: "notFound",
				issues: [{ code: "internal", path: [], message }],
			},
		};
	}
}
