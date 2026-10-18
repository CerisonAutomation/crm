import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";
import { requestPasswordReset } from "@/lib/services/auth-account";
import { hit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handler(async () => {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
    const gate = hit(`auth:forgot:${ip}`, 10, 3_600_000);
    if (!gate.allowed)
      throw new DomainError("Too many attempts. Try again later.", 429);
    const body = await readJson<{ email?: string; locale?: string }>(req);
    if (!body.email?.trim()) throw new DomainError("Email is required", 400);
    const result = await requestPasswordReset(body.email, body.locale);
    return jsonOk({ ok: true, sandboxLink: result.sandboxLink });
  })(req);
}
