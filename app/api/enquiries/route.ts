import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { hit } from "@/lib/rate-limit";
import { DomainError } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

// POST /api/enquiries — PUBLIC consultation request (landing "Request a
// consultation" + programme CTAs). Unauthenticated by design, rate-limited per
// IP (12/hour), strictly normalised. Stored as a Lead so the existing staff
// queue and notification pipeline pick it up with no parallel intake path.
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ip =
      r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      r.headers.get("x-real-ip")?.trim() ||
      "unknown";
    const gate = hit(`enquiry:${ip}`, 12, 3_600_000);
    if (!gate.allowed) {
      throw new DomainError(
        `Too many enquiries from this address — try again in ${gate.retryAfterSec}s`,
        429,
      );
    }

    const body = await readJson<{
      name?: unknown; email?: unknown; phone?: unknown; country?: unknown;
      programmeKey?: unknown; budget?: unknown; message?: unknown; source?: unknown;
      website?: unknown;
    }>(r as Request as NextRequest);

    // Honeypot (ponytail-S #4): same bare success shape with a well-formed
    // (meaningless) reference, nothing stored. A constant fake would teach
    // bots to distinguish the trap.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return jsonOk({ received: true, reference: randomUUID().slice(0, 8).toUpperCase() }, 201);
    }

    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 160) : "";
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new DomainError("Name and a valid email are required", 400);
    }

    const str = (v: unknown, max: number) =>
      typeof v === "string" ? v.trim().slice(0, max) : "";

    const detail = [
      str(body.country, 80) ? `Country: ${str(body.country, 80)}` : "",
      str(body.programmeKey, 60) ? `Interest: ${str(body.programmeKey, 60)}` : "",
      str(body.budget, 60) ? `Budget: ${str(body.budget, 60)}` : "",
      str(body.message, 2000) ? `\n${str(body.message, 2000)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const lead = await db.lead.create({
      data: {
        name,
        email,
        phone: str(body.phone, 40) || null,
        source: "SITE",
        message: detail.slice(0, 4000),
      },
      select: { id: true },
    });

    // Reference is a truncated id — enough to quote back, nothing sensitive.
    return jsonOk({ received: true, reference: lead.id.slice(0, 8).toUpperCase() }, 201);
  })(req);
}
