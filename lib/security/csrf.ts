/**
 * Same-origin check for state-changing API requests (CSRF defence-in-depth).
 *
 * The app authenticates with a session cookie (plus a bearer-token fallback for
 * cross-origin iframe previews). Cookies are attached automatically by the
 * browser, so a third-party page could otherwise drive a state-changing request
 * on a logged-in user's behalf. We therefore require that, whenever a browser
 * sends an `Origin` header on an unsafe method, its host matches the host the
 * request was addressed to.
 *
 * Non-browser clients (curl, server-to-server webhooks) send no `Origin`, and
 * those requests are allowed — same as before. In the iframe preview the
 * document origin IS the app origin (cookies are blocked there and a bearer
 * token is sent instead), so a same-origin `Origin` still matches and this does
 * not break the bearer flow.
 *
 * Two deliberate rules close the gaps the OWASP CSRF guidance calls out:
 *
 *  1. A request carrying an `Authorization: Bearer …` header is authenticated
 *     by a value the browser will not attach cross-site (custom headers are
 *     subject to the same-origin policy), so it cannot be forged by a third
 *     party page. Such requests are exempt from the cookie-CSRF check.
 *  2. The opaque `"null"` origin — sent by sandboxed iframes, `file://` and
 *     other opaque contexts — is REJECTED whenever a session cookie is present.
 *     A hostile page can embed the app in a sandboxed iframe and drive
 *     state-changing calls with `Origin: null`; `SameSite=None` would otherwise
 *     attach the session cookie. A `null` origin WITHOUT a session cookie is
 *     harmless (there is no ambient credential to ride) and is allowed, so
 *     first-time login / anonymous previews keep working.
 */
import type { NextRequest } from "next/server";
import { DomainError } from "@/lib/domain/states";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Must match SESSION_COOKIE in @/lib/auth. Kept local so this module stays
 *  Prisma-free and unit-testable without a database. */
const SESSION_COOKIE = "cl_session";

/** A request authenticated by a bearer token cannot be driven by a third party. */
function isBearerAuthenticated(req: NextRequest): boolean {
  const header = req.headers.get("authorization");
  return Boolean(header && /^bearer\s+\S/i.test(header));
}

/** Whether the request carries the session cookie (the ambient CSRF credential). */
function hasSessionCookie(req: NextRequest): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  return new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=`).test(cookie);
}

/** Host portion of a `host`/`x-forwarded-host` header value, port stripped. */
function hostOf(value: string): string {
  const first = value.split(",")[0].trim();
  if (!first) return "";
  try {
    return new URL(`http://${first}`).hostname.toLowerCase();
  } catch {
    return first.toLowerCase();
  }
}

/**
 * Reject cross-site state-changing requests that carry a non-matching `Origin`.
 * Safe methods and requests without an `Origin` header are always allowed.
 */
export function assertSameOrigin(req: NextRequest): void {
  const method = (req.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return;

  // Header-authenticated requests are not forgeable by a third-party page.
  if (isBearerAuthenticated(req)) return;

  const origin = req.headers.get("origin");
  if (!origin) return; // absent origin — non-browser client/tool, keep working

  // Opaque origins (sandboxed iframes, file://) are a cookie-CSRF vector when
  // SameSite=None attaches the session cookie. Reject them — but only when a
  // session cookie is actually present, so anonymous first-time flows (login,
  // public form submits) from an opaque context still work.
  if (origin.trim().toLowerCase() === "null") {
    if (hasSessionCookie(req)) throw new DomainError("Cross-site request rejected", 403);
    return;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).hostname.toLowerCase();
  } catch {
    throw new DomainError("Cross-site request rejected", 403);
  }

  const requestHost = hostOf(
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host,
  );
  if (!requestHost || originHost !== requestHost) {
    throw new DomainError("Cross-site request rejected", 403);
  }
}
