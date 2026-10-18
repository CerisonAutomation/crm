import { describe, expect, it } from "bun:test";
import {
	buildDefaultProviders,
	InstagramChannelProvider,
	LinkedInChannelProvider,
	MessengerChannelProvider,
	WhatsAppChannelProvider,
} from "../src/channels/channel-providers";
import { metaHubChallenge } from "../src/channels/channel-contracts";
import {
	hasEnv,
	IntegrationRegistryService,
	ProviderEnvAdapter,
} from "../src/channels/integration-registry.service";

const webhook = {
	entry: [
		{
			id: "page-1",
			time: 1760000000000,
			messaging: [
				{
					sender: { id: "user-9" },
					recipient: { id: "page-1" },
					timestamp: 1760000000000,
					message: {
						mid: "wamid.abc",
						text: "Hello",
						attachments: [{ type: "image", payload: { url: "https://cdn/img.png" } }],
					},
				},
			],
		},
	],
};

describe("Meta channel providers normalize inbound webhooks", () => {
	it("whatsapp normalizes messages", () => {
		const messages = new WhatsAppChannelProvider().normalizeInbound(webhook);
		expect(messages.length).toBe(1);
		expect(messages[0]?.externalId).toBe("wamid.abc");
		expect(messages[0]?.senderHandle).toBe("user-9");
		expect(messages[0]?.body).toBe("Hello");
		expect(messages[0]?.media).toEqual([{ type: "image", url: "https://cdn/img.png" }]);
		expect(messages[0]?.occurredAt.getTime()).toBe(1760000000000);
	});

	it("messenger and instagram share the messaging envelope", () => {
		expect(new MessengerChannelProvider().normalizeInbound(webhook)[0]?.provider).toBe("messenger");
		expect(new InstagramChannelProvider().normalizeInbound(webhook)[0]?.provider).toBe("instagram");
	});

	it("drops events without a message id", () => {
		const empty = { entry: [{ id: "p", messaging: [{ sender: { id: "u" }, recipient: { id: "p" } }] }] };
		expect(new WhatsAppChannelProvider().normalizeInbound(empty)).toEqual([]);
	});
});

describe("LinkedIn channel provider", () => {
	it("normalizes LinkedIn message events", () => {
		const provider = new LinkedInChannelProvider();
		const messages = provider.normalizeInbound({
			value: [
				{
					id: "msg-1",
					from: "urn:li:person:111",
					to: ["urn:li:organization:222"],
					body: "Hi there",
					sentAt: 1760000000000,
					conversationId: "conv-7",
				},
			],
		});
		expect(messages.length).toBe(1);
		expect(messages[0]?.senderHandle).toBe("urn:li:person:111");
		expect(messages[0]?.threadId).toBe("conv-7");
		expect(messages[0]?.body).toBe("Hi there");
	});

	it("builds an authorization URL with PKCE parameters", () => {
		const provider = new LinkedInChannelProvider();
		const url = provider.generateAuthUrl({
			redirectUri: "https://app.example.com/callback",
			codeVerifier: "x".repeat(43),
			state: "0123456789abcdef",
		});
		expect(url).toContain("linkedin.com/oauth/v2/authorization");
		expect(url).toContain("code_challenge_method=S256");
		expect(url).toContain("state=0123456789abcdef");
	});
});

describe("meta hub handshake", () => {
	it("echoes the challenge only for a matching verify token", () => {
		expect(
			metaHubChallenge({ mode: "subscribe", token: "secret", verifyToken: "secret", challenge: "123" }),
		).toBe("123");
		expect(
			metaHubChallenge({ mode: "subscribe", token: "wrong", verifyToken: "secret", challenge: "123" }),
		).toBeNull();
		expect(metaHubChallenge({ mode: "delete", token: "secret", verifyToken: "secret", challenge: "123" })).toBeNull();
	});
});

describe("tiered integration registry", () => {
	it("filters configured adapters by env gates (tier2 semantics)", async () => {
		const registry = new IntegrationRegistryService();
		registry.register(new ProviderEnvAdapter("whatsapp", "tier1", ["META_APP_ID", "META_APP_SECRET"]));
		registry.register(new ProviderEnvAdapter("linkedin", "tier2", ["LINKEDIN_CLIENT_ID"]));

		const partial = { META_APP_ID: "1", META_APP_SECRET: "" } as unknown as NodeJS.ProcessEnv;
		expect(registry.getConfigured(partial).map((descriptor) => descriptor.id)).toEqual([]);

		const full = {
			META_APP_ID: "1",
			META_APP_SECRET: "s",
			LINKEDIN_CLIENT_ID: "li",
		} as unknown as NodeJS.ProcessEnv;
		expect(registry.getConfigured(full).map((descriptor) => descriptor.id).sort()).toEqual([
			"linkedin",
			"whatsapp",
		]);
		expect(registry.getByTier("tier1").map((descriptor) => descriptor.id)).toEqual(["whatsapp"]);

		const health = await registry.healthCheckAll(full);
		expect(health.checked.sort()).toEqual(["linkedin", "whatsapp"]);
		expect(health.results.every((result) => result.ok)).toBe(true);
	});

	it("rejects duplicate registrations", () => {
		const registry = new IntegrationRegistryService();
		registry.register(new ProviderEnvAdapter("whatsapp", "tier1", []));
		expect(() => registry.register(new ProviderEnvAdapter("whatsapp", "tier1", []))).toThrow();
	});

	it("hasEnv requires every key to be non-empty", () => {
		expect(hasEnv(["A", "B"], { A: "1", B: "2" } as unknown as NodeJS.ProcessEnv)).toBe(true);
		expect(hasEnv(["A", "B"], { A: "1", B: "" } as unknown as NodeJS.ProcessEnv)).toBe(false);
		expect(hasEnv(["A"], {} as unknown as NodeJS.ProcessEnv)).toBe(false);
	});
});

describe("provider registry factory", () => {
	it("builds all four channels", () => {
		const providers = buildDefaultProviders();
		expect([...providers.keys()].sort()).toEqual([
			"instagram",
			"linkedin",
			"messenger",
			"whatsapp",
		]);
	});
});
