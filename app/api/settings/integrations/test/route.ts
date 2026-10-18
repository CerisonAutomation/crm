import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { getIntegration } from "@/lib/integrations";
import nodemailer from "nodemailer";
import { probeBexio } from "@/lib/services/bexio";
import { probeGithub } from "@/lib/services/github";
import { probeXero } from "@/lib/services/xero";

/** Overall per-probe budget so a hanging provider cannot wedge the admin console. */
const BUDGET_MS = 8_000;

type ProbeResult = { ok: boolean; detail: string };

async function probe(key: string, config: Record<string, unknown>): Promise<ProbeResult> {
  switch (key) {
    case "smtp": {
      const host = String(config.host ?? "").trim();
      if (!host) return { ok: false, detail: "SMTP host is not configured." };
      try {
        const transport = nodemailer.createTransport({
          host,
          port: Number(config.port ?? 587),
          secure: Boolean(config.secure ?? false),
          auth: config.user ? { user: String(config.user), pass: String(config.pass ?? "") } : undefined,
          connectionTimeout: 6_000,
        });
        await transport.verify();
        return { ok: true, detail: `SMTP connection to ${host} verified.` };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "SMTP verification failed." };
      }
    }
    case "resend": {
      const apiKey = String(config.apiKey ?? "").trim();
      const from = String(config.from ?? "").trim();
      if (!apiKey) return { ok: false, detail: "Resend API key is not configured." };
      if (!from) return { ok: false, detail: "Verified from address is not configured." };
      try {
        const res = await fetch("https://api.resend.com/domains", {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(BUDGET_MS),
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: false, detail: `Resend rejected the API key (HTTP ${res.status}).` };
        }
        if (!res.ok) {
          return { ok: false, detail: `Resend responded HTTP ${res.status}.` };
        }
        return { ok: true, detail: "Resend API key accepted." };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "Resend unreachable." };
      }
    }
    case "whatsapp": {
      const provider = String(config.provider ?? "cloud_api");
      if (provider === "webhook") {
        const url = String(config.url ?? "").trim();
        if (!url) return { ok: false, detail: "Webhook URL is not configured." };
        try {
          const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(BUDGET_MS) });
          if (!res.ok && res.status !== 405) {
            return { ok: false, detail: `Webhook responded HTTP ${res.status}.` };
          }
          return { ok: true, detail: "WhatsApp webhook endpoint reachable." };
        } catch (err) {
          return { ok: false, detail: err instanceof Error ? err.message : "WhatsApp webhook unreachable." };
        }
      }
      const token = String(config.token ?? "").trim();
      const phoneNumberId = String(config.phoneNumberId ?? "").trim();
      if (!token) return { ok: false, detail: "WhatsApp access token is not configured." };
      if (!phoneNumberId) return { ok: false, detail: "WhatsApp phone number ID is not configured." };
      try {
        const res = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(phoneNumberId)}`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(BUDGET_MS),
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: false, detail: `WhatsApp rejected the token (HTTP ${res.status}).` };
        }
        if (!res.ok) {
          return { ok: false, detail: `WhatsApp responded HTTP ${res.status}.` };
        }
        return { ok: true, detail: "WhatsApp Cloud API credentials accepted." };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "WhatsApp unreachable." };
      }
    }
    case "webhook": {
      const url = String(config.url ?? "").trim();
      if (!url) return { ok: false, detail: "Default webhook URL is not configured." };
      try {
        const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(BUDGET_MS) });
        if (!res.ok && res.status !== 405) {
          return { ok: false, detail: `Webhook responded HTTP ${res.status}.` };
        }
        return { ok: true, detail: "Webhook endpoint reachable." };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "Webhook unreachable." };
      }
    }
    case "dhl": {
      const accountNumber = String(config.accountNumber ?? "").trim();
      const username = String(config.username ?? "").trim();
      const password = String(config.password ?? "").trim();
      if (!accountNumber) return { ok: false, detail: "DHL account number is not configured." };
      if (!username || !password) return { ok: false, detail: "DHL API credentials are not configured." };
      const env = String(config.environment ?? "test") === "production" ? "production" : "test";
      const base = env === "test" ? "https://express.api.dhl.com/mydhlapi/test" : "https://express.api.dhl.com/mydhlapi";
      const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      try {
        const res = await fetch(`${base}/`, {
          headers: { authorization: auth },
          signal: AbortSignal.timeout(BUDGET_MS),
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: false, detail: `DHL rejected the credentials (HTTP ${res.status}).` };
        }
        return { ok: true, detail: `DHL ${env} endpoint reachable.` };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "DHL unreachable." };
      }
    }
    case "ai": {
      return { ok: true, detail: "Sandbox AI is keyless — no credential required." };
    }
    case "automation": {
      return { ok: true, detail: "In-app automation engine — no external service." };
    }
    case "n8n": {
      const baseUrl = String(config.baseUrl ?? "").trim().replace(/\/+$/, "");
      if (!baseUrl) return { ok: false, detail: "n8n base URL is not configured." };
      const apiKey = String(config.apiKey ?? "").trim();
      try {
        const headers: Record<string, string> = {};
        if (apiKey) headers["X-N8N-API-KEY"] = apiKey;
        const path = apiKey ? "/api/v1/workflows" : "/healthz";
        const res = await fetch(`${baseUrl}${path}`, {
          headers,
          signal: AbortSignal.timeout(BUDGET_MS),
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: false, detail: `n8n rejected the API key (HTTP ${res.status}).` };
        }
        if (!res.ok) {
          return { ok: false, detail: `n8n responded HTTP ${res.status}.` };
        }
        return { ok: true, detail: "n8n instance reachable." };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : "n8n unreachable." };
      }
    }
    case "xero": {
      return probeXero(config);
    }
    case "bexio": {
      return probeBexio(config);
    }
    case "github": {
      return probeGithub(config);
    }
    default: {
      return { ok: false, detail: `Unknown integration: ${key}` };
    }
  }
}

/** POST /api/settings/integrations/test — live connectivity check */
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "automation.manage");

    const { key } = await readJson<{ key?: unknown }>(r);

    if (!key || typeof key !== "string") {
      throw new DomainError("Integration key is required", 400);
    }

    const { config } = await getIntegration(key as any);

    const result = await probe(key, config as Record<string, unknown>);

    return jsonOk({ ok: result.ok, detail: result.detail, checkedAt: new Date().toISOString() });
  })(req);
}
