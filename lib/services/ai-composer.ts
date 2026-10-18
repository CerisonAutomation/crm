/**
 * AI composer — the platform's self-build brain (SERVER ONLY).
 *
 * Turns a natural-language brief into platform-native artifacts:
 *  - Lane Page block JSON (hero/text/quote/form/footer schema)
 *  - Workflow graphs (piece-catalog vocabulary, validated by the engine)
 *
 * Generation is schema-constrained (brief → strict JSON → validate → repair)
 * mirroring the platform's own AI workflow builder: the model may only assemble
 * pieces from the platform's catalog, never invent structure. When the LLM is
 * unreachable, a deterministic fallback composes a valid artifact from the
 * brief — always labelled with its provider so nothing is faked as live.
 */
import { aiChat } from "@/lib/ai/providers";
import type { WfEdge, WfNode } from "@/lib/services/workflow-engine";
import { TEMPLATE_GRAPHS } from "@/lib/services/workflow-templates";

export type PageBlock = { key: string; type: string; config: Record<string, unknown> };
export type PageDraft = { title: string; blocks: PageBlock[]; provider: string };
export type WorkflowDraft = { name: string; description: string; nodes: WfNode[]; edges: WfEdge[]; provider: string };

const BRIEF_LIMIT = 2000;

function cleanBrief(brief: string): string {
  return brief.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, BRIEF_LIMIT);
}

/** Extract the first JSON object from an LLM reply (tolerates fences/prose). */
function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json/gi, "```").trim();
  const fenced = cleaned.split("```");
  const candidates = fenced.length > 1 ? [fenced[1], cleaned] : [cleaned];
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

// ───────────────────────── page generation ─────────────────────────

const PAGE_PROMPT = `You are the page composer for CITIZEN LANE, a Zurich private consultancy for citizenship & residence by investment.
Brand voice: elevated, editorial, discreet, precise. British English. No hype, no exclamation marks, no HTML or markdown.
Compose a landing page as JSON. Respond with ONLY valid JSON (no markdown), exactly this shape:
{"title": string, "blocks": [
  {"type":"hero","config":{"headline": string (max 90 chars),"subline": string (max 160 chars)}},
  {"type":"text","config":{"body": string (2-3 paragraphs, \\n\\n separated)}},
  {"type":"quote","config":{"text": string,"attribution": string}} (optional, max one),
  {"type":"form","config":{"formKey": kebab-case string,"fields":[{"key":string,"label":string,"type":"text"|"email"|"tel","required":boolean}] (2-4 fields, must include name text and email email)}},
  {"type":"footer","config":{"note": string}}
]}
Rules: 4-6 blocks, first block hero, exactly one form block, last block footer. Content must relate to the brief.`;

const BLOCK_TYPES = new Set(["hero", "text", "quote", "form", "footer"]);

function coercePageBlocks(raw: unknown): PageBlock[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return null;
  const blocks: PageBlock[] = [];
  let i = 0;
  for (const b of raw) {
    if (typeof b !== "object" || b === null) continue;
    const type = String((b as Record<string, unknown>).type ?? "");
    if (!BLOCK_TYPES.has(type)) continue;
    const cfg = (b as Record<string, unknown>).config;
    const config: Record<string, unknown> = typeof cfg === "object" && cfg !== null ? { ...(cfg as Record<string, unknown>) } : {};
    if (type === "hero") {
      config.headline = String(config.headline ?? "Private pathways to residence and citizenship").slice(0, 140);
      config.subline = String(config.subline ?? "Citizenship & Residence by Investment — curated from Zurich.").slice(0, 220);
    } else if (type === "text") {
      config.body = String(config.body ?? "").slice(0, 4000) || "Our advisors will be in touch shortly.";
    } else if (type === "quote") {
      config.text = String(config.text ?? "").slice(0, 600);
      config.attribution = String(config.attribution ?? "Citizen Lane").slice(0, 120);
      if (!config.text) continue;
    } else if (type === "form") {
      const fieldsRaw = Array.isArray(config.fields) ? config.fields : [];
      const fields = fieldsRaw
        .slice(0, 6)
        .map((f) => {
          const fo = (typeof f === "object" && f !== null ? f : {}) as Record<string, unknown>;
          const key = String(fo.key ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "");
          if (!key) return null;
          const type = ["text", "email", "tel"].includes(String(fo.type)) ? String(fo.type) : "text";
          return { key, label: String(fo.label ?? key).slice(0, 80), type, required: Boolean(fo.required) };
        })
        .filter(Boolean) as Array<{ key: string; label: string; type: string; required: boolean }>;
      const hasName = fields.some((f) => f.key === "name");
      const hasEmail = fields.some((f) => f.key === "email");
      if (!hasName) fields.unshift({ key: "name", label: "Full name", type: "text", required: true });
      if (!hasEmail) fields.splice(1, 0, { key: "email", label: "Email", type: "email", required: true });
      config.formKey = String(config.formKey ?? "enquiry").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60) || "enquiry";
      config.fields = fields;
    } else if (type === "footer") {
      config.note = String(config.note ?? "Zurich | info@citizen-lane.com | +41 55 511 54 00").slice(0, 200);
    }
    i += 1;
    blocks.push({ key: `b${i}`, type, config });
  }
  // Structural repair: hero first, exactly one form, footer last.
  const heroes = blocks.filter((b) => b.type === "hero");
  const forms = blocks.filter((b) => b.type === "form");
  const rest = blocks.filter((b) => b.type !== "hero" && b.type !== "form" && b.type !== "footer");
  const footers = blocks.filter((b) => b.type === "footer");
  if (heroes.length === 0 || forms.length === 0) return null;
  const form = forms[0];
  const hero = heroes[0];
  const footer = footers[0] ?? { key: `b${blocks.length + 1}`, type: "footer", config: { note: "Zurich | info@citizen-lane.com | +41 55 511 54 00" } as Record<string, unknown> };
  return [hero, ...rest, form, footer];
}

function fallbackTitle(brief: string): string {
  const words = brief.split(/\s+/).filter((w) => /^[a-zA-ZÀ-ž'’-]{3,}$/.test(w));
  const stops = new Set(["the", "and", "for", "with", "page", "about", "that", "this", "from", "into", "our", "your"]);
  const picked = words.filter((w) => !stops.has(w.toLowerCase())).slice(0, 4);
  const title = picked.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return title ? `Citizen Lane — ${title}` : "Citizen Lane — Private Enquiry";
}

function fallbackPage(brief: string): PageDraft {
  const title = fallbackTitle(brief);
  const topic = brief.slice(0, 180) || "Private enquiry";
  return {
    title,
    provider: "deterministic-fallback",
    blocks: [
      {
        key: "b1",
        type: "hero",
        config: {
          headline: title.replace(/^Citizen Lane — /, ""),
          subline: "A discreet pathway, curated from Zurich and delivered end to end.",
        },
      },
      {
        key: "b2",
        type: "text",
        config: {
          body: `Our advisors have prepared this page around your brief: “${topic}”.\n\nCitizen Lane pairs Swiss standards of diligence with a private network of legal and mobility specialists. Every mandate is scoped in writing, reviewed by a senior relationship manager, and progressed under audit.\n\nSubmit the form below and the appropriate team will respond within one business day.`,
        },
      },
      {
        key: "b3",
        type: "quote",
        config: {
          text: "We treat relocation as a matter of private architecture — designed once, built to last.",
          attribution: "Citizen Lane, Zurich",
        },
      },
      {
        key: "b4",
        type: "form",
        config: {
          formKey: "enquiry",
          fields: [
            { key: "name", label: "Full name", type: "text", required: true },
            { key: "email", label: "Email", type: "email", required: true },
            { key: "phone", label: "Telephone", type: "tel", required: false },
          ],
        },
      },
      { key: "b5", type: "footer", config: { note: "Zurich | info@citizen-lane.com | +41 55 511 54 00" } },
    ],
  };
}

export async function generatePageDraft(briefRaw: string): Promise<PageDraft> {
  const brief = cleanBrief(briefRaw);
  if (!brief) throw new Error("Brief is empty");
  try {
    const result = await aiChat(
      [
        { role: "system", content: "You compose JSON page content for a Swiss private-client consultancy. Output JSON only." },
        { role: "user", content: `${PAGE_PROMPT}\n\nBRIEF: ${brief}` },
      ],
      { timeoutMs: 45_000 },
    );
    const raw = result?.text ?? "";
    const parsed = extractJson(raw);
    const blocks = parsed ? coercePageBlocks(parsed.blocks) : null;
    if (blocks) {
      const title = String(parsed?.title ?? "").trim().slice(0, 120) || fallbackTitle(brief);
      return { title, blocks, provider: "llm" };
    }
    console.warn("[ai-composer] page LLM output failed validation — deterministic fallback used");
  } catch (err) {
    console.warn("[ai-composer] page LLM unavailable, fallback used:", (err as Error).message);
  }
  return fallbackPage(brief);
}

// ───────────────────────── workflow generation ─────────────────────────

const PIECE_CATALOG = `trigger.case.created — starts when a client case is created.
trigger.document.uploaded — starts when a client uploads a document.
action.notify.rm {"title","body"} — notifies the relationship-management team.
action.notify.client {"title","body"} — notifies the client.
action.create.request {"docType","title","instructions","dueDays"} — creates a document request.
approval.human.gate {"role":"RM"|"SENIOR_RM"} — pauses until a human approves (role required).
condition.field.equals {"left","value"} — branches; label the following edge "true".
delay.authority_followup {"weeks"} — schedules an authority follow-up.
action.audit.export {} — records an audit export entry.`;

const WORKFLOW_PROMPT = `You are the workflow composer for CITIZEN LANE. Assemble a workflow graph ONLY from this piece catalog:
${PIECE_CATALOG}
Respond with ONLY valid JSON (no markdown), exactly:
{"name": string (max 60 chars), "description": string (max 140 chars), "nodes": [{"key":"n1","pieceKey":"...","name": human label,"config":{...}}], "edges": [{"from":"n1","to":"n2","label":"true" (only after condition)}]}
Rules: exactly one trigger node first; 3-7 nodes; nodes connected in sequence n1→n2→…; every edge from a condition node after the immediate next node carries label "true"; approval nodes must set config.role; keep tone professional.`;

const VALID_PIECES = new Set([
  "trigger.case.created", "trigger.document.uploaded",
  "action.notify.rm", "action.notify.client", "action.create.request",
  "approval.human.gate", "condition.field.equals", "delay.authority_followup", "action.audit.export",
]);

function coerceGraph(parsed: Record<string, unknown>): { nodes: WfNode[]; edges: WfEdge[] } | null {
  const nodesRaw = parsed.nodes;
  const edgesRaw = parsed.edges;
  if (!Array.isArray(nodesRaw) || nodesRaw.length < 2 || nodesRaw.length > 8) return null;
  const nodes: WfNode[] = [];
  const keys = new Set<string>();
  let idx = 1;
  for (const n of nodesRaw) {
    if (typeof n !== "object" || n === null) return null;
    const no = n as Record<string, unknown>;
    const pieceKey = String(no.pieceKey ?? "");
    if (!VALID_PIECES.has(pieceKey)) return null;
    const key = keys.has(String(no.key)) ? `n${idx}` : String(no.key || `n${idx}`);
    keys.add(key);
    const config = (typeof no.config === "object" && no.config !== null ? { ...(no.config as Record<string, unknown>) } : {}) as Record<string, unknown>;
    for (const k of Object.keys(config)) config[k] = typeof config[k] === "string" ? (config[k] as string).slice(0, 300) : config[k];
    nodes.push({ key, pieceKey, name: String(no.name ?? pieceKey).slice(0, 60), config });
    idx += 1;
  }
  const triggers = nodes.filter((n) => n.pieceKey.startsWith("trigger."));
  if (triggers.length !== 1 || nodes[0].pieceKey !== triggers[0].pieceKey) return null;
  if (!Array.isArray(edgesRaw) || edgesRaw.length < nodes.length - 1) return null;
  const edges: WfEdge[] = [];
  const seen = new Set<string>();
  for (const e of edgesRaw) {
    if (typeof e !== "object" || e === null) return null;
    const eo = e as Record<string, unknown>;
    const from = String(eo.from ?? "");
    const to = String(eo.to ?? "");
    if (!keys.has(from) || !keys.has(to)) return null;
    const ek = `${from}->${to}`;
    if (seen.has(ek)) continue;
    seen.add(ek);
    edges.push({ from, to, label: eo.label === "true" || eo.label === "false" ? String(eo.label) : undefined });
  }
  return { nodes, edges };
}

function fallbackWorkflow(goalRaw: string): WorkflowDraft {
  const goal = goalRaw.toLowerCase();
  const pick = (tpl: string, name: string, description: string): WorkflowDraft => {
    const g = TEMPLATE_GRAPHS[tpl];
    return { name, description, nodes: g.nodes, edges: g.edges, provider: "deterministic-fallback" };
  };
  if (goal.includes("document") || goal.includes("passport") || goal.includes("ocr")) {
    return pick("tpl-ocr-review", "Document Review Journey", "Uploaded document → RM review → senior approval → client informed.");
  }
  if (goal.includes("dispatch") || goal.includes("dhl") || goal.includes("courier") || goal.includes("authority")) {
    return pick("tpl-dhl-dispatch", "Dispatch & Authority Follow-up", "Senior-approved dispatch with scheduled authority follow-up.");
  }
  if (goal.includes("missing") || goal.includes("request")) {
    return pick("tpl-missing-docs", "Missing Document Chaser", "Conditional document request when onboarding data is incomplete.");
  }
  if (goal.includes("letter") || goal.includes("approval in principle")) {
    return pick("tpl-approval-letter", "Approval Letter Handling", "Approval-in-principle letter → client notified → audit export.");
  }
  if (goal.includes("audit") || goal.includes("compliance") || goal.includes("export")) {
    return pick("tpl-audit-export", "Audit Export Run", "PII-safe audit export on demand.");
  }
  return pick("tpl-onboarding", "Client Onboarding Journey", "Case created → RM notified → acknowledgement gate → client welcomed.");
}

export async function generateWorkflowDraft(goalRaw: string): Promise<WorkflowDraft> {
  const goal = cleanBrief(goalRaw);
  if (!goal) throw new Error("Goal is empty");
  try {
    const result = await aiChat(
      [
        { role: "system", content: "You assemble JSON workflow graphs from a fixed piece catalog. Output JSON only." },
        { role: "user", content: `${WORKFLOW_PROMPT}\n\nGOAL: ${goal}` },
      ],
      { timeoutMs: 45_000 },
    );
    const raw = result?.text ?? "";
    const parsed = extractJson(raw);
    const graph = parsed ? coerceGraph(parsed) : null;
    if (graph) {
      return {
        name: String(parsed?.name ?? "").trim().slice(0, 80) || "AI Composed Workflow",
        description: String(parsed?.description ?? "").trim().slice(0, 200),
        ...graph,
        provider: "llm",
      };
    }
    console.warn("[ai-composer] workflow LLM output failed validation — deterministic fallback used");
  } catch (err) {
    console.warn("[ai-composer] workflow LLM unavailable, fallback used:", (err as Error).message);
  }
  return fallbackWorkflow(goal);
}
