"use client";
/**
 * Login — the consolidated product's ONE sign-in, discreet and brand-consistent.
 *
 * Two audiences arrive here: the applicant (client portal) and the desk (staff
 * workspace). They share one credential, one session and one page — the
 * audience switch only pre-selects the right controls and copy, and a role that
 * does not match the chosen door produces an honest notice instead of a dead
 * end (the account always opens its own workspace).
 *
 * Fully translated via useI18n(); the locale switcher lives inside AuthLayout.
 */
import { useState } from "react";
import { useApp, type LoginAudience } from "@/lib/store";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SandboxChip, Spinner } from "@/components/brand/ui";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Chrome,
  Github,
  Lock,
  Mail,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  AuthLayout,
  FormError,
  PasswordInput,
  PasswordStrength,
} from "@/features/auth/auth-shell";
import { describeAuthError } from "@/features/auth/auth-errors";
import { cn } from "@/lib/utils";

/**
 * The door switch. A segmented control, not a link: both doors show the same
 * fields, and the choice is presentational (which space is described, where the
 * eye lands first). `aria-pressed` carries the state for assistive tech.
 */
function AudienceSwitch({
  audience,
  onChange,
}: {
  audience: LoginAudience;
  onChange: (a: LoginAudience) => void;
}) {
  const { t } = useI18n();
  const options: Array<{
    key: LoginAudience;
    label: string;
    icon: LucideIcon;
  }> = [
    { key: "client", label: t("auth.audience.clientLabel"), icon: UserRound },
    { key: "staff", label: t("auth.audience.staffLabel"), icon: Briefcase },
  ];
  return (
    <div
      role="group"
      aria-label={t("auth.audienceAria")}
      className="mt-6 grid grid-cols-2 gap-2 rounded-md border border-border bg-card p-1"
    >
      {options.map((o) => {
        const active = audience === o.key;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-3 text-[12px] font-medium tracking-[0.02em] transition-colors duration-200",
              active
                ? "bg-cobble text-[#F5F1EA]"
                : "text-iron-ink hover:bg-muted hover:text-cobble-ink",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Login() {
  const setSession = useApp((s) => s.setSession);
  const setView = useApp((s) => s.setView);
  const audience = useApp((s) => s.loginAudience);
  const setLoginAudience = useApp((s) => s.setLoginAudience);
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [magicSent, setMagicSent] = useState(false);
  const [magicSandboxLink, setMagicSandboxLink] = useState<string | null>(null);

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email || !password) {
      setError(t("auth.missingFields"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(email, password);
      const firstName = user.name.split(" ")[0];
      // The account's own role decides where it lands (setSession → shell
      // routes by role). If the visitor chose the other door, say so plainly
      // rather than letting the console open without explanation.
      const actual: LoginAudience = user.role === "CLIENT" ? "client" : "staff";
      const spaceName = (a: LoginAudience) =>
        a === "client" ? "client portal" : "staff console";
      setSession(user);
      if (actual === audience) {
        toast({
          title: t("auth.welcome", { name: firstName }),
          description: t("auth.signedIn"),
        });
      } else {
        toast({
          title: t("auth.audience.mismatchTitle", { space: spaceName(actual) }),
          description: t("auth.audience.mismatchBody", {
            name: firstName,
            space: spaceName(actual),
          }),
        });
      }
    } catch (err) {
      setError(describeAuthError(err, t).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink(e?: React.FormEvent) {
    e?.preventDefault();
    const em = email.trim();
    if (!em) {
      setError(t("auth.missingFields"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestMagicLink(em);
      setMagicSent(true);
      setMagicSandboxLink(res.sandboxLink);
      toast({
        title: t("auth.magicLinkSent"),
        description: t("auth.magicLinkSentBody", { email: em }),
      });
    } catch (err) {
      setError(describeAuthError(err, t).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleMode() {
    setMode((m) => (m === "password" ? "magic" : "password"));
    setError(null);
    setMagicSent(false);
    setMagicSandboxLink(null);
  }

  return (
    <AuthLayout
      eyebrow={t("auth.secureSignIn")}
      title={
        audience === "staff" ? t("auth.staffConsole") : t("auth.clientPortal")
      }
      subtitle={
        audience === "staff"
          ? t("auth.audience.staffHint")
          : t("auth.audience.clientHint")
      }
    >
      <AudienceSwitch
        audience={audience}
        onChange={(a) => {
          setLoginAudience(a);
          setError(null);
        }}
      />

      {mode === "password" ? (
        <form
          onSubmit={signIn}
          className="mt-6 space-y-4"
          aria-label={t("auth.signIn")}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("auth.emailLabel")}</Label>
            <div className="relative">
              <Mail
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-invalid={!!error}
                aria-describedby={error ? "login-error" : undefined}
                className="rounded-none border-input transition-all duration-200 focus-visible:ring-gold focus-visible:border-gold/60 hover:border-gold/40 pl-10"
              />
            </div>
          </div>
          <PasswordInput
            id="password"
            label={t("auth.passwordLabel")}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            showLabel={t("auth.showPassword")}
            hideLabel={t("auth.hidePassword")}
            capsLockLabel={t("auth.capsLock")}
          >
            <button
              type="button"
              onClick={() => setView("forgot-password")}
              className="text-[11px] text-gold-ink hover:underline"
            >
              {t("auth.forgotPassword")}
            </button>
          </PasswordInput>

          {/* Advisory only — the server re-checks the policy on submit. Same
              meter and same rule list as sign-up and reset, from one policy
              module (src/lib/password-policy.ts). */}
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

          {/* aria-describedby target: stays mounted so the described-by id
              resolves even before the first failure. */}
          <div id="login-error">
            <FormError message={error} />
          </div>
          <Button
            type="submit"
            disabled={busy}
            className="cta w-full py-6 text-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
            aria-busy={busy}
          >
            {busy ? (
              <>
                <Spinner className="border-[#F5F1EA] mr-2" />{" "}
                {t("auth.signingIn")}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden="true" />{" "}
                {t("auth.signIn")}
              </>
            )}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={sendMagicLink}
          className="mt-6 space-y-4"
          aria-label={t("auth.magicLinkTitle")}
        >
          <p className="text-sm text-iron-ink leading-relaxed">
            {t("auth.magicLinkSubtitle")}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="magic-email">{t("auth.emailLabel")}</Label>
            <Input
              id="magic-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-invalid={!!error}
              className="rounded-none border-input transition-all duration-200 focus-visible:ring-gold focus-visible:border-gold/60 hover:border-gold/40"
            />
          </div>
          <FormError message={error} />
          {magicSent ? (
            <div className="rounded border border-limestone bg-card p-3 text-[12px] leading-relaxed text-iron-ink">
              <p className="font-medium text-cobble-ink">
                {t("auth.magicLinkSent")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {t("auth.magicLinkSentBody", { email })}
              </p>
              {magicSandboxLink && (
                <div className="mt-3 space-y-1.5">
                  <SandboxChip label="Sandbox" />
                  <p className="font-mono text-[11px] break-all text-iron-ink">
                    {magicSandboxLink}
                  </p>
                  <a
                    href={magicSandboxLink}
                    className="inline-block text-[11px] text-gold-ink hover:underline"
                  >
                    {t("auth.magicLinkOpen")}
                  </a>
                </div>
              )}
            </div>
          ) : (
            <Button
              type="submit"
              disabled={busy}
              className="cta w-full py-6 text-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
            >
              {busy ? (
                <Spinner className="border-[#F5F1EA]" />
              ) : (
                t("auth.magicLinkSend")
              )}
            </Button>
          )}
        </form>
      )}

      {/* Passwordless toggle — a divider keeps the two sign-in methods visually equal. */}
      <div className="mt-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-limestone" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {t("auth.or")}
        </span>
        <span className="h-px flex-1 bg-limestone" />
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={toggleMode}
        className="mt-3 w-full border-gold/50 text-gold-ink hover:bg-gold/10 transition-all duration-200"
      >
        {mode === "password" ? (
          <>
            <Mail className="h-4 w-4 mr-2" aria-hidden="true" />
            {t("auth.magicLinkCta")}
          </>
        ) : (
          <>
            <Lock className="h-4 w-4 mr-2" aria-hidden="true" />
            {t("auth.magicLinkUsePassword")}
          </>
        )}
      </Button>

      {/* Staff who reached the client door (or vice versa) get a one-click way
          across before they type anything — the switch above is repeated here
          only as a sentence, because the control already exists. */}
      <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <AlertCircle
          className="mt-0.5 h-3 w-3 shrink-0 text-gold-ink"
          aria-hidden="true"
        />
        <span>
          {audience === "staff"
            ? t("auth.audience.clientPrompt")
            : t("auth.audience.staffPrompt")}{" "}
          <button
            type="button"
            onClick={() =>
              setLoginAudience(audience === "staff" ? "client" : "staff")
            }
            className="text-gold-ink hover:underline"
          >
            {audience === "staff"
              ? t("auth.audience.clientLabel")
              : t("auth.audience.staffLabel")}
          </button>
        </span>
      </p>

      <p className="mt-6 text-sm text-muted-foreground">
        {t("auth.noAccount")}{" "}
        <button
          type="button"
          onClick={() => setView("signup")}
          className="text-gold-ink hover:underline"
        >
          {t("auth.createAccount")}
        </button>
      </p>
    </AuthLayout>
  );
}
