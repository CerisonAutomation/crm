/**
 * HTTP surface for the MCP server: `POST /api/mcp`.
 *
 * Auth: `Authorization: Bearer <MCP_AUTH_TOKEN>` (the token is required config;
 * the endpoint refuses to answer without it). The client echoes the
 * `Mcp-Session-Id` header from the initialize response.
 */

import {
	Body,
	Controller,
	HttpCode,
	HttpException,
	InternalServerErrorException,
	Logger,
	Post,
	Req,
	Res,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { type JsonRpcRequest, McpServerService } from "./mcp-server.service";

export const MCP_SESSION_HEADER = "mcp-session-id";
export const MCP_AUTH_HEADER = "authorization";

export function mcpTokenFromEnv(): string | null {
	const token = process.env.MCP_AUTH_TOKEN;
	return token && token.length >= 16 ? token : null;
}

function timingSafeStringEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let index = 0; index < a.length; index += 1) {
		diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return diff === 0;
}

@ApiTags("MCP")
@Controller("api/mcp")
export class McpController {
	private readonly logger = new Logger(McpController.name);

	constructor(private readonly server: McpServerService) {}

	@Post()
	@HttpCode(200)
	@ApiOperation({
		summary:
			"MCP Streamable HTTP endpoint (initialize, tools/list, tools/call, ping)",
	})
	@ApiBearerAuth()
	@ApiOkResponse({ description: "JSON-RPC 2.0 response" })
	async handle(
		@Body() body: unknown,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	) {
		const expectedToken = mcpTokenFromEnv();
		if (!expectedToken) {
			this.logger.error(
				"MCP_AUTH_TOKEN is not configured; refusing MCP traffic",
			);
			throw new InternalServerErrorException(
				"MCP endpoint is disabled until MCP_AUTH_TOKEN (min 16 chars) is configured",
			);
		}

		const header = req.headers[MCP_AUTH_HEADER];
		const presented =
			typeof header === "string" && header.toLowerCase().startsWith("bearer ")
				? header.slice("bearer ".length)
				: "";
		if (!presented || !timingSafeStringEqual(presented, expectedToken)) {
			throw new HttpException("Invalid MCP bearer token", 401);
		}

		if (body === null || typeof body !== "object" || Array.isArray(body)) {
			throw new HttpException("MCP endpoint expects a JSON-RPC object", 400);
		}

		const inboundSession = req.headers[MCP_SESSION_HEADER];
		const sessionId =
			typeof inboundSession === "string" ? inboundSession : undefined;

		const { response, sessionId: nextSession } = await this.server.handle(
			body as JsonRpcRequest,
			sessionId,
		);

		if (nextSession) res.setHeader(MCP_SESSION_HEADER, nextSession);
		return response ?? {};
	}
}
