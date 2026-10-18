/**
 * Correlation ID tracking (Zenith blueprint §10).
 *
 * Propagates correlation IDs across requests and links them to case events.
 */

import { headers } from "next/headers";

/**
 * Get the correlation ID from the request headers, or generate a new one.
 */
export async function getCorrelationId(): Promise<string> {
  const headersList = await headers();
  const existing = headersList.get("x-correlation-id");
  if (existing) return existing;
  return crypto.randomUUID();
}

/**
 * Get the correlation ID from request headers (synchronous version for route handlers).
 */
export function getCorrelationIdFromHeaders(headers: Headers): string {
  const existing = headers.get("x-correlation-id");
  if (existing) return existing;
  return crypto.randomUUID();
}

/**
 * Record a correlation ID for audit purposes.
 */
export async function recordCorrelation(
  correlationId: string,
  orgId: string,
  caseId?: string
): Promise<void> {
  // Store in a simple log table or audit event
  // For now, we'll just log it
  console.log(
    `[correlation] ${correlationId} org=${orgId} case=${caseId ?? "none"}`
  );
}

/**
 * Link a correlation ID to a case event.
 */
export async function linkCorrelationToCaseEvent(
  correlationId: string,
  caseId: string,
  eventType: string
): Promise<void> {
  // This would typically create a CaseEvent record
  // For now, we'll just log it
  console.log(
    `[correlation] ${correlationId} linked to case ${caseId} event ${eventType}`
  );
}
