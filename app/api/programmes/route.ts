import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";

// GET /api/programmes — active programmes for the client's service selection
export async function GET(req: NextRequest) {
  return handler(async () => {
    await requireAuth(req);
    const programmes = await db.programme.findMany({ where: { active: true }, orderBy: { key: "asc" } });
    return jsonOk({ programmes });
  })(req);
}
