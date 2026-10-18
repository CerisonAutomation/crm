import { db } from "@/lib/db";
import { notifyUser } from "@/lib/services/notify";

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: "info" | "warning" | "critical";
  check: () => Promise<boolean>;
  cooldownMs: number;
  lastTriggered: number;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: "info" | "warning" | "critical";
  message: string;
  createdAt: Date;
  acknowledged: boolean;
}

const ALERT_RULES: AlertRule[] = [
  {
    id: "queue-paused",
    name: "Queue Paused",
    description: "The automation queue has been paused for more than 5 minutes",
    severity: "warning",
    check: async () => {
      // Queue pause state is tracked in memory; this alert is a placeholder
      // for future integration with a persistent settings store.
      return false;
    },
    cooldownMs: 10 * 60 * 1000,
    lastTriggered: 0,
  },
  {
    id: "dlq-critical",
    name: "DLQ Critical",
    description: "More than 10 jobs are in the dead letter queue",
    severity: "critical",
    check: async () => {
      const count = await db.automationJob.count({
        where: { status: "DEAD" },
      });
      return count > 10;
    },
    cooldownMs: 5 * 60 * 1000,
    lastTriggered: 0,
  },
  {
    id: "high-failure-rate",
    name: "High Failure Rate",
    description: "More than 50% of recent jobs have failed",
    severity: "critical",
    check: async () => {
      const recentJobs = await db.automationJob.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
        select: { status: true },
      });
      if (recentJobs.length < 5) return false;
      const failed = recentJobs.filter(
        (j) => j.status === "FAILED" || j.status === "DEAD"
      ).length;
      return failed / recentJobs.length > 0.5;
    },
    cooldownMs: 10 * 60 * 1000,
    lastTriggered: 0,
  },
  {
    id: "stuck-jobs",
    name: "Stuck Jobs",
    description: "Jobs have been running for more than 30 minutes",
    severity: "warning",
    check: async () => {
      const stuckJobs = await db.automationJob.findMany({
        where: {
          status: "RUNNING",
          claimedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
        },
        select: { id: true },
      });
      return stuckJobs.length > 0;
    },
    cooldownMs: 15 * 60 * 1000,
    lastTriggered: 0,
  },
  {
    id: "queue-backlog",
    name: "Queue Backlog",
    description: "More than 50 jobs are waiting in the queue",
    severity: "warning",
    check: async () => {
      const count = await db.automationJob.count({
        where: { status: "QUEUED" },
      });
      return count > 50;
    },
    cooldownMs: 10 * 60 * 1000,
    lastTriggered: 0,
  },
];

export async function checkAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = Date.now();

  for (const rule of ALERT_RULES) {
    if (now - rule.lastTriggered < rule.cooldownMs) continue;

    try {
      const triggered = await rule.check();
      if (triggered) {
        rule.lastTriggered = now;
        const alert: Alert = {
          id: crypto.randomUUID(),
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: rule.description,
          createdAt: new Date(),
          acknowledged: false,
        };
        alerts.push(alert);

        await notifyUser({
          userId: "system",
          title: `Automation Alert: ${rule.name}`,
          body: rule.description,
          category: "SYSTEM",
        });
      }
    } catch (error) {
      console.error(`Alert check failed for ${rule.id}:`, error);
    }
  }

  return alerts;
}

export async function getActiveAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = Date.now();

  for (const rule of ALERT_RULES) {
    try {
      const triggered = await rule.check();
      if (triggered) {
        alerts.push({
          id: crypto.randomUUID(),
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: rule.description,
          createdAt: new Date(),
          acknowledged: false,
        });
      }
    } catch (error) {
      console.error(`Alert check failed for ${rule.id}:`, error);
    }
  }

  return alerts;
}

export async function acknowledgeAlert(_alertId: string): Promise<void> {
  // Stub: alert acknowledgement is recorded in the audit trail by the caller.
}

export async function getAlertHistory(limit = 50): Promise<Alert[]> {
  // In a real implementation, this would query a database table
  // For now, return active alerts as history
  return getActiveAlerts();
}
