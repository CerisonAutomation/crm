/**
 * AI agents — named, grounded assistants the app can invoke.
 *
 * Every agent assembles ORG-SCOPED context, calls the provider, and falls back
 * to a deterministic, data-grounded answer when the model is unavailable. The
 * provider is always returned so callers can label live vs fallback honestly.
 */
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";
import { aiChat, type ChatMessage } from "./providers";
import { SYSTEM_PROMPTS, USER_TEMPLATES } from "./prompts";
import {
  buildCaseContext,
  buildCaseLedger,
  buildPlatformContext,
} from "./context";
import { buildSignals } from "./research";
import {
  ledgerConfidence,
  toCitations,
  verifyReplyCitations,
  type AgentCitation,
} from "./facts";

export type AgentId = "assistant" | "case-copilot" | "researcher";

export const AGENTS: Array<{
  id: AgentId;
  label: string;
  description: string;
  scope: "platform" | "case";
}> = [
  {
    id: "assistant",
    label: "Lane Assistant",
    description: "Ask anything about the platform or your case.",
    scope: "platform",
  },
  {
    id: "case-copilot",
    label: "Case Copilot",
    description: "Summarise a case and get the next best action.",
    scope: "case",
  },
  {
    id: "researcher",
    label: "Operations Researcher",
    description: "Executive summary and priorities from live signals.",
    scope: "platform",
  },
];

export type AgentRunInput = {
  agent: AgentId;
  message?: string;
  caseId?: string;
};
export type AgentRunResult = {
  agent: AgentId;
  reply: string;
  provider: string;
  contextUsed: string[];
  /** "server" — assembled server-side from org-scoped data (authoritative). */
  authority: "server";
  citations: AgentCitation[];
  /** 0..1 — share of the grounding ledger that holds a value. */
  confidence: number;
  /** E12 receipt: server-side citation verdict. checked=false where no ledger
   * contract applies (assistant/researcher) or the deterministic fallback
   * answered with no model reply to verify. */
  citationCheck: { checked: boolean; unknownIds: string[] };
};

/** Deterministic next-action hint per case status (used when the model is down). */
function nextActionHint(status: string): string {
  switch (status) {
    case "ONBOARDING":
      return "Confirm the passport OCR data, then submit the profile to start onboarding.";
    case "DATA_SUBMITTED":
      return "Review and give the secondary data approval.";
    case "DATA_APPROVED":
      return "Ask the client to choose a programme (service).";
    case "SERVICE_SELECTED":
      return "Approve (or discuss) the client's programme choice.";
    case "SERVICE_APPROVED":
      return "Chase the standard document set.";
    case "DOCS_REQUESTED":
      return "Review each uploaded document; approval advances the case to in-progress.";
    case "IN_PROGRESS":
      return "Dispatch the dossier to the authority (DHL) and schedule the follow-up.";
    case "DISPATCHED":
      return "Wait for delivery, then schedule the authority follow-up.";
    case "FOLLOW_UP":
      return "Chase the authority; upload the approval-in-principle letter when it arrives.";
    case "APPROVED_IN_PRINCIPLE":
      return "Upload the final passport/ID and complete the case.";
    case "COMPLETED":
      return "No action — the case is complete.";
    case "CANCELLED":
      return "No action — the case was cancelled.";
    default:
      return "Open the case to review the current stage.";
  }
}

export async function runAgent(
  input: AgentRunInput,
  orgId: string,
  scope?: { userId?: string; role?: string }
): Promise<AgentRunResult> {
  const question = (input.message ?? "").slice(0, 2000).trim();

  if (input.agent === "researcher") {
    const { signals, summary } = await buildSignals(orgId);
    const live = await aiChat([
      { role: "system", content: SYSTEM_PROMPTS.researcher },
      { role: "user", content: USER_TEMPLATES.researcher(signals) },
    ]);
    return {
      agent: "researcher",
      reply:
        live?.text ??
        `AI model unavailable — deterministic read of live signals:\n\n${summary}`,
      provider: live?.provider ?? "deterministic-fallback",
      contextUsed: ["platform signals"],
      authority: "server",
      citations: [],
      confidence: 1,
      citationCheck: { checked: false, unknownIds: [] },
    };
  }

  if (input.agent === "case-copilot") {
    if (!input.caseId)
      throw new DomainError("caseId is required for the case copilot", 400);
    const [ledger, row] = await Promise.all([
      buildCaseLedger(input.caseId, orgId),
      db.case.findFirst({
        where: { id: input.caseId, orgId },
        select: { status: true },
      }),
    ]);
    if (!ledger || !row) throw new DomainError("Case not found", 404);
    const ledgerLines = ledger.facts
      .map((f) => `[${f.id}] ${f.entity}.${f.field} = ${f.value ?? "unknown"}`)
      .join("\n");
    const live = await aiChat([
      { role: "system", content: SYSTEM_PROMPTS.caseCopilot },
      {
        role: "user",
        content: USER_TEMPLATES.caseCopilot(question, ledger.text, ledgerLines),
      },
    ]);
    // E12 cited-only gate: the model may cite ONLY ledger facts. A reply
    // citing anything outside the ledger states what was never read and
    // fails closed (502) instead of reaching the client. The deterministic
    // fallback is a pure projection of the ledger, so it needs no check.
    let citationCheck: AgentRunResult["citationCheck"] = {
      checked: false,
      unknownIds: [],
    };
    if (live?.text) {
      const verdict = verifyReplyCitations(live.text, ledger.facts);
      if (!verdict.ok) {
        throw new DomainError(
          "AI reply cited facts outside the case ledger: " +
            verdict.unknownIds.join(", "),
          502
        );
      }
      citationCheck = { checked: true, unknownIds: [] };
    }
    return {
      agent: "case-copilot",
      citationCheck,
      reply:
        live?.text ??
        `${ledger.text}\n\nNext action: ${nextActionHint(row.status)}`,
      provider: live?.provider ?? "deterministic-fallback",
      contextUsed: ["case"],
      authority: "server",
      citations: toCitations(ledger.facts),
      confidence: ledgerConfidence(ledger.facts),
    };
  }

  // assistant
  const context = await buildPlatformContext(
    orgId,
    scope?.role === "RM" || scope?.role === "SENIOR_RM"
      ? scope.userId
      : undefined
  );
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPTS.assistant },
    {
      role: "user",
      content: USER_TEMPLATES.assistant(
        question ||
          "Give me a quick status overview and the most useful next step.",
        context
      ),
    },
  ];
  const live = await aiChat(messages);
  return {
    agent: "assistant",
    reply:
      live?.text ??
      `AI model unavailable — here is the live picture:\n\n${context}\n\nNext action: open the case queue and work the items with the most open requests.`,
    provider: live?.provider ?? "deterministic-fallback",
    contextUsed: ["platform"],
    authority: "server",
    citations: [],
    confidence: 1,
    citationCheck: { checked: false, unknownIds: [] },
  };
}
