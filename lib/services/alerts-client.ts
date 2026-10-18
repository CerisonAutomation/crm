/**
 * Client-safe alerting stubs — no server-only imports.
 * Mirrors the shape of `alerts.ts` for use in client components.
 */

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: "info" | "warning" | "critical";
  message: string;
  createdAt: Date;
  acknowledged: boolean;
}

export const AUTOMATION_ALERT_RULES: Array<{
  id: string;
  name: string;
  description: string;
  severity: "info" | "warning" | "critical";
  cooldownMs: number;
  lastTriggered: number;
}> = [
  {
    id: "queue-paused",
    name: "Queue Paused",
    description: "The automation queue has been paused for more than 5 minutes",
    severity: "warning",
    cooldownMs: 10 * 60 * 1000,
    lastTriggered: 0,
  },
  {
    id: "dlq-critical",
    name: "DLQ Critical",
    description: "More than 10 jobs are in the dead letter queue",
    severity: "critical",
    cooldownMs: 5 * 60 * 1000,
    lastTriggered: 0,
  },
  {
    id: "high-failure-rate",
    name: "High Failure Rate",
    description: "More than 50% of recent jobs have failed",
    severity: "critical",
    cooldownMs: 10 * 60 * 1000,
    lastTriggered: 0,
  },
  {
    id: "stuck-jobs",
    name: "Stuck Jobs",
    description: "Jobs have been running for more than 30 minutes",
    severity: "warning",
    cooldownMs: 15 * 60 * 1000,
    lastTriggered: 0,
  },
  {
    id: "queue-backlog",
    name: "Queue Backlog",
    description: "More than 50 jobs are waiting in the queue",
    severity: "warning",
    cooldownMs: 10 * 60 * 1000,
    lastTriggered: 0,
  },
];

export async function checkAutomationAlerts(): Promise<Alert[]> {
  return [];
}

export async function getActiveAutomationAlerts(): Promise<Alert[]> {
  return [];
}

export async function acknowledgeAutomationAlert(
  _alertId: string,
): Promise<void> {}
