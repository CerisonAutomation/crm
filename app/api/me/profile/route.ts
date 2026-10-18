import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { DomainError } from "@/lib/domain/states";

export const dynamic = "force-dynamic";

const PROFILE_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  firstName: true,
  lastName: true,
  phone: true,
  address: true,
  city: true,
  country: true,
  nationality: true,
  dateOfBirth: true,
} as const;

export async function GET(req: NextRequest) {
  return handler(async () => {
    const ctx = await requireAuth(req);
    const user = await db.user.findUnique({
      where: { id: ctx.userId },
      select: PROFILE_FIELDS,
    });
    if (!user) throw new DomainError("Account not found", 404);
    return jsonOk({ profile: user });
  })(req);
}

export async function PATCH(req: NextRequest) {
  return handler(async () => {
    const ctx = await requireAuth(req);
    const body = await readJson<{
      name?: string;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      country?: string | null;
      nationality?: string | null;
      dateOfBirth?: string | null;
    }>(req);
    const data: Record<string, string | null> = {};
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new DomainError("Name cannot be empty", 400);
      data.name = body.name.trim();
    }
    for (const key of [
      "phone",
      "address",
      "city",
      "country",
      "nationality",
      "dateOfBirth",
    ] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    const user = await db.user.update({
      where: { id: ctx.userId },
      data,
      select: PROFILE_FIELDS,
    });
    return jsonOk({ profile: user });
  })(req);
}
