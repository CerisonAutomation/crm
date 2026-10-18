import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { createContact, createTask, setTaskStatus, recordActivity, contactFromLead, type ActivityKind } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

// GET /api/crm?view=contacts|tasks|activity&contactId=&caseId= — staff CRM read.
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.read.all");
    const url = new URL(r.url);
    const view = url.searchParams.get("view") ?? "contacts";
    const q = url.searchParams.get("q")?.trim();
    const orgId = ctx.orgId;

    if (view === "tasks") {
      const status = url.searchParams.get("status");
      const tasks = await db.crmTask.findMany({
        where: { orgId, ...(status ? { status } : {}), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } }] } : {}) },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
        take: 201,
      });
      // S6 truncated flag: callers can no longer mistake a capped page for all tasks.
      return jsonOk({ tasks: tasks.slice(0, 200), truncated: tasks.length > 200 });
    }

    if (view === "activity") {
      const contactId = url.searchParams.get("contactId");
      const caseId = url.searchParams.get("caseId");
      const activity = await db.activity.findMany({
        where: { orgId, ...(contactId ? { contactId } : {}), ...(caseId ? { caseId } : {}), ...(q ? { summary: { contains: q, mode: "insensitive" } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 201,
      });
      return jsonOk({ activity: activity.slice(0, 200), truncated: activity.length > 200 });
    }

    const contacts = await db.contact.findMany({
      where: { orgId, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: { createdAt: "desc" },
      take: 201,
      include: { activities: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
    return jsonOk({ contacts: contacts.slice(0, 200), truncated: contacts.length > 200 });
  })(req);
}

// POST /api/crm — staff CRM writes: create a contact / task, log activity, or
// promote a captured lead into a contact. Body is discriminated by `kind`.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "case.assign");
    const body = await readJson<{
      kind?: string;
      // contact
      name?: string; email?: string; phone?: string; company?: string; type?: "INDIVIDUAL" | "COMPANY"; source?: string; notes?: string; ownerId?: string;
      // lead promotion
      leadId?: string;
      // task
      title?: string; assigneeId?: string; contactId?: string; caseId?: string; priority?: "LOW" | "MEDIUM" | "HIGH"; dueDate?: string;
      // activity
      activityKind?: ActivityKind; summary?: string;
      // task status update
      taskId?: string; status?: "OPEN" | "DONE" | "CANCELLED";
    }>(r);

    const kind = body.kind ?? "";

    if (kind === "contact") {
      if (!body.name?.trim()) throw new DomainError("A contact name is required", 400);
      const contact = await createContact(ctx.orgId, ctx.userId, { ...body, name: body.name });
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "crm.contact.created", target: contact.id, after: { name: contact.name, type: contact.type }, correlationId });
      return jsonOk({ contact }, 201);
    }

    if (kind === "lead") {
      if (!body.leadId) throw new DomainError("A leadId is required to promote a lead", 400);
      const contact = await contactFromLead(ctx.orgId, ctx.userId, body.leadId);
      if (!contact) throw new DomainError("Lead not found", 404);
      await db.lead.update({ where: { id: body.leadId }, data: { stage: "QUALIFIED" } }).catch(() => null);
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "crm.lead.promoted", target: body.leadId, after: { contactId: contact.id }, correlationId });
      return jsonOk({ contact }, 201);
    }

    if (kind === "task") {
      if (!body.title?.trim()) throw new DomainError("A task title is required", 400);
      const task = await createTask(ctx.orgId, ctx.userId, { ...body, title: body.title });
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "crm.task.created", target: task.id, after: { title: task.title, priority: task.priority }, correlationId });
      return jsonOk({ task }, 201);
    }

    if (kind === "task.status") {
      if (!body.taskId || !body.status) throw new DomainError("taskId and status are required", 400);
      const task = await setTaskStatus(ctx.orgId, ctx.userId, body.taskId, body.status);
      if (!task) throw new DomainError("Task not found", 404);
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "crm.task.status", target: task.id, after: { status: task.status }, correlationId });
      return jsonOk({ task });
    }

    if (kind === "activity") {
      if (!body.summary?.trim()) throw new DomainError("An activity summary is required", 400);
      await recordActivity({
        orgId: ctx.orgId, actorId: ctx.userId,
        kind: body.activityKind ?? "NOTE", summary: body.summary,
        contactId: body.contactId ?? null, caseId: body.caseId ?? null, leadId: body.leadId ?? null,
      });
      return jsonOk({ ok: true }, 201);
    }

    throw new DomainError("Unknown CRM kind", 400);
  })(req);
}
