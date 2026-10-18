import { NextRequest, NextResponse } from "next/server";

/**
 * Global API auth filter — a coarse FIRST line of defence, not the security
 * boundary. It runs on the Edge runtime, so it can only check for the
 * EXISTENCE of a credential (session cookie or bearer token); it never
 * validates it. Validation and authorization stay in the route handlers
 * (`requireAuth` / `requireCapability`), which remain the real gate.
 *
 * The value of this layer is that a request carrying NO credential at all is
 * rejected before it reaches a handler (and before any DB work). It must never
 * shadow a legitimately session-free endpoint — those are listed below.
 */
const SESSION_COOKIE = "cl_session";

// Public API paths — no session cookie or bearer token required.
const PUBLIC_PATHS = new Set([
  // Service descriptor (src/app/api/route.ts serves /api, not /api/route).
  "/api",
  "/api/health",
  "/api/catalog",
  "/api/enquiries",
  "/api/brand",
  "/api/brand/favicon.svg",
  "/api/calendar/feed",
  "/api/policy",
  // Session-free ingress/egress that authenticates by its OWN mechanism inside
  // the handler — the proxy must not shadow it. (`/api/telemetry`'s GET is
  // still staff-gated by requireAuth in the handler; only its POST is public.)
  "/api/telemetry",
  "/api/webhooks/dhl",
  "/api/cron/tick",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/magic-link",
  "/api/auth/verify-magic-link",
  "/api/auth/session",
]);

// Public path prefixes (wildcard matches).
const PUBLIC_PREFIXES = [
  "/api/pages/public",
  // Inbound workflow hooks (autopilot tokenised endpoint or the legacy
  // workflow-id endpoint) — every call is HMAC-signed and fails closed.
  "/api/hooks",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function hasToken(req: NextRequest): boolean {
  if (req.cookies.get(SESSION_COOKIE)?.value) return true;
  const auth = req.headers.get("authorization");
  if (auth && /^bearer\s+\S/i.test(auth)) return true;
  return false;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (isPublic(pathname)) return NextResponse.next();
  if (!hasToken(req)) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
