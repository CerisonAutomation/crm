import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { addTeamMember, attachTranscript, markTeamRead, removeTeamMember } from "@/lib/services/teams";

// POST /api/teams/[id]/[action] — membership + read + transcript actions.
// `action` is taken from the path; the body may echo it. Membership changes are
// ADMIN-only, "read" marks the caller's watermark, "transcribe" is the message
// author (or ADMIN) saving the on-device transcript.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);

    if (action === "add-member" || action === "update-member") {
      const body = await readJson<{ userId?: string; role?: string }>(r);
      if (!body.userId) throw new DomainError("userId required", 400);
      await addTeamMember(ctx, id, body.userId, body.role);
      return jsonOk({ ok: true });
    }

    if (action === "remove-member") {
      const body = await readJson<{ userId?: string }>(r);
      if (!body.userId) throw new DomainError("userId required", 400);
      await removeTeamMember(ctx, id, body.userId);
      return jsonOk({ ok: true });
    }

    if (action === "read") {
      await markTeamRead(ctx, id);
      return jsonOk({ ok: true });
    }

    if (action === "transcribe") {
      const body = await readJson<{ messageId?: string; transcript?: string }>(r);
      if (!body.messageId) throw new DomainError("messageId required", 400);
      const message = await attachTranscript(ctx, id, body.messageId, body.transcript ?? "");
      return jsonOk({ message });
    }

    throw new DomainError("Unknown team action", 404);
  })(req);
}
