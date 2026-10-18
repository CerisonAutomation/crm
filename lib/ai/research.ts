/**
 * Auto-research — the platform reads its own operational data and reports the
 * gaps that need a human. Deterministic signals are computed from the database
 * (org-scoped), then optionally narrated by the model. This is the "what should
 * I do next?" engine behind the AI console's Research tab.
 */
import { db } from "@/lib/db";
import { platformCaseStatusLabel } from "@/lib/settings/registry";
import { loadPlatformSettings } from "@/lib/settings/store";
import { aiChat } from "./providers";
import { SYSTEM_PROMPTS, USER_TEMPLATES } from "./prompts";

export type InsightSeverity = "critical" | "warn" | "info";
export type Insight = {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  action?: string;
  count: number;
};

const OPEN_STATUSES = [
  "ONBOARDING", "DATA_SUBMITTED", "DATA_APPROVED", "SERVICE_SELECTED", "SERVICE_APPROVED",
  "DOCS_REQUESTED", "IN_PROGRESS", "DISPATCHED", "FOLLOW_UP", "APPROVED_IN_PRINCIPLE",
];

export async function buildSignals(orgId: string): Promise<{ signals: string; insights: Insight[]; summary: string }> {
  const now = new Date();
  const staleCutoff = new Date(Date.now() - 14 * 86_400_000);

  const [stalled, pendingDocs, overdueRequests, failedRuns, unassigned, overdueRenewals, overdueReminders, deadLetters] =
    await Promise.all([
      db.case.findMany({ where: { orgId, status: { in: OPEN_STATUSES }, updatedAt: { lt: staleCutoff } }, select: { reference: true, status: true }, take: 25 }),
      db.document.count({ where: { case: { orgId }, status: "IN_REVIEW" } }),
      db.documentRequest.findMany({ where: { case: { orgId }, status: "OPEN", dueDate: { lt: now } }, select: { title: true }, take: 25 }),
      db.workflowRun.count({ where: { workflow: { orgId }, status: "FAILED" } }),
      db.case.count({ where: { orgId, status: { in: OPEN_STATUSES }, assignments: { none: {} } } }),
      db.renewalReminder.count({ where: { orgId, status: { in: ["OPEN", "SCHEDULED"] }, dueAt: { lt: now } } }),
      db.reminder.count({ where: { status: "SCHEDULED", dueAt: { lt: now }, case: { orgId } } }),
      db.notification.count({ where: { status: "DEAD_LETTER", user: { orgId } } }),
    ]);

  const insights: Insight[] = [];
  // Status labels resolve settings-first (canon underneath), so a rename shows
  // here exactly as it shows in the queue — not the frozen domain map.
  const platform = await loadPlatformSettings();
  if (unassigned > 0) {
    insights.push({ id: "unassigned", severity: "warn", count: unassigned, title: `${unassigned} open case${unassigned === 1 ? "" : "s"} without a relationship manager`, detail: "No RM is assigned, so no one is notified when these cases change.", action: "Assign an RM from the case detail (Assign action)." });
  }
  if (overdueRequests.length > 0) {
    insights.push({ id: "overdue-requests", severity: "critical", count: overdueRequests.length, title: `${overdueRequests.length} document request${overdueRequests.length === 1 ? "" : "s"} overdue`, detail: overdueRequests.map((r) => r.title).slice(0, 6).join(", "), action: "Chase the client or issue a flexible follow-up request." });
  }
  if (stalled.length > 0) {
    insights.push({ id: "stalled", severity: "warn", count: stalled.length, title: `${stalled.length} case${stalled.length === 1 ? "" : "s"} stalled for 14+ days`, detail: stalled.map((c) => `${c.reference} (${platformCaseStatusLabel(platform, c.status)})`).slice(0, 6).join(", "), action: "Open the case and apply the next action." });
  }
  if (failedRuns > 0) {
    insights.push({ id: "failed-runs", severity: "critical", count: failedRuns, title: `${failedRuns} workflow run${failedRuns === 1 ? "" : "s"} failed`, detail: "Automation did not complete — a client notification may be missing.", action: "Open the Run Inspector and retry." });
  }
  if (pendingDocs > 0) {
    insights.push({ id: "pending-docs", severity: "info", count: pendingDocs, title: `${pendingDocs} document${pendingDocs === 1 ? "" : "s"} awaiting RM review`, detail: "Clients are waiting on a decision.", action: "Approve or request changes on each document." });
  }
  if (overdueRenewals > 0) {
    insights.push({ id: "overdue-renewals", severity: "warn", count: overdueRenewals, title: `${overdueRenewals} obligation${overdueRenewals === 1 ? "" : "s"} past due`, detail: "Permit/filing deadlines have lapsed.", action: "Review the obligations ledger." });
  }
  if (overdueReminders > 0) {
    insights.push({ id: "overdue-reminders", severity: "info", count: overdueReminders, title: `${overdueReminders} reminder${overdueReminders === 1 ? "" : "s"} past due`, detail: "Scheduled reminders were not actioned.", action: "Run the reminder sweep or reschedule." });
  }
  if (deadLetters > 0) {
    insights.push({ id: "dead-letters", severity: "warn", count: deadLetters, title: `${deadLetters} notification${deadLetters === 1 ? "" : "s"} in the dead-letter queue`, detail: "Delivery failed and was not retried successfully.", action: "Retry from the notification centre." });
  }

  const rank: Record<InsightSeverity, number> = { critical: 0, warn: 1, info: 2 };
  insights.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);

  const signals = insights.length
    ? insights.map((i) => `[${i.severity}] ${i.title} — ${i.detail}`).join("\n")
    : "No operational gaps detected: no stalled cases, overdue requests, failed runs or unassigned cases.";
  const summary = insights.length
    ? insights.map((i) => `${i.title}. ${i.action ?? ""}`.trim()).join(" ")
    : "Everything is up to date — no gaps detected.";

  return { signals, insights, summary };
}

export type ResearchResult = {
  generatedAt: string;
  insights: Insight[];
  summary: string;
  provider: string;
};

/** Deterministic insights, narrated by the model when it is available. */
export async function runAutoResearch(orgId: string): Promise<ResearchResult> {
  const { signals, insights, summary } = await buildSignals(orgId);
  const live = await aiChat([
    { role: "system", content: SYSTEM_PROMPTS.researcher },
    { role: "user", content: USER_TEMPLATES.researcher(signals) },
  ]);
  return {
    generatedAt: new Date().toISOString(),
    insights,
    summary: live?.text ?? summary,
    provider: live?.provider ?? "deterministic-fallback",
  };
}
