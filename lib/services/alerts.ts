/**
 * Alerting system for monitoring automation and workflow health.
 * Follows patterns from Citizen Lane's automation engine for robust monitoring.
 */

import { db } from "@/lib/db";
import { notifyUser } from "@/lib/services/notify";
import { DomainError } from "@/lib/domain/states";

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

// Automation-specific alert rules
export const AUTOMATION_ALERT_RULES: AlertRule[] = [
  {
    id: "queue-paused",
    name: "Queue Paused",
    description: "The automation queue has been paused for more than 5 minutes",
    severity: "warning",
    check: async () => {
      // In a real implementation, this would check the actual queue state
      // For now, we'll return false as a placeholder
      return false;
    },
    cooldownMs: 10 * 60 * 1000, // 10 minutes
    lastTriggered: 0,
  },
  {
    id: "dlq-critical",
    name: "DLQ Critical",
    description: "More than 10 jobs are in the dead letter queue",
    severity: "critical",
    check: async () => {
      // This would check the actual dead letter queue count
      // Placeholder implementation
      return false;
    },
    cooldownMs: 5 * 60 * 1000, // 5 minutes
    lastTriggered: 0,
  },
  {
    id: "high-failure-rate",
    name: "High Failure Rate",
    description: "More than 50% of recent jobs have failed",
    severity: "critical",
    check: async () => {
      // This would check recent job failure rates
      // Placeholder implementation
      return false;
    },
    cooldownMs: 10 * 60 * 1000, // 10 minutes
    lastTriggered: 0,
  },
  {
    id: "stuck-jobs",
    name: "Stuck Jobs",
    description: "Jobs have been running for more than 30 minutes",
    severity: "warning",
    check: async () => {
      // This would check for stuck running jobs
      // Placeholder implementation
      return false;
    },
    cooldownMs: 15 * 60 * 1000, // 15 minutes
    lastTriggered: 0,
  },
  {
    id: "queue-backlog",
    name: "Queue Backlog",
    description: "More than 50 jobs are waiting in the queue",
    severity: "warning",
    check: async () => {
      // This would check the queued job count
      // Placeholder implementation
      return false;
    },
    cooldownMs: 10 * 60 * 1000, // 10 minutes
    lastTriggered: 0,
  },
];

/**
 * Check all alert rules and return triggered alerts.
 * Respects cooldown periods to prevent alert flooding.
 */
export async function checkAutomationAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = Date.now();

  for (const rule of AUTOMATION_ALERT_RULES) {
    // Skip if still in cooldown period
    if (now - rule.lastTriggered < rule.cooldownMs) continue;

    try {
      const triggered = await rule.check();
      if (triggered) {
        // Update last triggered timestamp
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

        // Notify system administrators
        await notifyUser({
          userId: "system",
          title: `Automation Alert: ${rule.name}`,
          body: rule.description,
          category: "SYSTEM",
        });
      }
    } catch (error) {
      console.error(`Alert check failed for ${rule.id}:`, error);
      // Continue checking other rules even if one fails
    }
  }

  return alerts;
}

/**
 * Get currently active alerts (respecting check logic but not updating lastTriggered).
 * Used for displaying current alert status.
 */
export async function getActiveAutomationAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = Date.now();

  for (const rule of AUTOMATION_ALERT_RULES) {
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

/**
 * Acknowledge an alert (stub implementation - actual acknowledgement 
 * would be recorded in audit trail by caller).
 */
export async function acknowledgeAutomationAlert(_alertId: string): Promise<void> {
  // In a full implementation, this would update the alert in database
  // and record the acknowledgement in the audit trail
}

/**
 * Get alert history with optional limit.
 * In a full implementation, this would query a database table.
 */
export async function getAutomationAlertHistory(limit = 50): Promise<Alert[]> {
  // For now, return active alerts as history
  // In a real system, this would query persisted alert records
  return getActiveAutomationAlerts().then(alerts => alerts.slice(0, limit));
}