import { describe, expect, it } from "bun:test";
import {
	allowsCredentialedHeaders,
	formatWebhookHeaderLines,
	isReservedWebhookHeader,
	parseStoredWebhookHeaders,
	parseWebhookHeaderLines,
	validateWebhookHeaders,
	WebhookHeadersSchema,
	WEBHOOK_HEADER_MAX_COUNT,
	WEBHOOK_HEADER_TOTAL_MAX_CHARS,
} from "../src/webhooks/webhook-headers";
import {
	signWebhookPayload,
	verifyWebhookSignature,
	WEBHOOK_SIGNATURE_HEADER,
} from "../src/webhooks/webhook-signature";
import {
	isRenderableWebhookBodyTemplate,
	renderWebhookBody,
	WEBHOOK_RENDERED_BODY_MAX_CHARS,
} from "../src/webhooks/webhook-body-template";
import { buildWebhookEventEnvelope, isWebhookEventName, WEBHOOK_EVENTS } from "../src/webhooks/webhook-events";

describe("webhook header validation", () => {
	it("accepts ordinary custom headers", () => {
		expect(validateWebhookHeaders({ "X-Tenant": "acme", Authorization: "Bearer abc" })).toEqual([]);
	});

	it("refuses reserved hop-by-hop and signing headers", () => {
		expect(isReservedWebhookHeader("Content-Type")).toBe(true);
		expect(isReservedWebhookHeader("x-webhook-signature")).toBe(true);
		expect(validateWebhookHeaders({ "X-Webhook-Signature": "spoofed" })).toContain("nameReserved");
		expect(validateWebhookHeaders({ Connection: "keep-alive" })).toContain("nameReserved");
	});

	it("refuses invalid names, values, duplicates and oversized sets", () => {
		expect(validateWebhookHeaders({ "Bad Header": "x" })).toContain("nameInvalid");
		expect(validateWebhookHeaders({ "X-Ok": "value\nwith newline" })).toContain("valueInvalid");
		expect(validateWebhookHeaders({ "X-A": "1", "x-a": "2" })).toContain("duplicateHeader");

		const tooMany: Record<string, string> = {};
		for (let index = 0; index <= WEBHOOK_HEADER_MAX_COUNT; index += 1) {
			tooMany[`X-H${index}`] = "v";
		}
		expect(validateWebhookHeaders(tooMany)).toContain("tooManyHeaders");

		const huge: Record<string, string> = { "X-Big": "a".repeat(WEBHOOK_HEADER_TOTAL_MAX_CHARS) };
		expect(validateWebhookHeaders(huge)).toContain("headersTooLarge");
	});

	it("agrees with the zod schema", () => {
		expect(WebhookHeadersSchema.safeParse({ "X-Ok": "1" }).success).toBe(true);
		expect(WebhookHeadersSchema.safeParse({ Connection: "close" }).success).toBe(false);
	});

	it("drops unusable stored headers and formats lines losslessly", () => {
		const stored = parseStoredWebhookHeaders({
			"X-Keep": "yes",
			"X-Strip": 42,
			Connection: "close",
			"X-Empty": "",
		});
		expect(stored).toEqual({ "X-Keep": "yes", "X-Empty": "" });

		expect(formatWebhookHeaderLines({ A: "1", B: "2" })).toBe("A: 1\nB: 2");
		expect(formatWebhookHeaderLines(null)).toBe("");
		expect(parseWebhookHeaderLines("A: 1\nB: 2\nmalformed\nC: 3")).toEqual({ A: "1", B: "2", C: "3" });
	});

	it("only lets credentialed headers travel to https or loopback", () => {
		expect(allowsCredentialedHeaders("https://hooks.example.com/x")).toBe(true);
		expect(allowsCredentialedHeaders("http://localhost:5678/x")).toBe(true);
		expect(allowsCredentialedHeaders("http://127.0.0.1/x")).toBe(true);
		expect(allowsCredentialedHeaders("http://hooks.example.com/x")).toBe(false);
		expect(allowsCredentialedHeaders("not a url")).toBe(false);
	});
});

describe("webhook signing", () => {
	const secret = "shhh-very-secret";
	const body = JSON.stringify({ event: "contact.created", id: "c1" });

	it("produces a stable hex HMAC-SHA256 of the exact body", () => {
		const signature = signWebhookPayload(secret, body);
		expect(signature).toMatch(/^[0-9a-f]{64}$/);
		expect(signWebhookPayload(secret, body)).toBe(signature);
		expect(signWebhookPayload(secret, `${body} `)).not.toBe(signature);
	});

	it("verifies authentic signatures and rejects tampering", () => {
		const signature = signWebhookPayload(secret, body);
		expect(verifyWebhookSignature(secret, body, signature)).toBe(true);
		expect(verifyWebhookSignature(secret, body, `${signature.slice(0, -1)}0`)).toBe(false);
		expect(verifyWebhookSignature(secret, body, signature.toUpperCase())).toBe(false);
		expect(verifyWebhookSignature("other-secret", body, signature)).toBe(false);
		expect(verifyWebhookSignature(secret, body, "")).toBe(false);
	});

	it("exports the exact wire header name", () => {
		expect(WEBHOOK_SIGNATURE_HEADER).toBe("x-webhook-signature");
	});
});

describe("webhook body templates", () => {
	const envelope = {
		event: "deal.updated",
		data: { userId: "u1", entityId: "d1", payload: { name: "Big \"Deal\"", amount: 12 } },
		timestamp: "2026-10-13T00:00:00.000Z",
	};

	it("substitutes dotted paths and JSON-escapes values", () => {
		const rendered = renderWebhookBody(
			'{"id":"{{data.entityId}}","name":"{{data.payload.name}}","amount":{{data.payload.amount}}}',
			envelope,
		);
		expect(rendered.ok).toBe(true);
		if (rendered.ok) {
			expect(rendered.body).toEqual({ id: "d1", name: 'Big "Deal"', amount: 12 });
		}
	});

	it("resolves missing paths to empty strings", () => {
		const rendered = renderWebhookBody('{"x":"{{data.nope.deep}}"}', envelope);
		expect(rendered.ok).toBe(true);
		if (rendered.ok) expect(rendered.body).toEqual({ x: "" });
	});

	it("rejects templates that do not produce a JSON object", () => {
		expect(renderWebhookBody('{"x": oops', envelope)).toEqual({ ok: false, reason: "invalidJson" });
		expect(renderWebhookBody('["{{data.entityId}}"]', envelope)).toEqual({ ok: false, reason: "notAnObject" });
		const oversized = `{"big":"${"a".repeat(WEBHOOK_RENDERED_BODY_MAX_CHARS)}"}`;
		expect(renderWebhookBody(oversized, envelope)).toEqual({ ok: false, reason: "tooLarge" });
	});

	it("proves the sample-template checker works", () => {
		expect(isRenderableWebhookBodyTemplate('{"id":"{{data.entityId}}"}')).toBe(true);
		expect(isRenderableWebhookBodyTemplate("{nope")).toBe(false);
	});
});

describe("webhook event registry", () => {
	it("knows its own event names", () => {
		expect(WEBHOOK_EVENTS.length).toBeGreaterThan(10);
		expect(isWebhookEventName("contact.created")).toBe(true);
		expect(isWebhookEventName("contact.createdx")).toBe(false);
	});

	it("builds the documented envelope", () => {
		const envelope = buildWebhookEventEnvelope("deal.created", "d9", { name: "X" }, "u1");
		expect(envelope.event).toBe("deal.created");
		expect(envelope.data.entityId).toBe("d9");
		expect(envelope.data.userId).toBe("u1");
		expect(envelope.data.payload).toEqual({ name: "X" });
		expect(envelope.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});
