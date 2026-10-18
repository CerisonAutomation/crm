import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PwaClient } from "@/components/pwa/pwa-client";
import { NativeShell } from "@/components/native/native-shell";
import { CookieConsent } from "@/components/brand/cookie-consent";
import { DegradeBanner } from "@/components/brand/degrade-banner";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ErrorBoundary } from "@/components/brand/error-boundary";
import { ErrorBoundaryTestHook } from "@/components/brand/error-boundary-test-hook";

export const metadata: Metadata = {
  title: "Citizen Lane — Citizenship & Residence by Investment",
  description:
    "Citizen Lane is the leading consultancy for residence permits through business investment in Germany and one of the leaders in the Austrian market. Let's create tomorrow.",
  keywords: [
    "Citizen Lane",
    "citizenship by investment",
    "residence permit",
    "Zurich",
    "Germany",
    "Austria",
  ],
  manifest: "/manifest.json",
  applicationName: "Citizen Lane",
  appleWebApp: {
    capable: true,
    title: "Citizen Lane",
    statusBarStyle: "black-translucent",
  },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  openGraph: {
    title: "Citizen Lane",
    description:
      "Citizenship & Residence by Investment — Let's create tomorrow.",
    siteName: "Citizen Lane",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#12283A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        {/* Appearance preferences are painted before React hydrates so a saved
            theme, text size, density, contrast or motion choice never flashes
            (pairs with src/lib/ui-mode.ts and the rules in globals.css). Falls
            back to the legacy `cl.theme` key, then to the light brand default.
            Served as an external file (public/theme-prepaint.js) rather than an
            inline <script> — one less inline script in the page.

            Deliberately synchronous. `@next/next/no-sync-scripts` exists to stop
            render-blocking THIRD-PARTY scripts; this one must run before the
            first paint or the saved theme flashes, and it is a tiny same-origin
            file, so the rule is overridden here on purpose. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- must run before first paint; same-origin, tiny */}
        <script src="/theme-prepaint.js" />
        {/* Health-driven degrade strip (P2-2) — silent unless /api/health reports non-ready. */}
        <DegradeBanner />
        <ErrorBoundary>
          <ErrorBoundaryTestHook />
          <NuqsAdapter>{children}</NuqsAdapter>
        </ErrorBoundary>
        <Toaster />
        <PwaClient />
        <NativeShell />
        {/* ePrivacy/GDPR consent gate — sets no non-essential cookie before a choice. */}
        <CookieConsent />
      </body>
    </html>
  );
}
