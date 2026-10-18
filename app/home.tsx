"use client";

import { useEffect, Suspense } from "react";
import dynamic from "next/dynamic";
import { useApp, type View } from "@/lib/store";
import { SurfaceLoader } from "@/components/brand/ui";
import { OfflineBanner } from "@/features/shell/offline-banner";
import { applyPreferences, bindSystemTheme, readPreferences } from "@/lib/ui-mode";

/**
 * Unified SSR/CSR render path — no hydration gate needed.
 * 
 * All views render on the server with SSR enabled. A single Suspense boundary
 * wraps the entire app with a shared loading fallback, preventing hydration
 * mismatches from dynamic imports.
 */

/* All views render with SSR enabled. A single Suspense boundary handles
   the shared loading state across all dynamic imports. */
const Landing = dynamic(() => import("@/features/landing/landing").then((m) => m.Landing), { ssr: true });
const Login = dynamic(() => import("@/features/auth/login").then((m) => m.Login), { ssr: true });
const SignUp = dynamic(() => import("@/features/auth/signup").then((m) => m.SignUp), { ssr: true });
const ForgotPassword = dynamic(() => import("@/features/auth/password-reset").then((m) => m.ForgotPassword), { ssr: true });
const ResetPassword = dynamic(() => import("@/features/auth/password-reset").then((m) => m.ResetPassword), { ssr: true });
const VerifyEmail = dynamic(() => import("@/features/auth/verify-email").then((m) => m.VerifyEmail), { ssr: true });
const MagicLink = dynamic(() => import("@/features/auth/magic-link").then((m) => m.MagicLink), { ssr: true });
const PageShell = dynamic(() => import("@/features/shell/page-shell").then((m) => m.PageShell), { ssr: true });
const GuidedIntake = dynamic(() => import("@/features/landing/guided-intake").then((m) => m.GuidedIntake), { ssr: true });
const PagesExplore = dynamic(() => import("@/features/pages/pages-explorer").then((m) => m.PagesExplore), { ssr: true });
const PagesReader = dynamic(() => import("@/features/pages/pages-explorer").then((m) => m.PagesReader), { ssr: true });
const ProcedureFlow = dynamic(() => import("@/features/procedure/procedure-flow").then((m) => m.ProcedureFlow), { ssr: true });

/**
 * Views that render OUTSIDE the authenticated shell. Every other view is an
 * in-app destination owned by `AppShell`'s ViewRouter (client portal, RM
 * queue/case, settings, teams, admin console, studio, pages). AppShell
 * self-guards on `session` (it returns null when signed out), so it is safe to
 * mount for any non-public view. Gating it on a single sentinel value
 * ("app-shell", which no code ever assigns) left the entire signed-in product
 * rendering nothing.
 */
const PUBLIC_VIEWS: ReadonlySet<View> = new Set<View>([
  "landing",
  "login",
  "signup",
  "forgot-password",
  "reset-password",
  "verify-email",
  "magic-link",
  "guided",
  "pages-explore",
  "pages-reader",
  "procedure",
]);

/**
 * Per-view document titles for the PUBLIC/auth surfaces.
 *
 * The app shell already renames the tab on every in-app view change; the public
 * views render OUTSIDE it, so before this they all shared the static marketing
 * `<title>` from layout.tsx and a screen reader or the browser history could not
 * tell sign-in from sign-up from the Journal. This is the same client-side
 * mechanism the app shell uses (`document.title` in an effect keyed on `view`),
 * applied to the guest surfaces. Landing keeps the exact marketing title.
 */
const PUBLIC_TITLES: Partial<Record<View, string>> = {
  landing: "Citizen Lane — Citizenship & Residence by Investment",
  login: "Sign in · Citizen Lane",
  signup: "Create your account · Citizen Lane",
  "forgot-password": "Reset your password · Citizen Lane",
  "reset-password": "Choose a new password · Citizen Lane",
  "verify-email": "Verify your email · Citizen Lane",
  "magic-link": "Magic link · Citizen Lane",
  guided: "Start your application · Citizen Lane",
  "pages-explore": "Journal · Citizen Lane",
  "pages-reader": "Journal · Citizen Lane",
  procedure: "Austria — Citizenship for Descendants · Citizen Lane",
};

export default function Home() {
  const { view, boot } = useApp();

  // Boot the store immediately (SSR-safe)
  useEffect(() => {
    boot();
  }, [boot]);

  // Distinct tab/history title per public view. In-app views are named by the
  // app shell, which owns its own effect, so this only touches the guest set.
  useEffect(() => {
    const title = PUBLIC_TITLES[view];
    if (title) document.title = title;
  }, [view]);

  // Preferences apply to the public surfaces too (landing, sign-in, the guided
  // intake), not only inside the authenticated shell — so a signed-out visitor
  // who prefers larger text or stillness gets it before they ever sign in.
  useEffect(() => {
    applyPreferences(readPreferences());
    bindSystemTheme();
  }, []);

  return (
    <Suspense fallback={<SurfaceLoader />}>
      {/* One shared connectivity indicator for every view (G12). */}
      <OfflineBanner />
      {view === "landing" && <Landing />}
      {view === "login" && <Login />}
      {view === "signup" && <SignUp />}
      {view === "forgot-password" && <ForgotPassword />}
      {view === "reset-password" && <ResetPassword />}
      {view === "verify-email" && <VerifyEmail />}
      {view === "magic-link" && <MagicLink />}
      {view === "guided" && <GuidedIntake />}
      {view === "pages-explore" && <PagesExplore />}
      {view === "pages-reader" && <PagesReader />}
      {view === "procedure" && <ProcedureFlow />}
      {!PUBLIC_VIEWS.has(view) && <PageShell />}
    </Suspense>
  );
}