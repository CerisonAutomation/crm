import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth, requireCapability, hashPassword, type AuthContext } from "@/lib/auth";
import { DomainError, ROLES } from "@/lib/domain/states";
import { AUDIT_PAGE_SIZE_MAX } from "@/lib/settings/registry";
import { loadPlatformSettings } from "@/lib/settings/store";
import { csvDocument } from "@/lib/csv";
import { sendPush } from "@/lib/adapters/push";
import { sendEmail } from "@/lib/integrations";
import { randomBytes } from "crypto";

/** Account statuses the platform understands — requireAuth gates on ACTIVE. */
const USER_STATUSES: readonly string[] = ["ACTIVE", "DEACTIVATED"];

/** Parsed POST body shape shared by the admin section handlers. */
type AdminBody = Record<string, string | boolean | undefined>;

// GET /api/admin/[section] — stats | users | audit | pieces | connections | notifications | flags
export async function GET(req: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const url = new URL(r.url);

    if (section === "stats") {
      requireCapability(ctx, "admin.manage");
      const orgId = ctx.orgId;
      const [users, activeCases, cases, runs, failedRuns, waitingRuns, notifications, dlq, auditCount, docs, pages, flags] = await Promise.all([
        db.user.count({ where: { orgId } }),
        db.case.count({ where: { orgId, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
        db.case.count({ where: { orgId } }),
        db.workflowRun.count({ where: { workflow: { orgId }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
        db.workflowRun.count({ where: { workflow: { orgId }, status: "FAILED" } }),
        db.workflowRun.count({ where: { workflow: { orgId }, status: "WAITING_APPROVAL" } }),
        db.notification.count({ where: { user: { orgId }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
        db.notification.count({ where: { user: { orgId }, status: "DEAD_LETTER" } }),
        db.auditEvent.count({ where: { orgId } }),
        db.document.count({ where: { case: { orgId } } }),
        db.lanePage.count({ where: { orgId, status: "PUBLISHED" } }),
        db.featureFlag.count({ where: { enabled: true } }),
      ]);
      const byStatus = await db.case.groupBy({ by: ["status"], where: { orgId }, _count: true });
      const workflows = await db.workflow.findMany({ where: { orgId }, select: { id: true, name: true, status: true, currentVersion: true, disabled: true } });
      const recentAudit = await db.auditEvent.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 8 });
      return jsonOk({
        stats: { users, activeCases, cases, runs7d: runs, failedRuns, waitingRuns, notifications7d: notifications, dlq, auditEvents: auditCount, documents: docs, publishedPages: pages, activeFlags: flags },
        casesByStatus: byStatus.map((b) => ({ status: b.status, count: b._count })),
        workflows,
        recentAudit,
      });
    }

    if (section === "users") {
      requireCapability(ctx, "admin.manage");
      const users = await db.user.findMany({
        where: { orgId: ctx.orgId },
        select: {
          id: true, email: true, name: true, role: true, status: true, profileState: true,
          nationality: true, lastLoginAt: true, createdAt: true, orgId: true,
          _count: { select: { clientCases: true, sessions: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return jsonOk({ users });
    }

    if (section === "audit") {
      requireCapability(ctx, "audit.read");
      const action = url.searchParams.get("action") ?? undefined;
      const actor = url.searchParams.get("actor") ?? undefined;
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      // Page size defaults to the operator-configured settings.governance.
      // auditPageSize (canon 25) and is ALWAYS capped at AUDIT_PAGE_SIZE_MAX (50),
      // whether the value comes from the setting or an explicit ?pageSize=.
      const settings = await loadPlatformSettings();
      const requestedSize = parseInt(url.searchParams.get("pageSize") ?? "", 10);
      const pageSize = Math.min(
        AUDIT_PAGE_SIZE_MAX,
        Number.isInteger(requestedSize) && requestedSize > 0 ? requestedSize : settings.governance.auditPageSize,
      );
      // Tenant-scoped: the audit trail is never cross-organisation, so an
      // AUDITOR of one tenant can never read (or export) another's events.
      const where = {
        orgId: ctx.orgId,
        ...(action ? { action: { contains: action } } : undefined),
        ...(actor ? { actorLabel: { contains: actor } } : undefined),
      };
      const [events, total] = await Promise.all([
        db.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
        db.auditEvent.count({ where }),
      ]);
      if (url.searchParams.get("export") === "csv") {
        // capped export (max 500 rows) — audit/retention boundary. Every cell
        // is neutralised against spreadsheet-formula injection (actor labels and
        // targets are attacker-controlled at self-registration).
        const rows = await db.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });
        const csv = csvDocument([
          ["id", "createdAt", "actorLabel", "action", "target", "reason"],
          ...rows.map((e) => [e.id, e.createdAt.toISOString(), e.actorLabel, e.action, e.target, e.reason ?? ""]),
        ]);
        return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-export-${Date.now()}.csv"`, "cache-control": "no-store" } });
      }
      return jsonOk({ events, total, page, pageSize });
    }

    if (section === "pieces") {
      requireCapability(ctx, "admin.manage");
      const pieces = await db.pieceDefinition.findMany({ orderBy: { category: "asc" } });
      return jsonOk({ pieces });
    }

    if (section === "connections") {
      requireCapability(ctx, "admin.manage");
      const connections = await db.connection.findMany({ orderBy: { createdAt: "desc" } });
      return jsonOk({ connections });
    }

    if (section === "notifications") {
      requireCapability(ctx, "admin.manage");
      const logs = await db.notification.findMany({
        where: { user: { orgId: ctx.orgId } },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { user: { select: { name: true, email: true, role: true } } },
      });
      // The outbox ledger is platform-wide (no orgId column) and carries only
      // delivery metadata, not tenant PII — safe to surface to admins.
      const dlq = await db.outboxEvent.findMany({ where: { status: "DEAD_LETTER" }, orderBy: { createdAt: "desc" }, take: 20 });
      const queued = await db.outboxEvent.count({ where: { status: "PENDING" } });
      return jsonOk({ logs, dlq, queued });
    }

    if (section === "flags") {
      requireCapability(ctx, "admin.manage");
      const flags = await db.featureFlag.findMany({ orderBy: { key: "asc" } });
      return jsonOk({ flags });
    }

    if (section === "programmes") {
      // Admin view of the service catalogue — includes inactive rows so an
      // operator can see and re-activate a retired programme (the public
      // /api/catalog and /api/programmes serve active rows only).
      requireCapability(ctx, "admin.manage");
      const programmes = await db.programme.findMany({ orderBy: [{ country: "asc" }, { key: "asc" }] });
      return jsonOk({ programmes });
    }

    throw new DomainError("Unknown admin section", 404);
  })(req);
}

async function adminInviteUser(ctx: AuthContext, body: AdminBody) {
  // invite user — step-up protected by reason requirement
  if (!body.reason) throw new DomainError("Admin actions require a reason (audit)", 400);
  if (body.role === "ADMIN" && ctx.role !== "ADMIN") throw new DomainError("Only admins can create admins", 403);
  if (!ROLES.includes((body.role as never))) throw new DomainError("Invalid role", 400);
  const tempPassword = `cl-${randomBytes(6).toString("hex")}`;
  const user = await db.user.create({
    data: {
      email: String(body.email).toLowerCase().trim(),
      name: String(body.name),
      role: String(body.role),
      status: "INVITED",
      passwordHash: hashPassword(tempPassword),
      orgId: ctx.orgId,
    },
  });
  await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "user.invited", target: user.email, after: { role: user.role }, reason: String(body.reason) });
  return jsonOk({ user: { id: user.id, email: user.email, role: user.role, status: user.status }, tempPassword }, 201);
}

async function adminUpdateUser(ctx: AuthContext, body: AdminBody) {
  if (!body.reason) throw new DomainError("Admin actions require a reason (audit)", 400);
  const user = await db.user.findFirst({ where: { id: String(body.id), orgId: ctx.orgId } });
  if (!user) throw new DomainError("User not found", 404);
  const before = { role: user.role, status: user.status };
  const data: Record<string, string> = {};
  // Validate against the real vocabularies. `User.role`/`User.status` are
  // plain String columns, so without this any string could be written: a
  // bogus role is silently powerless (capabilities are deny-by-default), but
  // a status other than ACTIVE/DEACTIVATED bypasses the single status gate
  // in requireAuth and locks the account out with no diagnosable reason.
  if (body.role !== undefined) {
    const role = String(body.role);
    if (!(ROLES as readonly string[]).includes(role)) {
      throw new DomainError(`role must be one of: ${ROLES.join(", ")}`, 400);
    }
    data.role = role;
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!USER_STATUSES.includes(status)) {
      throw new DomainError(`status must be one of: ${USER_STATUSES.join(", ")}`, 400);
    }
    data.status = status;
  }
  const updated = await db.user.update({ where: { id: user.id }, data });
  if (body.status === "DEACTIVATED") {
    await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "user.updated", target: user.email, before, after: data, reason: String(body.reason) });
  return jsonOk({ user: { id: updated.id, role: updated.role, status: updated.status } });
}

async function adminRevokeSessions(ctx: AuthContext, body: AdminBody) {
  if (!body.reason) throw new DomainError("Admin actions require a reason (audit)", 400);
  const user = await db.user.findFirst({ where: { id: String(body.id), orgId: ctx.orgId } });
  if (!user) throw new DomainError("User not found", 404);
  const res = await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "user.sessions_revoked", target: user.email, after: { revoked: res.count }, reason: String(body.reason) });
  return jsonOk({ revoked: res.count });
}

async function adminToggleFlag(ctx: AuthContext, body: AdminBody) {
  const key = String(body.key ?? "").trim();
  if (!key) throw new DomainError("A flag key is required", 400);
  // Renaming/creating needs a name; a bare toggle of an existing flag does not.
  const name = body.name !== undefined ? String(body.name).trim() : undefined;
  const existing = await db.featureFlag.findUnique({ where: { key } });
  if (!existing && !name) throw new DomainError("Creating a flag requires a name", 400);
  if (!existing && body.reason === undefined) throw new DomainError("Creating a flag requires a reason (audit)", 400);
  // Explicit create/update rather than upsert: Prisma validates every branch
  // of an upsert argument, so a bare toggle (no name) would fail the create
  // branch's required-field check even when only the update branch runs.
  const flag = existing
    ? await db.featureFlag.update({
        where: { key },
        // Preserve the name on a toggle; update it when one is supplied.
        data: { enabled: Boolean(body.enabled), ...(name ? { name } : undefined) },
      })
    : await db.featureFlag.create({
        data: { key, name: name!, enabled: Boolean(body.enabled) },
      });
  await audit({
    orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`,
    action: existing ? "feature_flag.toggled" : "feature_flag.created",
    target: flag.key, after: { enabled: flag.enabled, name: flag.name },
    reason: body.reason ? String(body.reason) : undefined,
  });
  return jsonOk({ flag }, existing ? 200 : 201);
}

async function adminCreateProgramme(ctx: AuthContext, body: AdminBody) {
  // Create a programme (service). The platform catalogue is not org-scoped —
  // one definition feeds the public catalogue, the client's service picker and
  // the RM's approval desk — so the write is ADMIN-gated and reason-audited.
  if (!body.reason) throw new DomainError("Admin actions require a reason (audit)", 400);
  const key = String(body.key ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,40}$/.test(key)) throw new DomainError("Key must be 2–40 chars: A–Z, 0–9 or underscore", 400);
  const name = String(body.name ?? "").trim();
  const country = String(body.country ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!name || !country || !description) throw new DomainError("name, country and description are required", 400);
  if (await db.programme.findUnique({ where: { key } })) throw new DomainError("A programme with that key already exists", 409);
  const programme = await db.programme.create({
    data: { key, name, country, description, active: body.active === undefined ? true : Boolean(body.active) },
  });
  await audit({
    orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "programme.created", target: programme.key,
    after: { name: programme.name, country: programme.country, active: programme.active },
    reason: String(body.reason),
  });
  return jsonOk({ programme }, 201);
}

async function adminUpdateProgramme(ctx: AuthContext, body: AdminBody) {
  // Edit an existing programme's editorial fields / active flag. `key` is the
  // stable identifier other surfaces join on, so it is never re-written here.
  if (!body.reason) throw new DomainError("Admin actions require a reason (audit)", 400);
  const programme = await db.programme.findUnique({ where: { id: String(body.id) } });
  if (!programme) throw new DomainError("Programme not found", 404);
  const before = { name: programme.name, country: programme.country, description: programme.description, active: programme.active };
  const data: Record<string, string | boolean> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.country !== undefined) data.country = String(body.country).trim();
  if (body.description !== undefined) data.description = String(body.description).trim();
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (Object.keys(data).length === 0) throw new DomainError("Nothing to update", 400);
  const updated = await db.programme.update({ where: { id: programme.id }, data });
  await audit({
    orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "programme.updated", target: programme.key, before, after: data, reason: String(body.reason),
  });
  return jsonOk({ programme: updated });
}

async function adminTogglePiece(ctx: AuthContext, body: AdminBody) {
  const piece = await db.pieceDefinition.update({ where: { key: String(body.key) }, data: { enabled: Boolean(body.enabled) } });
  await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "piece.allowlist_changed", target: piece.key, after: { enabled: piece.enabled }, reason: body.reason ? String(body.reason) : undefined });
  return jsonOk({ piece });
}

async function adminRotateConnection(): Promise<never> {
  // Rotating a connection secret means minting a NEW credential at the
  // provider and writing it to the vault. Nothing in this codebase
  // provisions Connection secrets — `secretRef` has no real writer — so the
  // previous implementation invented a `vault://rotated-<ts>` reference plus
  // a random masked hint, set the row ACTIVE, and reported success. That is
  // a false security action: the real credential was never touched while the
  // console implied it had been. Refuse instead of pretending.
  throw new DomainError(
    "Connection secret rotation is not supported from here. Issue a new credential with the provider, then update the integration under Settings → Integrations.",
    501,
  );
}

async function adminRetryNotification(ctx: AuthContext, body: AdminBody) {
  if (body.action !== "retry") throw new DomainError("Unknown notification action", 400);
  // Tenant-scoped: a notification belongs to the user who owns it, so the
  // lookup joins through that user's organisation. Filtering on `id` alone
  // let an ADMIN re-send ANY organisation's notification — and for PUSH /
  // EMAIL that means real out-of-app egress carrying another tenant's copy.
  const n = await db.notification.findFirst({
    where: { id: String(body.id), user: { orgId: ctx.orgId } },
  });
  if (!n) throw new DomainError("Notification not found", 404);
  // Re-attempt the real delivery. This used to only write DELIVERED, so the
  // console reported a re-send that never happened. In-app needs no send
  // (the row IS the delivery); the out-of-app channels are actually sent,
  // and a failure is reported rather than shown as delivered.
  try {
    if (n.channel === "PUSH") {
      const subs = await db.pushSubscription.findMany({ where: { userId: n.userId } });
            if (subs.length === 0) throw new DomainError("this user has no push subscription", 400);
            let sent = 0;
            for (const sub of subs) {
              const res = await sendPush(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                { title: n.title, body: n.body, tag: n.caseId ?? "citizen-lane", url: "/" },
              );
              if (res.ok) sent++;
              if (res.gone) await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
            }
            if (sent === 0) throw new DomainError("push delivery failed", 502);
          } else if (n.channel === "EMAIL") {
            const user = await db.user.findUnique({ where: { id: n.userId }, select: { email: true } });
            if (!user?.email) throw new DomainError("this user has no email address", 400);
      await sendEmail({ to: user.email, subject: n.title, body: n.body });
    }
    await db.notification.update({ where: { id: n.id }, data: { status: "DELIVERED" } });
  } catch (err) {
    await db.notification.update({ where: { id: n.id }, data: { status: "FAILED" } }).catch(() => undefined);
    throw new DomainError(
      `Retry failed: ${err instanceof Error ? err.message : "delivery failed"}`,
      502,
    );
  }
  await audit({ orgId: ctx.orgId, actorId: ctx.userId, action: "notification.retried", target: n.id });
  return jsonOk({ ok: true, channel: n.channel });
}

// POST /api/admin/[section] — mutations with scope+reason (users invite, flags toggle, pieces allowlist, connections)
export async function POST(req: NextRequest, { params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    // Every admin mutation is ADMIN-only. `workflow.read` (held by RM/SENIOR_RM)
    // previously gated this block, which let a relationship manager escalate any
    // account to ADMIN via the `users-update` section.
    requireCapability(ctx, "admin.manage");
    const body = await readJson<AdminBody>(r).catch(() => ({}) as AdminBody);

    switch (section) {
      case "users":
        return adminInviteUser(ctx, body);
      case "users-update":
        return adminUpdateUser(ctx, body);
      case "revoke-sessions":
        return adminRevokeSessions(ctx, body);
      case "flags":
        return adminToggleFlag(ctx, body);
      case "programmes":
        return adminCreateProgramme(ctx, body);
      case "programmes-update":
        return adminUpdateProgramme(ctx, body);
      case "pieces":
        return adminTogglePiece(ctx, body);
      case "connections":
        return adminRotateConnection();
      case "notifications":
        return adminRetryNotification(ctx, body);
      default:
        throw new DomainError("Unknown admin section", 404);
    }
  })(req);
}
