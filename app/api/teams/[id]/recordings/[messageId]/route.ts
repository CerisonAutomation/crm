import { NextRequest, NextResponse } from "next/server";
import { handler } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { db } from "@/lib/db";
import { storageGet } from "@/lib/storage";
import { assertTeamAccess } from "@/lib/services/teams";

// GET /api/teams/[id]/recordings/[messageId] — stream a voice-note recording.
// Same team authorization; the vault holds the bytes, the row holds the mime.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const team = await assertTeamAccess(ctx, id);

    const message = await db.teamMessage.findFirst({
      where: { id: messageId, teamId: team.id },
      select: { audioKey: true, audioMime: true },
    });
    if (!message?.audioKey) throw new DomainError("Recording not found", 404);

    const bytes = await storageGet(message.audioKey);
    if (!bytes) throw new DomainError("Recording not found", 404);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": message.audioMime ?? "application/octet-stream",
        "content-disposition": "inline",
        "cache-control": "private, no-store",
        "content-length": String(bytes.length),
      },
    });
  })(req);
}
