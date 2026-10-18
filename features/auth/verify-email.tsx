"use client";
/**
 * Email verification — a reusable VerifyPanel (token entry, resend, sandbox
 * helpers) plus the standalone VerifyEmail route view that auto-consumes a
 * `?token=` link. Verification is non-blocking; the user can continue and
 * confirm later (the shell keeps nudging until the email is verified).
 */
import { useEffect, useState } from "react";
import { defaultViewFor, useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SandboxChip, Spinner } from "@/components/brand/ui";
import { toast } from "@/hooks/use-toast";
import { AuthLayout, FormError } from "@/features/auth/auth-shell";

type Verification = {
  sent: boolean;
  channel: string;
  detail: string;
  sandboxLink: string | null;
  expiresAt: string;
};

/** Pull the token out of a sandbox verify/reset link (`…?token=abc`). */
function tokenFromLink(link: string): string {
  const m = link.match(/[?&]token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function VerifyPanel({
  email,
  verification,
  onVerified,
}: {
  email: string;
  verification: Verification | null;
  onVerified?: () => void;
}) {
  const setView = useApp((s) => s.setView);
  const session = useApp((s) => s.session);
  const { t } = useI18n();
  // Local copy seeded from the prop and refreshed from each resend response, so
  // the sandbox link can actually appear on this surface.
  const [current, setCurrent] = useState<Verification | null>(verification);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the parent supplies a new verification (e.g. after a resend).
  // Adjusted during render rather than in an effect, so the fresh value is
  // visible on the very next paint instead of one frame later.
  const [seededFrom, setSeededFrom] = useState(verification);
  if (verification !== seededFrom) {
    setSeededFrom(verification);
    setCurrent(verification);
  }

  async function verify() {
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifyEmail(value);
      toast({ title: t("auth.verified") });
      onVerified?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    try {
      const res = await api.resendVerification(email);
      if (res.verification) setCurrent(res.verification);
      toast({ title: res.alreadyVerified ? t("auth.verified") : t("auth.resent") });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : t("common.error"), variant: "destructive" });
    } finally {
      setResending(false);
    }
  }

  function useSandbox() {
    if (current?.sandboxLink) {
      const value = tokenFromLink(current.sandboxLink);
      if (value) setToken(value);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-iron-ink leading-relaxed">{t("auth.verifyBody", { email })}</p>

      {current?.sent ? (
        <p className="text-[11px] text-muted-foreground">{t("auth.verifySentVia", { channel: current.channel })}</p>
      ) : current ? (
        <div className="rounded border border-amber-brand/40 bg-amber-brand/5 p-3 text-[11px] leading-relaxed text-amber-ink">
          {t("auth.verifyNotConfigured")}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="verify-token">{t("auth.verifyToken")}</Label>
        <Input
          id="verify-token" autoComplete="one-time-code" value={token}
          onChange={(e) => setToken(e.target.value)}
          className="rounded-none border-input focus-visible:ring-gold font-mono"
        />
      </div>

      <FormError message={error} />

      <div className="flex gap-3">
        <Button
          type="button" onClick={verify} disabled={busy || !token.trim()}
          className="cta flex-1 py-6 text-sm"
        >
          {busy ? <Spinner className="border-[#F5F1EA]" /> : t("auth.verifyAction")}
        </Button>
        <Button
          type="button" variant="ghost" onClick={resend} disabled={resending}
          className="text-gold-ink hover:underline"
        >
          {resending ? <Spinner /> : t("auth.resend")}
        </Button>
      </div>

      {current?.sandboxLink && (
        <div className="rounded-md border border-dashed border-limestone p-3 space-y-2">
          <SandboxChip label="Sandbox" />
          <p className="text-[11px] text-muted-foreground">{t("auth.sandboxTokenNote")}</p>
          <p className="font-mono text-[11px] text-iron-ink break-all">{current.sandboxLink}</p>
          <Button type="button" variant="ghost" onClick={useSandbox} className="text-gold-ink hover:underline">
            {t("auth.useSandboxToken")}
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setView(session ? defaultViewFor(session) : "login")}
        className="text-[11px] text-muted-foreground transition-colors hover:text-cobble-ink"
      >
        {t("auth.skipForNow")}
      </button>
    </div>
  );
}

export function VerifyEmail() {
  const session = useApp((s) => s.session);
  const setSession = useApp((s) => s.setSession);
  const setView = useApp((s) => s.setView);
  const { t } = useI18n();
  const [phase, setPhase] = useState<"checking" | "auto" | "error" | "manual">("checking");
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(async () => {
      const token = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("token")
        : null;
      if (token) {
        if (alive) setPhase("auto");
        try {
          await api.verifyEmail(token);
          const { user } = await api.session().catch(() => ({ user: null }));
          if (user) setSession(user);
          toast({ title: t("auth.verified") });
          // Signed in (same browser) → straight into the app; otherwise sign in.
          setView(user ? defaultViewFor(user) : "login");
        } catch (err) {
          if (alive) {
            setError(err instanceof Error ? err.message : t("common.error"));
            setPhase("error");
          }
        }
        return;
      }
      // No token in the URL: if the visitor is already signed in, offer verification.
      if (useApp.getState().session) {
        const res = await api.resendVerification().catch(() => undefined);
        if (alive && res?.verification) setVerification(res.verification);
      }
      if (alive) setPhase("manual");
    });
    return () => { alive = false; };
  }, []);

  return (
    <AuthLayout eyebrow={t("auth.secureSignIn")} title={t("auth.verifyTitle")} back="login">
      {phase === "checking" || phase === "auto" ? (
        <div className="mt-8 flex items-center gap-3 text-sm text-iron-ink">
          <Spinner className="h-5 w-5" /> {t("common.loading")}
        </div>
      ) : phase === "error" ? (
        <div className="mt-8 space-y-4">
          <FormError message={error} />
          <Button
            type="button" variant="ghost" onClick={() => setView("login")}
            className="text-gold-ink hover:underline"
          >
            {t("common.back")}
          </Button>
        </div>
      ) : session ? (
        <VerifyPanel email={session.email} verification={verification} onVerified={() => setView(defaultViewFor(session))} />
      ) : (
        <div className="mt-8 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{t("auth.verifyPendingBody")}</p>
          <Button
            type="button" onClick={() => setView("login")}
            className="cta w-full py-6 text-sm"
          >
            {t("auth.signIn")}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
