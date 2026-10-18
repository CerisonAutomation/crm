import { NextRequest } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

// GET /api/cases/[id] — full case detail for staff (RM/SENIOR_RM/ADMIN/AUDITOR) and the owning client.
// Object-level authorisation: clients only see their own case; auditor is read-only org-scoped.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    if (ctx.role === "CLIENT") {
      requireCapability(ctx, "case.read.own");
    } else {
      requireCapability(ctx, "case.read.all");
    }
    // Full dossier read (PII-dense): resolved inside the caller org.
    const c = await withTenantContext(ctx.orgId, (tx) =>
      tx.case.findUnique({
      where: { id },
      include: {
        client: {
          select: {
            id: true, name: true, email: true, firstName: true, lastName: true,
            dateOfBirth: true, nationality: true, phone: true, address: true, city: true, country: true, profileState: true,
          },
        },
        programme: true,
        assignments: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
        documents: {
          include: {
            fields: true,
            reviews: { include: { reviewer: { select: { name: true, role: true } } }, orderBy: { createdAt: "desc" } },
            ocrJobs: { orderBy: { createdAt: "desc" }, take: 1 },
            comments: { include: { author: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" } },
          },
          orderBy: { createdAt: "desc" },
        },
        requests: { orderBy: { createdAt: "asc" } },
        dispatches: { include: { followUps: { orderBy: { dueDate: "asc" } } }, orderBy: { createdAt: "desc" } },
        letters: { orderBy: { createdAt: "desc" } },
        statusHistory: { orderBy: { createdAt: "desc" }, take: 30 },
      },
      }),
    );
    if (!c) throw new DomainError("Case not found", 404);
    if (ctx.role === "CLIENT" && c.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
    if (c.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);
    // Clients never see internal RM notes on their documents — the same rule the
    // single-document GET applies, enforced here so the detail payload cannot
    // leak a staff-only note to the applicant.
    if (ctx.role === "CLIENT") {
      for (const doc of c.documents) {
        doc.comments = doc.comments.filter((cm) => !cm.internal);
      }
    }
    return jsonOk({ case: c });
  })(req);
}
