import { NextRequest } from "next/server";
import { aiChat } from "@/lib/ai/providers";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { detectPromptInjection } from "@/lib/ai/injection-detection";

type BlockConfig = Record<string, unknown>;
type Block = { key?: string; type: string; config: BlockConfig };

const BLOCK_TYPES = ["hero", "text", "form", "quote", "footer"] as const;

const LIMITS: Record<string, number> = {
  eyebrow: 60, headline: 140, subline: 320, body: 1600, ctaLabel: 48,
  quote: 480, attribution: 80, note: 240, title: 120,
};

const SYSTEM = `You refine a single content block of a luxury Swiss investment-migration website (Citizen Lane — Zurich, "Citizenship & Residence by Investment").
Tone: understated, precise, editorial; British English; no exclamation marks; no hype words like "amazing/unlock/boost".
Return ONLY valid JSON for the block's config object — same shape as the input config, only improve the copy values. Never add new keys, never invent fields, never include markdown.`;

function coerceConfig(type: string, raw: unknown): BlockConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const src = raw as Record<string, unknown>;
  const out: BlockConfig = {};
  const pick = (k: string) => {
    if (typeof src[k] === "string") out[k] = (src[k] as string).slice(0, LIMITS[k] ?? 300);
  };
  if (type === "hero") { pick("eyebrow"); pick("headline"); pick("subline"); pick("ctaLabel"); }
  else if (type === "text") { pick("title"); pick("body"); }
  else if (type === "quote") { pick("quote"); pick("attribution"); }
  else if (type === "footer") { pick("note"); }
  else if (type === "form") {
    pick("title");
    const fields = Array.isArray(src.fields) ? src.fields : [];
    const coerced = fields
      .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
      .slice(0, 8)
      .map((f) => ({
        name: String(f.name ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40),
        label: String(f.label ?? "").slice(0, 60),
        type: ["text", "email", "tel", "date", "select", "textarea"].includes(String(f.type)) ? String(f.type) : "text",
        required: Boolean(f.required),
      }))
      .filter((f) => f.name && f.label);
    const names = new Set(coerced.map((f) => f.name));
    if (!names.has("name")) coerced.unshift({ name: "name", label: "Full name", type: "text", required: true });
    if (!names.has("email")) coerced.splice(1, 0, { name: "email", label: "Email address", type: "email", required: true });
    out.fields = coerced;
  } else return null;
  return Object.keys(out).length ? out : null;
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// POST /api/ai/refine-block — AI copy refinement for one page block (inspector "Refine with AI").
// Live LLM with strict coercion; failure returns the ORIGINAL block, clearly labelled.
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "page.read"); // same gate as page draft saving (staff + admin)
    const body = await readJson<{ block: Block; instruction: string }>(r);

    const type = String(body.block?.type ?? "");
    if (!BLOCK_TYPES.includes(type as (typeof BLOCK_TYPES)[number])) {
      throw new DomainError(`Block type "${type}" is not refinable`, 400);
    }
    const instruction = String(body.instruction ?? "").slice(0, 600).trim();
    if (!instruction) throw new DomainError("An instruction is required", 400);
    // C7 injection firewall (route-level block): the instruction is embedded
    // verbatim in the model prompt, so a blocked instruction fails closed
    // (400) before any provider call.
    if (detectPromptInjection(instruction).blocked) {
      throw new DomainError("Instruction rejected: suspected prompt injection", 400);
    }
    const original = body.block.config ?? {};

    try {
      const result = await aiChat(
        [
          { role: "assistant", content: SYSTEM },
          {
            role: "user",
            content: `Block type: ${type}\nCurrent config JSON:\n${JSON.stringify(original)}\n\nRefinement instruction: ${instruction}\n\nReturn the refined config JSON only.`,
          },
        ],
        { timeoutMs: 30_000, disableThinking: true },
      );
      const raw = result?.text ?? "";
            const parsed = extractJson(raw);
            const coerced = parsed !== null ? coerceConfig(type, parsed) : null;
            if (!coerced) throw new DomainError("model returned unusable JSON", 502);

      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "ai.block_refined", target: `block/${type}` });
      return jsonOk({ block: { ...(body.block.key ? { key: body.block.key } : {}), type, config: coerced }, provider: result?.provider ?? "local", changed: true });
    } catch (err) {
      console.warn("[ai-refine] falling back to original block:", (err as Error).message);
      return jsonOk({
        block: body.block,
        provider: "deterministic-fallback",
        changed: false,
        note: "AI refinement unavailable — original copy kept.",
      });
    }
  })(req);
}
