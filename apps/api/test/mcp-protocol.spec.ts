import { beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import {
	executeMcpTool,
	type McpTool,
	mcpFailure,
	mcpValidationFailure,
} from "../src/mcp/mcp.types";
import {
	type JsonRpcRequest,
	MCP_PROTOCOL_VERSION,
	MCP_SERVER_INFO,
	McpServerService,
	resetMcpSessions,
} from "../src/mcp/mcp-server.service";
import { McpToolsService } from "../src/mcp/mcp-tools.service";

const echoTool: McpTool = {
	name: "echo",
	title: "Echo",
	description: "Echoes the message back.",
	inputSchema: z.object({ message: z.string().min(1) }),
	execute: (input) => ({
		text: "echoed",
		structuredContent: { message: (input as { message: string }).message },
	}),
};

const boomTool: McpTool = {
	name: "boom",
	title: "Boom",
	description: "Always throws.",
	inputSchema: z.object({}),
	execute: () => {
		throw new Error("exploded");
	},
};

const failingTool: McpTool = {
	name: "guarded",
	title: "Guarded",
	description: "Returns a structured failure.",
	inputSchema: z.object({ id: z.string() }),
	execute: () => mcpFailure("notFound", "nothing with that id"),
};

class FakeToolsService extends McpToolsService {
	constructor() {
		super(
			null as never,
			null as never,
			null as never,
			null as never,
			null as never,
			null as never,
			null as never,
			null as never,
		);
	}

	override catalog(): McpTool[] {
		return [echoTool, boomTool, failingTool];
	}
}

function request(
	method: string,
	params?: Record<string, unknown>,
	id: string | number = 1,
): JsonRpcRequest {
	const req: JsonRpcRequest = { jsonrpc: "2.0", id, method };
	if (params) {
		req.params = params;
	}
	return req;
}

describe("the MCP server protocol", () => {
	let server: McpServerService;

	beforeEach(() => {
		resetMcpSessions();
		server = new McpServerService(new FakeToolsService());
	});

	it("initializes with protocol version, capabilities and server info", async () => {
		const { response, sessionId } = await server.handle(request("initialize"));
		expect(sessionId).toBeTruthy();
		expect(response?.result?.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
		expect(response?.result?.serverInfo).toEqual(MCP_SERVER_INFO);
		expect(response?.result?.capabilities).toEqual({
			tools: { listChanged: false },
		});
	});

	it("requires a session for every method after initialize", async () => {
		const { response } = await server.handle(request("tools/list"));
		expect(response?.error?.code).toBe(-32600);
		expect(response?.error?.message).toContain("Mcp-Session-Id");
	});

	it("lists tools with JSON Schema inputs", async () => {
		const init = await server.handle(request("initialize"));
		const { response } = await server.handle(
			request("tools/list"),
			init.sessionId,
		);
		const tools = (response?.result?.tools ?? []) as Array<
			Record<string, unknown>
		>;
		expect(tools.length).toBe(3);
		const echo = tools.find((tool) => tool.name === "echo");
		expect(echo?.title).toBe("Echo");
		const schema = echo?.inputSchema as { type: string; required?: string[] };
		expect(schema.type).toBe("object");
		expect(schema.required).toContain("message");
	});

	it("calls a tool and returns content plus structuredContent", async () => {
		const init = await server.handle(request("initialize"));
		const { response } = await server.handle(
			request("tools/call", { name: "echo", arguments: { message: "hi" } }),
			init.sessionId,
		);
		expect(response?.result?.isError).toBe(false);
		expect(response?.result?.structuredContent).toEqual({ message: "hi" });
		const content = (response?.result?.content ?? []) as Array<{
			type: string;
			text: string;
		}>;
		expect(content[0]).toEqual({ type: "text", text: "echoed" });
	});

	it("reports tool-thrown errors as tool failures, not protocol errors", async () => {
		const init = await server.handle(request("initialize"));
		const { response } = await server.handle(
			request("tools/call", { name: "boom", arguments: {} }),
			init.sessionId,
		);
		expect(response?.result?.isError).toBe(true);
		expect(response?.error).toBeUndefined();
		const content = (response?.result?.content ?? []) as Array<{
			text: string;
		}>;
		expect(content[0]?.text).toBe("exploded");
	});

	it("passes structured failures through unchanged", async () => {
		const init = await server.handle(request("initialize"));
		const { response } = await server.handle(
			request("tools/call", { name: "guarded", arguments: { id: "x" } }),
			init.sessionId,
		);
		expect(response?.result?.isError).toBe(true);
		const structured = response?.result?.structuredContent as {
			failure: { kind: string; issues: Array<{ message: string }> };
		};
		expect(structured.failure.kind).toBe("notFound");
		expect(structured.failure.issues[0]?.message).toBe("nothing with that id");
	});

	it("validates tool input and returns a serialized validation failure", async () => {
		const init = await server.handle(request("initialize"));
		const { response } = await server.handle(
			request("tools/call", { name: "echo", arguments: { message: "" } }),
			init.sessionId,
		);
		expect(response?.result?.isError).toBe(true);
		const structured = response?.result?.structuredContent as {
			failure: { kind: string };
		};
		expect(structured.failure.kind).toBe("validation");
		const content = (response?.result?.content ?? []) as Array<{
			text: string;
		}>;
		expect(content[0]?.text).toContain("Validation error:");
	});

	it("rejects unknown methods and unknown tools with JSON-RPC errors", async () => {
		const init = await server.handle(request("initialize"));
		const unknownMethod = await server.handle(
			request("resources/list"),
			init.sessionId,
		);
		expect(unknownMethod.response?.error?.code).toBe(-32601);

		const unknownTool = await server.handle(
			request("tools/call", { name: "ghost", arguments: {} }),
			init.sessionId,
		);
		expect(unknownTool.response?.error?.code).toBe(-32602);
	});

	it("answers ping and rejects malformed envelopes", async () => {
		const init = await server.handle(request("initialize"));
		const pong = await server.handle(request("ping"), init.sessionId);
		expect(pong.response?.result).toEqual({});

		const malformed = await server.handle({
			jsonrpc: "1.0",
			id: 9,
			method: "ping",
		} as unknown as JsonRpcRequest);
		expect(malformed.response?.error?.code).toBe(-32600);
	});

	it("swallows notifications without answering", async () => {
		const init = await server.handle(request("initialize"));
		const { response } = await server.handle(
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			init.sessionId,
		);
		expect(response).toBeNull();
	});
});

describe("mcp failure helpers", () => {
	it("serializes zod validation failures with path information", () => {
		const schema = z.object({ nested: z.object({ n: z.number() }) });
		const parsed = schema.safeParse({ nested: { n: "x" } });
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			const failure = mcpValidationFailure(parsed.error);
			expect(failure.text.startsWith("Validation error:")).toBe(true);
			expect(failure.failure.kind).toBe("validation");
			expect(failure.failure.issues.length).toBeGreaterThan(0);
		}
	});

	it("routes async tool work through executeMcpTool uniformly", async () => {
		const result = await executeMcpTool(echoTool, { message: "ping" });
		expect(result.ok).toBe(true);
		expect(result.ok && result.structuredContent).toEqual({ message: "ping" });

		const rejected = await executeMcpTool(echoTool, {});
		expect(rejected.ok).toBe(false);
		expect(rejected.ok === false && rejected.failure.kind).toBe("validation");
	});
});
