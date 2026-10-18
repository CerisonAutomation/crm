"use client";
/**
 * Sign-up — a 4-stage wizard: identity → security → consent → verify.
 * All copy is translated; the client only ever sends name/email/password/locale
 * and a consent flag — identity is never assumed to come from the client.
 */
import { useState } from "react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
import { useI18n, type StringKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/brand/ui";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { validatePassword } from "@/lib/password-policy";
import { usePasswordMinLength } from "@/lib/policy";
import { AuthLayout, FormError, PasswordInput, PasswordStrength } from "@/features/auth/auth-shell";
import { describeAuthError } from "@/features/auth/auth-errors";
import { VerifyPanel } from "@/features/auth/verify-email";

type Verification = {
  sent: boolean;
  channel: string;
  detail: string;
  sandboxLink: string | null;
  expiresAt: string;
};

export function SignUp() {
  const setSession = useApp((s) => s.setSession);
  const setView = useApp((s) => s.setView);
  const { t, locale } = useI18n();
  const pwMin = usePasswordMinLength();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reference: string | null } | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);

  const nameOk = name.trim().length > 0;
  const emailOk = email.trim().length > 0 && email.includes("@");
  const pwKey = password ? validatePassword(password, pwMin) : null;
  const mismatch = confirm.length > 0 && password !== confirm;
  const pwReady = password.length > 0 && !pwKey && !mismatch;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.register({
        name: name.trim(),
        email: email.trim(),
        password,
        locale,
        consent: terms && privacy,
      });
      setSession(data.user);
      // Keep the wizard mounted on step 4 — setSession lands CLIENTS in
      // client-onboarding, so re-assert the sign-up view before continuing.
      setView("signup");
      setVerification(data.verification);
      setStep(4);
      toast({ title: t("auth.accountCreated"), description: t("auth.verifyPendingBody") });
    } catch (err) {
      setError(describeAuthError(err, t));
    } finally {
      setBusy(false);
    }
  }

  const stepTitle = step === 1 ? t("auth.stepIdentity") : step === 2 ? t("auth.stepSecurity") : t("auth.stepConsent");

  return (
    <AuthLayout eyebrow={t("auth.createAccountEyebrow")} title={t("auth.createAccount")}>
      {step < 4 && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-gold-ink">
              {t("auth.stepOf", { n: step, total: 3 })}
            </p>
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {[1, 2, 3].map((d) => (
                <span key={d} className={cn("h-1.5 w-1.5 rounded-full", d <= step ? "bg-gold" : "bg-limestone")} />
              ))}
            </div>
          </div>
          <h2 className="mt-3 font-editorial text-xl text-cobble-ink">{stepTitle}</h2>
        </div>
      )}

      {step === 1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk && emailOk) setStep(2);
          }}
          className="mt-6 space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="su-name">{t("auth.nameLabel")}</Label>
            <Input
              id="su-name" autoComplete="name" value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-none border-input focus-visible:ring-gold"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-email">{t("auth.emailLabel")}</Label>
            <Input
              id="su-email" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              className="rounded-none border-input focus-visible:ring-gold"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button
              type="button" variant="ghost" onClick={() => setView("login")}
              className="text-iron-ink hover:text-cobble-ink"
            >
              {t("common.back")}
            </Button>
            <Button
              type="submit" disabled={!nameOk || !emailOk}
              className="cta flex-1 py-6 text-sm"
            >
              {t("common.next")}
            </Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pwReady) setStep(3);
          }}
          className="mt-6 space-y-4"
        >
          <PasswordInput
            id="su-password" label={t("auth.newPassword")} value={password} onChange={setPassword}
            autoComplete="new-password"
            error={pwKey ? t(pwKey as StringKey, { min: pwMin }) : null}
            showLabel={t("auth.showPassword")} hideLabel={t("auth.hidePassword")} capsLockLabel={t("auth.capsLock")}
          />
          <PasswordInput
            id="su-confirm" label={t("auth.confirmPassword")} value={confirm} onChange={setConfirm}
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
          <div className="flex gap-3 pt-1">
            <Button
              type="button" variant="ghost" onClick={() => setStep(1)}
              className="text-iron-ink hover:text-cobble-ink"
            >
              {t("common.back")}
            </Button>
            <Button
              type="submit" disabled={!pwReady}
              className="cta flex-1 py-6 text-sm"
            >
              {t("common.next")}
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="mt-6 space-y-4">
          <div className="rounded-md border border-border p-3">
            <p className="text-sm font-medium text-cobble-ink">{name.trim()}</p>
            <p className="text-[11px] text-muted-foreground break-all">{email.trim()}</p>
          </div>
          <p className="text-sm text-iron-ink leading-relaxed">{t("auth.consentLead")}</p>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox id="su-terms" checked={terms} onCheckedChange={(v) => setTerms(v === true)} className="mt-0.5" />
              <Label htmlFor="su-terms" className="text-sm font-normal leading-snug text-iron-ink">
                {t("auth.consentTermsPrefix")}{" "}
                <a href="/legal/terms-of-service" className="text-cobble-ink underline underline-offset-2 hover:text-gold-ink">
                  {t("legal.termsOfService")}
                </a>
              </Label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox id="su-privacy" checked={privacy} onCheckedChange={(v) => setPrivacy(v === true)} className="mt-0.5" />
              <Label htmlFor="su-privacy" className="text-sm font-normal leading-snug text-iron-ink">
                {t("auth.consentPrivacyPrefix")}{" "}
                <a href="/legal/privacy-policy" className="text-cobble-ink underline underline-offset-2 hover:text-gold-ink">
                  {t("legal.privacyPolicy")}
                </a>
              </Label>
            </div>
          </div>
          {!(terms && privacy) && <p className="text-[11px] text-danger-ink">{t("auth.consentRequired")}</p>}
          <p className="text-[11px] text-muted-foreground">{t("common.language")}: {locale.toUpperCase()}</p>
          <FormError message={error?.message ?? null} reference={error?.reference} />
          <div className="flex gap-3 pt-1">
            <Button
              type="button" variant="ghost" onClick={() => setStep(2)}
              className="text-iron-ink hover:text-cobble-ink"
            >
              {t("common.back")}
            </Button>
            <Button
              type="button" onClick={submit} disabled={busy || !(terms && privacy)}
              className="cta flex-1 py-6 text-sm"
            >
              {busy ? <Spinner className="border-[#F5F1EA]" /> : t("auth.createAccount")}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <VerifyPanel
          email={email.trim()}
          verification={verification}
          onVerified={() => setView("client-onboarding")}
        />
      )}
    </AuthLayout>
  );
}
