"use client";
/**
 * Password recovery — ForgotPassword (neutral, non-enumerating request) and
 * ResetPassword (token-gated new-password form). Token resolution for the
 * reset view is `?token=` in the URL first, then the in-memory pending token
 * handed over from the sandbox link. Browser-safe.
 */
import { useState } from "react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
import { useI18n, type StringKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SandboxChip, Spinner } from "@/components/brand/ui";
import { toast } from "@/hooks/use-toast";
import { validatePassword } from "@/lib/password-policy";
import { usePasswordMinLength } from "@/lib/policy";
import { AuthLayout, FormError, PasswordInput, PasswordStrength } from "@/features/auth/auth-shell";

/** Pull the token out of a sandbox reset link (`…?token=abc`). */
function tokenFromLink(link: string): string {
  const m = link.match(/[?&]token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

const CTA = "cta w-full py-6 text-sm";

export function ForgotPassword() {
  const setView = useApp((s) => s.setView);
  const setPendingResetToken = useApp((s) => s.setPendingResetToken);
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [sandboxLink, setSandboxLink] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setSandboxLink(res.sandboxLink ?? null);
    } catch {
      // Never reveal whether the account exists — show the same neutral panel.
      setSandboxLink(null);
    } finally {
      setBusy(false);
      setDone(true);
    }
  }

  function openReset() {
    const value = tokenFromLink(sandboxLink ?? "");
    if (value) setPendingResetToken(value);
    setView("reset-password");
  }

  return (
    <AuthLayout eyebrow={t("auth.secureSignIn")} title={t("auth.forgotPassword")} back="login">
      {done ? (
        <div className="mt-8 space-y-4">
          <h2 className="font-editorial text-xl text-cobble-ink">{t("auth.resetSent")}</h2>
          <p className="text-sm text-iron-ink leading-relaxed">{t("auth.resetSentBody", { email: email.trim() })}</p>
          {sandboxLink && (
            <div className="rounded-md border border-dashed border-limestone p-3 space-y-2">
              <SandboxChip label="Sandbox" />
              <p className="text-[11px] text-muted-foreground">{t("auth.sandboxTokenNote")}</p>
              <p className="font-mono text-[11px] text-iron-ink break-all">{sandboxLink}</p>
              <Button type="button" variant="ghost" onClick={openReset} className="text-gold-ink hover:underline">
                {t("auth.resetLinkOpen")}
              </Button>
            </div>
          )}
          <Button type="button" variant="ghost" onClick={() => setView("login")} className="text-iron-ink hover:text-cobble-ink">
            {t("common.back")}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fp-email">{t("auth.emailLabel")}</Label>
            <Input
              id="fp-email" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              className="rounded-none border-input focus-visible:ring-gold"
            />
          </div>
          <Button type="submit" disabled={busy || !email.trim()} className={CTA}>
            {busy ? <Spinner className="border-[#F5F1EA]" /> : t("auth.forgotPassword")}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  const setView = useApp((s) => s.setView);
  const pendingResetToken = useApp((s) => s.pendingResetToken);
  const { t } = useI18n();
  const pwMin = usePasswordMinLength();

  // Read the URL token once on mount (client-only surface — see page.tsx gate).
  const [urlToken] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") : null,
  );
  const token = urlToken ?? pendingResetToken;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwKey = password ? validatePassword(password, pwMin) : null;
  const mismatch = confirm.length > 0 && password !== confirm;
  const pwReady = password.length > 0 && !pwKey && !mismatch;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !pwReady) return;
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      toast({ title: t("auth.passwordChanged") });
      setView("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout eyebrow={t("auth.secureSignIn")} title={t("auth.resetTitle")} back="login">
        <div className="mt-8 space-y-4">
          <div className="rounded border border-amber-brand/40 bg-amber-brand/5 p-3 text-sm leading-relaxed text-amber-ink">
            {t("auth.resetMissingToken")}
          </div>
          <Button
            type="button" variant="ghost" onClick={() => setView("forgot-password")}
            className="text-gold-ink hover:underline"
          >
            {t("auth.forgotPassword")}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout eyebrow={t("auth.secureSignIn")} title={t("auth.resetTitle")} back="login">
      <form onSubmit={submit} className="mt-8 space-y-4">
        <PasswordInput
          id="rp-password" label={t("auth.newPassword")} value={password} onChange={setPassword}
          autoComplete="new-password"
          error={pwKey ? t(pwKey as StringKey, { min: pwMin }) : null}
          showLabel={t("auth.showPassword")} hideLabel={t("auth.hidePassword")} capsLockLabel={t("auth.capsLock")}
        />
        <PasswordInput
          id="rp-confirm" label={t("auth.confirmPassword")} value={confirm} onChange={setConfirm}
          autoComplete="new-password"
          error={mismatch ? t("auth.passwordMismatch") : null}
          showLabel={t("auth.showPassword")} hideLabel={t("auth.hidePassword")} capsLockLabel={t("auth.capsLock")}
        />
        <PasswordStrength
          password={password}
          label={t("auth.passwordStrength")}
          labels={{
            weak: t("auth.strength.weak"),
            fair: t("auth.strength.fair"),
            good: t("auth.strength.good"),
            strong: t("auth.strength.strong"),
          }}
        />
        <FormError message={error} />
        <Button type="submit" disabled={busy || !pwReady} className={CTA}>
          {busy ? <Spinner className="border-[#F5F1EA]" /> : t("common.save")}
        </Button>
      </form>
    </AuthLayout>
  );
}
