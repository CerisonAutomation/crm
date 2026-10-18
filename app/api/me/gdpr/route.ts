import { NextRequest } from "next/server";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { db } from "@/lib/db";

/**
 * GDPR self-service (Art. 15 access / Art. 20 portability, Art. 17 erasure).
 * GET  /api/me/gdpr — full subject export (PII-safe: documents listed, not included).
 * POST /api/me/gdpr — { action: "erasure-request", reason? } → audit + ADMIN notifications.
 * Retention note: AML/CFT obligations require ~10y retention of engagement records,
 * so erasure requests are logged and reviewed by administrators (Art. 17(3)(b) notice).
 */

const EXPORT_MAX = 2000;

export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const [
      user,
      cases,
      documents,
      notifications,
      prefs,
      messages,
      consents,
      requests,
    ] = await Promise.all([
      db.user.findUnique({
        where: { id: ctx.userId },
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
      }),
      db.case.findMany({
        where:
          ctx.role === "CLIENT"
            ? { clientId: ctx.userId }
            : { orgId: ctx.orgId },
        select: {
          id: true,
          reference: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        take: EXPORT_MAX,
      }),
      ctx.role === "CLIENT"
        ? db.document.findMany({
            where: { case: { clientId: ctx.userId } },
            select: {
              id: true,
              type: true,
              title: true,
              fileName: true,
              status: true,
              createdAt: true,
            },
            take: EXPORT_MAX,
          })
        : Promise.resolve([] as Array<{ id: string }>),
      db.notification.findMany({
        where: { userId: ctx.userId },
        select: {
          id: true,
          title: true,
          category: true,
          createdAt: true,
          readAt: true,
        },
        take: EXPORT_MAX,
      }),
      db.notificationPreference.findUnique({ where: { userId: ctx.userId } }),
      db.comment.findMany({
        where: { authorId: ctx.userId },
        select: { id: true, body: true, createdAt: true, caseId: true },
        take: EXPORT_MAX,
      }),
      // Art. 7(1) accountability: the subject's own consent record travels
      // with the export — previously omitted (audit finding, closed here).
      db.consent.findMany({
        where: { userId: ctx.userId },
        select: { key: true, version: true, granted: true, createdAt: true },
        take: EXPORT_MAX,
      }),
      // Own request history (export/erasure tickets) — same subject, same export.
      db.gdprRequest.findMany({
        where: { userId: ctx.userId },
        select: {
          id: true,
          kind: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        take: EXPORT_MAX,
      }),
    ]);
    if (!user) throw new DomainError("User not found", 404);
    // Export caps are explicit, never silent: report totals + truncation so a
    // subject knows when 2000 rows did not cover everything (Art. 15 completeness).
    const caseWhere =
      ctx.role === "CLIENT" ? { clientId: ctx.userId } : { orgId: ctx.orgId };
    const [
      caseCount,
      docCount,
      notifCount,
      msgCount,
      consentCount,
      requestCount,
    ] = await Promise.all([
      db.case.count({ where: caseWhere }),
      ctx.role === "CLIENT"
        ? db.document.count({ where: { case: { clientId: ctx.userId } } })
        : 0,
      db.notification.count({ where: { userId: ctx.userId } }),
      db.comment.count({ where: { authorId: ctx.userId } }),
      db.consent.count({ where: { userId: ctx.userId } }),
      db.gdprRequest.count({ where: { userId: ctx.userId } }),
    ]);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "gdpr.data_exported",
      target: ctx.email,
    });
    return jsonOk({
      exportedAt: new Date().toISOString(),
      lawfulBasis:
        "Contract performance (Art. 6(1)(b)) and legal obligations (Art. 6(1)(c)) — AML/CFT.",
      retention:
        "Engagement records are retained for up to ten years after the last engagement, as required by financial-services anti-money-laundering obligations.",
      user,
      cases,
      documents,
      notifications,
      messages,
      preferences: prefs,
      consents,
      requests,
      totals: {
        cases: caseCount,
        documents: docCount,
        notifications: notifCount,
        messages: msgCount,
        consents: consentCount,
        requests: requestCount,
      },
      truncated: {
        cases: caseCount > cases.length,
        documents: docCount > documents.length,
        notifications: notifCount > notifications.length,
        messages: msgCount > messages.length,
        consents: consentCount > consents.length,
        requests: requestCount > requests.length,
      },
    });
  })(req);
}

export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{ action?: string; reason?: string }>(r).catch(
      () => ({ action: "erasure-request", reason: "" })
    );
    if (body.action !== "erasure-request")
      throw new DomainError("Unsupported action", 400);
    const reason = (body.reason ?? "").slice(0, 1000);
    await audit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorLabel: `${ctx.name} [${ctx.role}]`,
      action: "gdpr.erasure_requested",
      target: ctx.email,
      reason: reason || undefined,
    });
    // Record the ticket. This endpoint used to audit and notify admins but never
    // create the GdprRequest row, so the queue at /api/privacy/requests was
    // permanently empty and there was nothing for anyone to triage.
    await db.gdprRequest.create({
      data: {
        userId: ctx.userId,
        kind: "ERASE",
        detail: reason,
        status: "OPEN",
      },
    });
    // Four-eyes confidentiality: scope to THIS organisation — an unscoped lookup
    // notified every firm's admins of one subject's erasure request (live leak).
    const admins = await db.user.findMany({
      where: { role: "ADMIN", status: "ACTIVE", orgId: ctx.orgId },
      select: { id: true },
    });
    for (const a of admins) {
      await db.notification.create({
        data: {
          userId: a.id,
          title: "GDPR erasure request",
          body: `${ctx.name} (${ctx.email}) requested account erasure. Retention rules (Art. 17(3)(b)) may apply — review required.`,
          category: "SYSTEM",
        },
      });
    }
    return jsonOk(
      {
        received: true,
        reviewBy: "administrator",
        note: "Your request is recorded. Where retention obligations apply (Art. 17(3)(b)), we will restrict processing instead of erasing.",
      },
      202
    );
  })(req);
}
