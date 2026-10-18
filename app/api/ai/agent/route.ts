import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { AGENTS, runAgent, type AgentId } from "@/lib/ai/agents";
import { detectPromptInjection } from "@/lib/ai/injection-detection";
import { getThread, saveThread, type AiThread } from "@/lib/ai/context";

/** Validated agent-call body (cuid-style ids — Prisma uses cuid(), not uuid). */
const AgentBodySchema = z.object({
  agent: z.enum(["assistant", "case-copilot", "researcher"]).default("assistant"),
  message: z.string().min(1).max(4000).optional(),
  caseId: z.string().min(1).max(64).optional(),
  threadId: z.string().min(1).max(64).optional(),
});

/**
 * POST /api/ai/agent — run a grounded AI agent and persist the exchange.
 *
 * Access: staff/admin (case.read.all) may use every agent; a CLIENT may use the
 * case copilot on their OWN case only. Context is always org-scoped, and the
 * deterministic fallback is labelled when the model is unavailable.
 */
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const parsed = AgentBodySchema.safeParse(await readJson<unknown>(r));
    if (!parsed.success) throw new DomainError("Invalid request body", 400);
    const body = parsed.data;

    const agent: AgentId = body.agent;
    if (!AGENTS.some((a) => a.id === agent)) throw new DomainError("Unknown agent", 400);

    // C7 injection firewall (route-level block): user text reaches the model
    // only after passing the gate. Blocked input fails closed (400) here —
    // it is never persisted to the thread nor sent to any provider.
    if (body.message) {
      const scan = detectPromptInjection(body.message);
      if (scan.blocked) {
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          action: "ai.agent.injection_blocked",
          target: `agent/${agent}`,
          reason: scan.reason.slice(0, 300),
        });
        throw new DomainError("Message rejected: suspected prompt injection", 400);
      } else if (scan.suspicious) {
        // Single-pattern probe below the block threshold: allowed, but observed.
        await audit({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          actorLabel: `${ctx.name} [${ctx.role}]`,
          action: "ai.agent.injection_flagged",
          target: `agent/${agent}`,
          reason: `Single-pattern match below block threshold: ${scan.patterns.slice(0, 3).join(", ")}`.slice(0, 300),
        });
      }
    }

    if (ctx.role === "CLIENT") {
      if (agent !== "case-copilot") throw new DomainError("Forbidden", 403);
      const own = await db.case.findFirst({ where: { id: body.caseId ?? "", clientId: ctx.userId, orgId: ctx.orgId }, select: { id: true } });
      if (!own) throw new DomainError("Forbidden", 403);
    } else if (ctx.role === "RM" || ctx.role === "SENIOR_RM") {
      if (agent === "case-copilot") {
        if (!body.caseId) throw new DomainError("Open an assigned case to use the case copilot", 403);
        const assigned = await db.case.findFirst({
          where: { id: body.caseId, orgId: ctx.orgId, assignments: { some: { userId: ctx.userId } } },
          select: { id: true },
        });
        if (!assigned) throw new DomainError("Forbidden: case is not assigned to you", 403);
      } else if (agent !== "assistant") {
        throw new DomainError("RM AI is limited to assigned-case assistant help", 403);
      }
    } else {
      if (ctx.role !== "ADMIN") throw new DomainError("Forbidden", 403);
      requireCapability(ctx, "case.read.all");
    }

    const result = await runAgent({ agent, message: body.message, caseId: body.caseId }, ctx.orgId, { userId: ctx.userId, role: ctx.role });

    // Persist the exchange in the caller's own thread store. A supplied
    // threadId is only honoured when it belongs to the caller — getThread is
    // user-scoped, so another user's thread resolves to null and a fresh one is
    // created instead of being read or appended to.
    const now = new Date().toISOString();
    const existing = body.threadId ? await getThread(ctx.orgId, ctx.userId, body.threadId) : null;
    const thread: AiThread = existing ?? {
      id: randomUUID(),
      scope: agent,
      title: (body.message ?? agent).slice(0, 80),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    thread.scope = agent;
    thread.messages.push({ role: "user", content: (body.message ?? "").slice(0, 4000), at: now });
    thread.messages.push({ role: "assistant", content: result.reply, at: new Date().toISOString() });
    thread.updatedAt = new Date().toISOString();
    // Keep threads bounded (last 40 turns).
    thread.messages = thread.messages.slice(-40);
    await saveThread(ctx.orgId, ctx.userId, thread);

    const aiRun = await db.aiRun.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        caseId: body.caseId ?? null,
        agent,
        provider: result.provider,
        authority: result.authority,
        confidence: result.confidence,
        reply: result.reply,
        contextUsed: result.contextUsed,
        citations: {
          create: result.citations.map((citation) => ({
            factId: citation.factId,
            sourceType: citation.source.kind.toUpperCase(),
            sourceId: citation.source.ref,
            sourceLabel: citation.source.label,
            quote: citation.value,
            confidence: result.confidence,
          })),
        },
      },
    });

    // The AI receipt: which provider answered, how confident it was, and the
    // exact fact ids it cited — so an answer can be reconstructed and reviewed
    // after the fact, not just trusted at the moment it was shown.
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "ai.agent.run",
      target: `agent/${agent}`,
      after: {
        caseId: body.caseId ?? null,
        provider: result.provider,
        authority: result.authority,
        confidence: result.confidence,
        citedFactIds: result.citations.map((c) => c.factId),
        citationCheck: result.citationCheck,
      },
    });
    return jsonOk({ ...result, threadId: thread.id, runId: aiRun.id });
  })(req);
}
