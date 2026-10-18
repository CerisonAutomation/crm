"use client";
/**
 * Passwordless sign-in — consumes a one-time `?token=` link, establishes the
 * session and hands the visitor into the app.
 *
 * Mirrors the verify-email surface: a standalone route mounts it for emailed
 * links (`/magic-link?token=…`) and the SPA router mounts it for
 * `?view=magic-link`. The token is single-use and short-lived; a failure is
 * shown plainly with a route back to sign-in rather than a dead end.
 */
import { useEffect, useState } from "react";
import { defaultViewFor, useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/brand/ui";
import { toast } from "@/hooks/use-toast";
import { AuthLayout, FormError } from "@/features/auth/auth-shell";

export function MagicLink() {
  const setSession = useApp((s) => s.setSession);
  const setView = useApp((s) => s.setView);
  const { t } = useI18n();
  const [phase, setPhase] = useState<"checking" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const token = globalThis.window !== undefined
        ? new URLSearchParams(window.location.search).get("token")
        : null;
      if (!token) {
        if (alive) {
          setError(t("auth.magicMissingToken"));
          setPhase("error");
        }
        return;
      }
      try {
        const { user } = await api.verifyMagicLink(token);
        if (!alive) return;
        // setSession also routes to the role-appropriate view; the standalone
        // route watches the view and hands off to the SPA root.
        setSession(user);
        toast({ title: t("auth.welcome", { name: user.name.split(" ")[0] }), description: t("auth.signedIn") });
        setView(defaultViewFor(user));
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : t("common.error"));
          setPhase("error");
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <AuthLayout eyebrow={t("auth.secureSignIn")} title={t("auth.magicTitle")} back="login">
      {phase === "checking" ? (
        <div className="mt-8 flex items-center gap-3 text-sm text-iron-ink">
          <Spinner className="h-5 w-5" /> {t("common.loading")}
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          <FormError message={error} />
          <Button
            type="button" variant="ghost" onClick={() => setView("login")}
            className="text-gold-ink hover:underline"
          >
            {t("common.back")}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
