import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { appendSignal, signalsAfter } from "@/lib/services/calls";

const SIGNAL_KINDS = ["OFFER", "ANSWER", "ICE", "HANGUP", "SUBTITLE"] as const;
type SignalKind = (typeof SIGNAL_KINDS)[number];

// GET /api/calls/[id]/signals?after=<seq> — counterparty signals since `after`.
// Polled ~1/s per peer while negotiating; SDP payloads are never logged.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const raw = new URL(r.url).searchParams.get("after");
    const parsed = Number.parseInt(raw ?? "0", 10);
    const after = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const result = await signalsAfter(ctx, id, after);
    return jsonOk(result);
  })(req);
}

// POST /api/calls/[id]/signals — { kind, payload } — append a signaling message.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      kind?: string;
      payload?: Record<string, unknown>;
    }>(r);
    if (
      !body.kind ||
      !(SIGNAL_KINDS as readonly string[]).includes(body.kind)
    ) {
      throw new DomainError(
        "kind must be OFFER, ANSWER, ICE, HANGUP or SUBTITLE",
        400
      );
    }
    const payload =
      body.payload && typeof body.payload === "object" ? body.payload : {};
    const result = await appendSignal(
      ctx,
      id,
      body.kind as SignalKind,
      payload
    );
    return jsonOk(result);
  })(req);
}
