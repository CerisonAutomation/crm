/**
 * DSAR bundle builder (Art. 15 access / Art. 20 portability).
 *
 * Allowlist shaping: every section projects an explicit field list, so raw
 * secrets (passwordHash, push keys, tokens, integration configs) can never
 * leak into an export even as the schema grows. Documents export as metadata
 * (no bytes) — same PII-safe line as the self-service export.
 * Pure shaper + DB reader split so the redaction rule is unit-testable.
 */
import { db } from "@/lib/db";

/** 30-day DSAR response window (Art. 12(3)), in hours for SLAClock. */
export const DSAR_SLA_HOURS = 30 * 24;

/** SLA clock name linking a DSAR ticket to its countdown (SLAClock has no request FK). */
export function dsarClockName(requestId: string): string {
  return `DSAR:${requestId}`;
}

export type DsarInput = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    createdAt: Date;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    nationality: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    profileState: string;
  };
  cases: Array<{
    id: string;
    reference: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  documents: Array<{
    id: string;
    type: string;
    title: string;
    fileName: string;
    status: string;
    createdAt: Date;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    category: string;
    createdAt: Date;
    readAt: Date | null;
  }>;
  consents: Array<{
    key: string;
    version: string;
    granted: boolean;
    createdAt: Date;
  }>;
  requests: Array<{
    id: string;
    kind: string;
    detail: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

/** Allowlist projection — the ONLY fields that may enter a bundle. Pure. */
export function shapeDsarBundle(input: DsarInput, exportedAt = new Date()) {
  return {
    exportedAt: exportedAt.toISOString(),
    lawfulBasis:
      "Contract performance (Art. 6(1)(b)) and legal obligations (Art. 6(1)(c)) — AML/CFT.",
    retention:
      "Engagement records are retained for up to ten years after the last engagement, as required by financial-services anti-money-laundering obligations.",
    user: { ...input.user, createdAt: input.user.createdAt.toISOString() },
    cases: input.cases.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    documents: input.documents.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
    })),
    notifications: input.notifications.map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    })),
    consent: input.consents.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    requests: input.requests.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

/** Assemble a subject bundle for one user id. Throws 404-shaped Error when missing. */
export async function buildDsarBundle(userId: string, exportedAt = new Date()) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      nationality: true,
      phone: true,
      address: true,
      city: true,
      country: true,
      profileState: true,
    },
  });
  if (!user) throw new Error("Subject not found");
  const [cases, documents, notifications, consents, requests] =
    await Promise.all([
      db.case.findMany({
        where: { clientId: userId },
        select: {
          id: true,
          reference: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      }),
      db.document.findMany({
        where: { case: { clientId: userId } },
        select: {
          id: true,
          type: true,
          title: true,
          fileName: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      }),
      db.notification.findMany({
        where: { userId },
        select: {
          id: true,
          title: true,
          category: true,
          createdAt: true,
          readAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      }),
      db.consent.findMany({
        where: { userId },
        select: { key: true, version: true, granted: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      db.gdprRequest.findMany({
        where: { userId },
        select: {
          id: true,
          kind: true,
          detail: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
    ]);
  return shapeDsarBundle(
    { user, cases, documents, notifications, consents, requests },
    exportedAt
  );
}
