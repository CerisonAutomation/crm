/**
 * AI Cascade Server Proxy — handles OpenRouter calls with storage law compliance.
 *
 * This endpoint is the ONLY way the client can reach OpenRouter. It enforces:
 * 1. Feature flag check (ai.cloud.enabled)
 * 2. PII stripping (already done client-side, verified server-side)
 * 3. Audit logging for cross-border transfers (GDPR Art. 44-49)
 * 4. Rate limiting
 * 5. API key never exposed to client
 * 6. Per-org daily spend cap (server-side — the 20K client char cap is bypassable)
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { callOpenRouter, logOpenRouterCall, openRouterConfigured } from "@/lib/ai/openrouter";
import { hit } from "@/lib/rate-limit";
import { detectPromptInjection } from "@/lib/ai/injection-detection";
import { buildAiRunCost } from "@/lib/ai/cost";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handler(async (r) => {
  const ctx = await requireAuth(r);
  requireCapability(ctx, "case.read.own");

  // Check feature flag
  const flag = await db.featureFlag.findUnique({ where: { key: "ai.cloud.enabled" } });
  if (!flag?.enabled) {
    return jsonOk({ error: "Cloud AI disabled by feature flag" }, 403);
  }

  // Check OpenRouter configuration
  if (!openRouterConfigured()) {
    return jsonOk({ error: "OpenRouter not configured" }, 503);
  }

  // Rate limit: 20 requests/minute per user
  const rl = hit(`ai:cascade:${ctx.userId}`, 20, 60_000);
  if (!rl.allowed) {
    return jsonOk({ error: "Rate limit exceeded" }, 429);
  }

  const body = await readJson<unknown>(r);
  if (
    !body ||
    typeof body !== "object" ||
    !("messages" in body) ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0 ||
    body.messages.length > 50 ||
    body.messages.some(
      (message) =>
        !message ||
        typeof message !== "object" ||
        !("role" in message) ||
        !("content" in message) ||
        !["system", "user", "assistant"].includes(message.role as string) ||
        typeof message.content !== "string" ||
        message.content.length > 20_000,
    )
  ) {
    return jsonOk({ error: "Messages required" }, 400);
  }

  const messages = body.messages as Array<{ role: "system" | "user" | "assistant"; content: string }>;

  // C7 injection firewall (route-level block): every user-role message is
  // screened before the cascade runs. A blocked message fails closed (400)
  // and is never forwarded to OpenRouter.
  // PATCH-05: the client must never supply system messages — the system prompt
  // is server-authored. A client system message would overwrite grounding and
  // policy instructions for the whole cascade call.
  if (messages.some((m) => m.role === "system")) {
    return jsonOk({ error: "System role not allowed in client messages" }, 400);
  }

  // Ponytail-S #5: assistant lines are screened too — a poisoned turn smuggled
  // into conversation history would otherwise ride along unexamined (the model
  // obeys the whole context, not just the latest user line). Same block/flag
  // semantics; the audit reason names the offending role.
  let flaggedCount = 0;
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const scan = detectPromptInjection(m.content);
    if (scan.blocked) {
      await db.auditEvent.create({
        data: {
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: ctx.name,
          action: "ai.cascade.injection_blocked",
          target: "openrouter",
          reason: `Suspected prompt injection in ${m.role} message — request rejected`,
        },
      });
      return jsonOk({ error: "Message rejected: suspected prompt injection" }, 400);
    }
    if (scan.suspicious) flaggedCount++;
  }
  if (flaggedCount > 0) {
    // Below-threshold probes: allowed, but observed for review.
    await db.auditEvent.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: ctx.name,
        action: "ai.cascade.injection_flagged",
        target: "openrouter",
        reason: `${flaggedCount} message(s) matched injection patterns below the block threshold — cloud call allowed, flagged for review`,
      },
    });
  }

  // Server spend cap per org/day (the 20K client char cap is bypassable — a
  // hostile client can spray max-size prompts at 20 req/min). Spend is
  // ledgered on AiRun.costMillicents exact (agent "cascade", S4 epoch
  // 2026-10-10: backfilled millis = cents*1000, writers set both, readers
  // read millis — never mixed); costCents stays the ceil display value. The
  // pre-call check uses the cost UPPER BOUND (full prompt + provider
  // max_tokens window, whole cents) so the cap can never be overshot by an
  // in-flight call.
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const spendCap = Number(process.env.AI_ORG_DAILY_SPEND_CAP_CENTS ?? "") || 2000;
  const { costCents: estimatedCost } = buildAiRunCost({
    placement: "cloud",
    model: "openai/gpt-4o-mini",
    promptChars,
    completionChars: 4096,
    latencyMs: 0,
  });
  const estimatedLedger = Math.max(1, Math.ceil(estimatedCost));
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const spentMillis =
    (
      await db.aiRun.aggregate({
        where: { orgId: ctx.orgId, agent: "cascade", createdAt: { gte: dayStart } },
        _sum: { costMillicents: true },
      })
    )._sum.costMillicents ?? 0;
  const spentToday = Math.ceil(spentMillis / 1000);
  if (spentToday + estimatedLedger > spendCap) {
    await db.auditEvent.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: ctx.name,
        action: "ai.cascade.spend_capped",
        target: "openrouter",
        reason: `Organisation daily AI spend cap reached (${spentToday}/${spendCap} cents) — cloud call rejected`,
      },
    });
    return jsonOk({ error: "Organisation daily AI spend cap reached" }, 429);
  }

  // Verify PII was stripped (defense in depth)
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser?.content) {
    const piiPatterns = [
      /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
      /\b[A-Z]{2}\d{6,9}\b/,
      /[\w.+-]+@[\w-]+\.[\w.-]+/,
      /\+?\d{1,3}[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/,
    ];
    for (const pattern of piiPatterns) {
      if (pattern.test(lastUser.content)) {
        await db.auditEvent.create({
          data: {
            orgId: ctx.orgId,
            actorId: ctx.userId,
            actorLabel: ctx.name,
            action: "ai.cascade.pii_detected",
            target: "openrouter",
            reason: "PII pattern detected in cloud AI request — request rejected",
          },
        });
        return jsonOk({ error: "PII detected in request — cloud call blocked" }, 400);
      }
    }
  }

  try {
    const startedAt = Date.now();
    const result = await callOpenRouter(messages, { timeoutMs: 30_000 });
    if (!result) {
      return jsonOk({ error: "OpenRouter request failed" }, 502);
    }
    const latencyMs = Date.now() - startedAt;

    // Ledger the actual cost (upper-bounded above, so the cap still holds).
    const { costCents: actualCost, costMillicents: actualMillis } = buildAiRunCost({
      placement: "cloud",
      model: result.model,
      promptChars,
      completionChars: result.text.length,
      latencyMs,
    });
    await db.aiRun.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        agent: "cascade",
        provider: "openrouter",
        authority: "cloud-fallback",
        confidence: 0,
        reply: result.text,
        contextUsed: { messageCount: messages.length, model: result.model },
        latencyMs,
        costCents: Math.max(1, Math.ceil(actualCost)),
        costMillicents: Math.max(1, actualMillis),
      },
    });

    // Audit log the cross-border transfer
    await logOpenRouterCall(ctx.orgId, ctx.userId, result.model, messages.length);

    return jsonOk({ text: result.text, model: result.model });
  } catch {
    return jsonOk({ error: "OpenRouter request failed" }, 502);
  }
  })(req);
}

/**
 * GET /api/ai/cascade/status — check if cloud AI is available.
 * Authenticated: reveals server config state (provider wiring), so the
 * hardening suites require a credential like every other non-public route.
 */
export async function getCascadeStatus() {
  const flag = await db.featureFlag.findUnique({ where: { key: "ai.cloud.enabled" } });
  return {
    openrouterConfigured: openRouterConfigured(),
    cloudEnabled: flag?.enabled ?? false,
  };
}

export async function GET(req: NextRequest) {
  return handler(async (r) => {
    await requireAuth(r);
    return jsonOk(await getCascadeStatus());
  })(req);
}
