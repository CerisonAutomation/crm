import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";
import { platformCaseStatusLabel, type PlatformSettings } from "@/lib/settings/registry";
import { programmeByKey } from "@/lib/domain/programmes";
import { slaForCase } from "@/lib/domain/lifecycle";
import { loadPlatformSettings } from "@/lib/settings/store";
import { csvRow } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports/export — CSV business intelligence export.
 *
 * Gated on `audit.read`, which only RM/SENIOR_RM/ADMIN/AUDITOR hold, and scoped
 * to the caller's own organisation. Three reports:
 *
 *   ?report=cases     — one row per case: stage, cycle time, RM load, doc health
 *   ?report=rm-load   — one row per staff member: active load, P1 count, overdue
 *   ?report=funnel    — one row per case stage: count and median age in stage
 *
 * CSV is chosen over JSON deliberately: the audience is a spreadsheet, and the
 * escaping below is the whole security story — a client name beginning with
 * `=` or `+` would otherwise execute as a formula when opened in Excel, so
 * formula-leading values are neutralised.
 */

const row = (cells: unknown[]): string => csvRow(cells);
const days = (ms: number): number => Math.max(0, Math.floor(ms / 86_400_000));

/** Median of a numeric series (0 for an empty series); floor-averages even counts. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.floor((s[mid - 1] + s[mid]) / 2);
}

function csvResponse(rows: string[], name: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(rows.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="citizen-lane-${name}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}

async function casesReport(orgId: string, platform: PlatformSettings): Promise<Response> {
  const cases = await db.case.findMany({
    where: { orgId },
    include: {
      client: { select: { name: true, email: true, nationality: true } },
      programme: { select: { key: true, name: true, country: true } },
      assignments: { select: { user: { select: { name: true, role: true } } } },
      documents: { select: { status: true } },
      requests: { select: { status: true } },
      letters: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const rows = [
    row([
      "reference", "stage", "status", "riskFlag", "priorityScore", "client", "email",
      "nationality", "programmeKey", "programme", "country", "rm",
      "documents", "documentsApproved", "openRequests", "letters",
      "createdAt", "updatedAt", "ageDays", "cycleDays",
    ]),
    ...cases.map((c) =>
      row([
        c.reference, platformCaseStatusLabel(platform, c.status), c.status, c.riskFlag, c.priorityScore ?? "",
        c.client.name, c.client.email, c.client.nationality ?? "",
        c.programme?.key ?? "", c.programme?.name ?? "", c.programme?.country ?? "",
        c.assignments[0]?.user.name ?? "",
        c.documents.length,
        c.documents.filter((d) => d.status === "RM_APPROVED").length,
        c.requests.filter((q) => q.status === "OPEN").length,
        c.letters.length,
        c.createdAt.toISOString(), c.updatedAt.toISOString(),
        days(Date.now() - c.createdAt.getTime()),
        days(c.updatedAt.getTime() - c.createdAt.getTime()),
      ]),
    ),
  ];
  return csvResponse(rows, "cases");
}

async function rmLoadReport(orgId: string): Promise<Response> {
  const staff = await db.user.findMany({
    where: { orgId, role: { in: ["RM", "SENIOR_RM"] }, status: "ACTIVE" },
    select: {
      id: true, name: true, email: true, role: true,
      assignments: {
        select: {
          case: {
            select: {
              status: true, riskFlag: true, priorityScore: true, createdAt: true, updatedAt: true,
              requests: { select: { status: true, dueDate: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const openStates = (s: string) => !["COMPLETED", "CANCELLED"].includes(s);
  const rows = [
    row([
      "rm", "email", "role", "assignedTotal", "activeCases", "p1", "p2", "highRisk",
      "oldestActiveDays", "openRequests", "overdueRequests", "staleCases",
    ]),
    ...staff.map((u) => {
      const cs = u.assignments.map((a) => a.case);
      const active = cs.filter((c) => openStates(c.status));
      const requests = active.flatMap((c) => c.requests);
      const now = Date.now();
      return row([
        u.name, u.email, u.role, cs.length, active.length,
        active.filter((c) => (c.priorityScore ?? 0) >= 66).length,
        active.filter((c) => (c.priorityScore ?? 0) >= 33 && (c.priorityScore ?? 0) < 66).length,
        active.filter((c) => c.riskFlag === "HIGH").length,
        active.length ? Math.max(...active.map((c) => days(now - c.createdAt.getTime()))) : 0,
        requests.filter((q) => q.status === "OPEN").length,
        requests.filter((q) => q.status === "OPEN" && q.dueDate && q.dueDate.getTime() < now).length,
        active.filter((c) => days(now - c.updatedAt.getTime()) > 14).length,
      ]);
    }),
  ];
  return csvResponse(rows, "rm-load");
}

async function funnelReport(orgId: string, platform: PlatformSettings): Promise<Response> {
  const cases = await db.case.findMany({
    where: { orgId },
    select: { status: true, createdAt: true, updatedAt: true },
    take: 5000,
  });
  const byStage = new Map<string, { count: number; ages: number[] }>();
  const now = Date.now();
  for (const c of cases) {
    const bucket = byStage.get(c.status) ?? { count: 0, ages: [] };
    bucket.count += 1;
    bucket.ages.push(days(now - c.createdAt.getTime()));
    byStage.set(c.status, bucket);
  }
  // Per-stage SLA: each case is measured against its CURRENT stage's SLA
  // (slaForCase resolves the stage from the status and measures age against
  // it), so the funnel reports not just how many cases sit in a stage but
  // how many are past their clock — "oldestAgeDays" alone cannot show that.
  const nowDate = new Date(now);
  // Operator-set stage service levels drive the report exactly as they drive
  // the queue, so the two can never disagree about what "overdue" means.
  const slaOverrides = platform.operations.slaDays;
  const slaByStatus = new Map<string, { overdue: number; remaining: number[]; slaDays: number }>();
  for (const c of cases) {
    const sla = slaForCase({ status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt }, nowDate, slaOverrides);
    if (!sla) continue;
    const b = slaByStatus.get(c.status) ?? { overdue: 0, remaining: [], slaDays: sla.slaDays };
    if (sla.overdue) b.overdue += 1;
    b.remaining.push(sla.remainingDays);
    b.slaDays = sla.slaDays;
    slaByStatus.set(c.status, b);
  }
  const rows = [
    row(["stage", "status", "cases", "medianAgeDays", "oldestAgeDays", "shareOfTotal", "slaDays", "overdueCases", "medianDaysRemaining", "atRiskPct"]),
    ...[...byStage.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([status, b]) => {
        const sla = slaByStatus.get(status);
        const overdue = sla?.overdue ?? 0;
        return row([
          platformCaseStatusLabel(platform, status), status, b.count, median(b.ages),
          b.ages.length ? Math.max(...b.ages) : 0,
          cases.length ? `${Math.round((b.count / cases.length) * 1000) / 10}%` : "0%",
          sla?.slaDays ?? "",
          sla ? overdue : "",
          sla ? median(sla.remaining.map((r) => Math.round(r))) : "",
          b.count ? `${Math.round((overdue / b.count) * 1000) / 10}%` : "0%",
        ]);
      }),
  ];
  return csvResponse(rows, "funnel");
}

async function programmesReport(orgId: string): Promise<Response> {
  const cases = await db.case.findMany({
    where: { orgId },
    select: { status: true, programme: { select: { key: true, name: true, country: true } } },
    take: 5000,
  });
  const byKey = new Map<string, { name: string; country: string; total: number; active: number; completed: number }>();
  for (const c of cases) {
    const k = c.programme?.key ?? "(unselected)";
    const b = byKey.get(k) ?? {
      name: c.programme?.name ?? "No programme selected",
      country: c.programme?.country ?? "",
      total: 0, active: 0, completed: 0,
    };
    b.total += 1;
    if (c.status === "COMPLETED") b.completed += 1;
    else if (c.status !== "CANCELLED") b.active += 1;
    byKey.set(k, b);
  }
  const rows = [
    row(["programmeKey", "programme", "country", "family", "cases", "active", "completed", "feeChf", "complexity"]),
    ...[...byKey.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([key, b]) => {
        const cap = programmeByKey(key);
        return row([
          key, b.name, b.country, cap?.family ?? "", b.total, b.active, b.completed,
          cap?.feeChf ?? "", cap?.complexity ?? "",
        ]);
      }),
  ];
  return csvResponse(rows, "programmes");
}

export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "audit.read");

    const report = new URL(r.url).searchParams.get("report") ?? "cases";

    // Status labels resolve settings-first (canon underneath), so the CSV shows
    // the admin's chosen names — the same names the queue shows. The stage SLAs
    // in the funnel report come from the same settings snapshot.
    const platform = await loadPlatformSettings();

    switch (report) {
      case "cases":
        return casesReport(ctx.orgId, platform);
      case "rm-load":
        return rmLoadReport(ctx.orgId);
      case "funnel":
        return funnelReport(ctx.orgId, platform);
      case "programmes":
        return programmesReport(ctx.orgId);
      default:
        return new Response(`Unknown report "${report}". Use cases | rm-load | funnel | programmes.`, {
          status: 400,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
    }
  })(req);
}
