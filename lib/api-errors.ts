/**
 * Typed API errors (Zenith blueprint §10).
 *
 * Every error returned by the API uses one of these codes, giving clients
 * a stable contract for error handling without parsing message strings.
 */

import type { ApiErrorCode } from "./api-envelope";

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.details = details;
  }
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiRequestError {
  return new ApiRequestError(code, message, details);
}

export function authenticationRequired(message = "Authentication required"): ApiRequestError {
  return apiError("AUTHENTICATION_REQUIRED", message);
}

export function forbidden(message = "Access denied"): ApiRequestError {
  return apiError("FORBIDDEN", message);
}

export function validationFailed(
  message: string,
  details?: Record<string, unknown>,
): ApiRequestError {
  return apiError("VALIDATION_FAILED", message, details);
}

export function conflict(message: string, details?: Record<string, unknown>): ApiRequestError {
  return apiError("CONFLICT", message, details);
}

export function staleVersion(message = "Resource has been modified"): ApiRequestError {
  return apiError("STALE_VERSION", message);
}

export function providerDegraded(
  message = "Provider temporarily unavailable",
  details?: Record<string, unknown>,
): ApiRequestError {
  return apiError("PROVIDER_DEGRADED", message, details);
}

export function retryable(
  message = "Request can be retried",
  details?: Record<string, unknown>,
): ApiRequestError {
  return apiError("RETRYABLE", message, details);
}

export function notFound(message = "Resource not found"): ApiRequestError {
  return apiError("NOT_FOUND", message);
}

export function rateLimited(message = "Rate limit exceeded"): ApiRequestError {
  return apiError("RATE_LIMITED", message);
}

export function policyBlocked(
  message = "Action blocked by policy",
  details?: Record<string, unknown>,
): ApiRequestError {
  return apiError("POLICY_BLOCKED", message, details);
}

export function internalError(message = "Internal server error"): ApiRequestError {
  return apiError("INTERNAL_ERROR", message);
}

/**
 * Map an ApiRequestError to an HTTP status code.
 */
export function errorToStatus(code: ApiErrorCode): number {
  switch (code) {
    case "AUTHENTICATION_REQUIRED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "VALIDATION_FAILED":
      return 422;
    case "CONFLICT":
      return 409;
    case "STALE_VERSION":
      return 409;
    case "PROVIDER_DEGRADED":
      return 503;
    case "RETRYABLE":
      return 503;
    case "NOT_FOUND":
      return 404;
    case "RATE_LIMITED":
      return 429;
    case "POLICY_BLOCKED":
      return 451;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 500;
  }
}
