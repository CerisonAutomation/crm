import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { verifyEmail } from "@/lib/services/auth-account";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handler(async () => {
    const body = await readJson<{ token?: string }>(req);
    if (!body.token)
      throw new DomainError("Verification token is required", 400);
    const result = await verifyEmail(body.token);
    return jsonOk(result);
  })(req);
}
