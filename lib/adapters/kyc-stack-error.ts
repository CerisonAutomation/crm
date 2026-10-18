/**
 * Shared typed error for the KYC stack adapters (server-only).
 *
 * Lets a caller distinguish "the service is down / unreachable" (a typed
 * {@link KycStackError}) from any other failure, without importing one adapter
 * module into another. Never fabricated: a down service throws, it does not
 * return a fake result.
 */
export class KycStackError extends Error {
  readonly service: "paperless" | "yente";
  constructor(service: "paperless" | "yente", message: string) {
    super(message);
    this.name = "KycStackError";
    this.service = service;
  }
}
