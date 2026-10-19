/**
 * MCP Streamable HTTP endpoint — self-contained JSON-RPC 2.0 implementation.
 *
 * Protocol surface (matches `@modelcontextprotocol/sdk` semantics one-to-one):
 *   initialize  — negotiates protocol version + server info, mints a session id;
 *   tools/list  — exposes the `McpToolsService` catalog with JSON Schema inputs;
 *   tools/call  — executes a tool, returning MCP content blocks + structuredContent;
 *   ping        — liveness.
 *
 * Requests without a session are accepted for `initialize`; every other method
 * requires the `Mcp-Session-Id` header value returned by `initialize`.
 */

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { executeMcpTool, type McpTool } from "./mcp.types";
import { McpToolsService } from "./mcp-tools.service";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = {
	name: "comp-ai-crm",
	version: "1.15.3",
	title: "Comp AI CRM MCP Server",
} as const;

export type JsonRpcRequest = {
	jsonrpc: "2.0";
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: string | number | null;
	result?: Record<string, unknown>;
	error?: { code: number; message: string; data?: unknown };
};

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_INTERNAL_ERROR = -32603;

const sessionStore = new Map<string, { createdAt: Date }>();

export function resetMcpSessions(): void {
	sessionStore.clear();
}

function mintSession(): string {
	const sessionId = randomUUID();
	sessionStore.set(sessionId, { createdAt: new Date() });
	return sessionId;
}

function sessionExists(sessionId: string | undefined): boolean {
	if (!sessionId) return false;
	return sessionStore.has(sessionId);
}

function toolDescriptor(tool: McpTool): Record<string, unknown> {
	const descriptor: Record<string, unknown> = {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: z.toJSONSchema(tool.inputSchema, { io: "input" }) as Record<
			string,
			unknown
		>,
	};
	if (tool.annotations) {
		descriptor.annotations = tool.annotations;
	}
	return descriptor;
}

function errorResponse(
	id: string | number | null,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcResponse {
	const error: { code: number; message: string; data?: unknown } = { code, message };
	if (data !== undefined) {
		error.data = data;
	}
	return {
		jsonrpc: "2.0",
		id,
		error,
	};
}

@Injectable()
export class McpServerService {
	constructor(private readonly tools: McpToolsService) {}

	/**
	 * Handles one JSON-RPC message. `sessionId` is the inbound `Mcp-Session-Id`
	 * header; the return value carries the session id the caller must echo.
	 */
	async handle(
		message: JsonRpcRequest,
		sessionId?: string,
	): Promise<{
		response: JsonRpcResponse | null;
		sessionId: string | undefined;
	}> {
		const id = message.id ?? null;
		const isNotification = message.id === undefined;

		if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
			return {
				response: errorResponse(
					id,
					JSON_RPC_INVALID_REQUEST,
					"Invalid JSON-RPC 2.0 request",
				),
				sessionId,
			};
		}

		switch (message.method) {
			case "initialize": {
				const newSession = mintSession();
				return {
					response: {
						jsonrpc: "2.0",
						id,
						result: {
							protocolVersion: MCP_PROTOCOL_VERSION,
							capabilities: { tools: { listChanged: false } },
							serverInfo: MCP_SERVER_INFO,
						},
					},
					sessionId: newSession,
				};
			}

			case "ping": {
				if (!sessionExists(sessionId))
					return this.sessionRequired(id, sessionId);
				return { response: { jsonrpc: "2.0", id, result: {} }, sessionId };
			}

			case "tools/list": {
				if (!sessionExists(sessionId))
					return this.sessionRequired(id, sessionId);
				return {
					response: {
						jsonrpc: "2.0",
						id,
						result: { tools: this.tools.catalog().map(toolDescriptor) },
					},
					sessionId,
				};
			}

			case "tools/call": {
				if (!sessionExists(sessionId))
					return this.sessionRequired(id, sessionId);
				return this.handleToolCall(message, id, sessionId);
			}

			default: {
				if (isNotification) return { response: null, sessionId };
				return {
					response: errorResponse(
						id,
						JSON_RPC_METHOD_NOT_FOUND,
						`Method ${message.method} is not supported`,
					),
					sessionId,
				};
			}
		}
	}

	private sessionRequired(
		id: string | number | null,
		sessionId: string | undefined,
	): { response: JsonRpcResponse; sessionId: string | undefined } {
		return {
			response: errorResponse(
				id,
				JSON_RPC_INVALID_REQUEST,
				"Missing or unknown Mcp-Session-Id; call initialize first",
				{ receivedSessionId: sessionId ?? null },
			),
			sessionId,
		};
	}

	private async handleToolCall(
		message: JsonRpcRequest,
		id: string | number | null,
		sessionId: string | undefined,
	): Promise<{ response: JsonRpcResponse; sessionId: string | undefined }> {
		const params = message.params ?? {};
		const name = params.name;
		const args = params.arguments;

		if (typeof name !== "string") {
			return {
				response: errorResponse(
					id,
					JSON_RPC_INVALID_PARAMS,
					"tools/call requires params.name",
				),
				sessionId,
			};
		}

		const tool = this.tools
			.catalog()
			.find((candidate) => candidate.name === name);
		if (!tool) {
			return {
				response: errorResponse(
					id,
					JSON_RPC_INVALID_PARAMS,
					`Unknown tool ${name}`,
				),
				sessionId,
			};
		}

		const input =
			args && typeof args === "object" && !Array.isArray(args)
				? (args as Record<string, unknown>)
				: {};

		const execution = await executeMcpTool(tool, input);
		const content = [{ type: "text", text: execution.result }];

		if (execution.ok) {
			return {
				response: {
					jsonrpc: "2.0",
					id,
					result: {
						content,
						structuredContent: execution.structuredContent ?? {},
						isError: false,
					},
				},
				sessionId,
			};
		}

		return {
			response: {
				jsonrpc: "2.0",
				id,
				result: {
					content,
					structuredContent: { failure: execution.failure },
					isError: true,
				},
			},
			sessionId,
		};
	}
}
