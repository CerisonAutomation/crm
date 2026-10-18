import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { resetPassword } from "@/lib/services/auth-account";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handler(async () => {
    const body = await readJson<{ token?: string; password?: string }>(req);
    if (!body.token) throw new DomainError("Reset token is required", 400);
    if (!body.password) throw new DomainError("New password is required", 400);
    const result = await resetPassword(body.token, body.password);
    return jsonOk(result);
  })(req);
}
