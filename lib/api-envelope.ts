/**
 * Stable API response envelope (Zenith blueprint §10).
 *
 * Every API response uses this shape:
 * ```json
 * { "data": {}, "receipt": {"id": "uuid", "status": "ACCEPTED"}, "correlationId": "uuid", "error": null }
 * ```
 *
 * This gives clients a consistent contract for success and error handling,
 * with receipts for async operations and correlation IDs for tracing.
 */

export type ReceiptStatus = "ACCEPTED" | "PENDING" | "COMPLETED" | "FAILED";

export interface Receipt {
  id: string;
  status: ReceiptStatus;
  next?: string;
}

export type ApiErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "STALE_VERSION"
  | "PROVIDER_DEGRADED"
  | "RETRYABLE"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "POLICY_BLOCKED"
  | "INTERNAL_ERROR";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiEnvelope<T = unknown> {
  data: T | null;
  receipt: Receipt | null;
  correlationId: string;
  error: ApiError | null;
}

export function createReceipt(status: ReceiptStatus = "COMPLETED", next?: string): Receipt {
  return {
    id: crypto.randomUUID(),
    status,
    next,
  };
}

export function ok<T>(data: T, correlationId: string, receipt?: Receipt): ApiEnvelope<T> {
  return {
    data,
    receipt: receipt ?? createReceipt("COMPLETED"),
    correlationId,
    error: null,
  };
}

export function fail(
  code: ApiErrorCode,
  message: string,
  correlationId: string,
  details?: Record<string, unknown>,
): ApiEnvelope<null> {
  return {
    data: null,
    receipt: createReceipt("FAILED"),
    correlationId,
    error: { code, message, details },
  };
}

export function pending<T>(
  data: T,
  correlationId: string,
  next: string,
): ApiEnvelope<T> {
  return {
    data,
    receipt: createReceipt("PENDING", next),
    correlationId,
    error: null,
  };
}

/**
 * Wrap a Response with the stable envelope.
 */
export function envelopeResponse<T>(
  envelope: ApiEnvelope<T>,
  status: number = 200,
): Response {
  return Response.json(envelope, { status });
}
