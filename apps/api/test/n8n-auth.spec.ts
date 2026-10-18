import { afterEach, describe, expect, it } from "bun:test";
import { automationBearerValid } from "../src/n8n/n8n.controller";
import { mcpTokenFromEnv } from "../src/mcp/mcp.controller";
import { classifyDeliveryFailure, WEBHOOK_PREFLIGHT_FAILURE_STATUS } from "../src/workflows/deliver-webhook.workflow";
import { classifyStartFailure } from "../src/workflows/run-routine.workflow";

const LONG_SECRET = "0123456789abcdef0123456789abcdef";

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
	const previous: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(values)) {
		previous[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		fn();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

afterEach(() => {
	delete process.env.N8N_TRIGGER_TOKEN;
	delete process.env.CRON_SECRET;
	delete process.env.MCP_AUTH_TOKEN;
});

describe("automation bearer auth", () => {
	it("accepts the configured trigger token or cron secret", () => {
		withEnv({ N8N_TRIGGER_TOKEN: LONG_SECRET, CRON_SECRET: undefined }, () => {
			expect(automationBearerValid(`Bearer ${LONG_SECRET}`)).toBe(true);
			expect(automationBearerValid(`bearer ${LONG_SECRET}`)).toBe(true);
			expect(automationBearerValid(`Bearer ${LONG_SECRET}x`)).toBe(false);
			expect(automationBearerValid(LONG_SECRET)).toBe(false);
			expect(automationBearerValid(undefined)).toBe(false);
		});
	});

	it("falls back to CRON_SECRET when no trigger token is set", () => {
		withEnv({ N8N_TRIGGER_TOKEN: undefined, CRON_SECRET: LONG_SECRET }, () => {
			expect(automationBearerValid(`Bearer ${LONG_SECRET}`)).toBe(true);
		});
	});

	it("fails closed when no secret is configured", () => {
		withEnv({ N8N_TRIGGER_TOKEN: undefined, CRON_SECRET: undefined }, () => {
			expect(automationBearerValid(`Bearer ${LONG_SECRET}`)).toBe(false);
		});
	});

	it("refuses weak configured secrets so operators cannot enable 2-char auth", () => {
		withEnv({ N8N_TRIGGER_TOKEN: "short", CRON_SECRET: undefined }, () => {
			expect(automationBearerValid("Bearer short")).toBe(false);
		});
	});
});

describe("mcp token configuration", () => {
	it("accepts only tokens of at least 16 characters", () => {
		withEnv({ MCP_AUTH_TOKEN: LONG_SECRET }, () => {
			expect(mcpTokenFromEnv()).toBe(LONG_SECRET);
		});
		withEnv({ MCP_AUTH_TOKEN: "tiny" }, () => {
			expect(mcpTokenFromEnv()).toBeNull();
		});
		withEnv({ MCP_AUTH_TOKEN: undefined }, () => {
			expect(mcpTokenFromEnv()).toBeNull();
		});
	});
});

describe("delivery failure classification", () => {
	it("passes when the delivery succeeded", () => {
		expect(classifyDeliveryFailure({ status: "success", statusCode: 200, responseMessage: "OK" })).toBeNull();
	});

	it("treats retryable statuses as external failures", () => {
		const failure = classifyDeliveryFailure({ status: "failed", statusCode: 503, responseMessage: "unavailable" });
		expect(failure?.name).toBe("WebhookExternalFailure");
		const timeout = classifyDeliveryFailure({
			status: "failed",
			statusCode: null,
			responseMessage: "Request timed out after 5000ms",
		});
		expect(timeout?.name).toBe("WebhookExternalFailure");
	});

	it("treats hard 4xx rejections as non-retryable", () => {
		const failure = classifyDeliveryFailure({ status: "failed", statusCode: 404, responseMessage: "missing" });
		expect(failure?.name).toBe("WebhookNonRetryableFailure");
		const retryable429 = classifyDeliveryFailure({ status: "failed", statusCode: 429, responseMessage: "slow down" });
		expect(retryable429?.name).toBe("WebhookExternalFailure");
	});

	it("exports the preflight status used for 422 rejections", () => {
		expect(WEBHOOK_PREFLIGHT_FAILURE_STATUS).toBe(422);
	});
});

describe("routine start failure reasons", () => {
	it("maps inactive-owner failures distinctly", () => {
		expect(classifyStartFailure(new Error("user is inactive"))).toBe("ownerInactive");
		expect(classifyStartFailure(new Error("connection lost"))).toBe("startFailed");
		expect(classifyStartFailure("string failure")).toBe("startFailed");
	});
});
