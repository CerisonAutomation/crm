"use client";
/**
 * Auth shell — the shared editorial chrome for every account-lifecycle surface
 * (sign-in, sign-up, verify, forgot/reset). Reproduces the original Login
 * layout exactly: back button + locale switcher, a brand column (lockup,
 * brand note, slogan ring) and a form column with an eyebrow, rule, and title.
 *
 * Also exports the small form primitives shared by the auth views:
 * FormError, PasswordInput (with show/hide + caps-lock hint) and the advisory
 * PasswordStrength meter. Browser-safe — nothing here imports server code.
 */
import { useState, type ReactNode } from "react";
import { useApp, type View } from "@/lib/store";
import { useI18n, type StringKey } from "@/lib/i18n";
import { PassportSeal, SloganRing, Wordmark } from "@/components/brand/devices";
import { Eyebrow } from "@/components/brand/ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocaleSwitcher } from "@/features/shell/locale-switcher";
import { PASSWORD_MIN_LENGTH, scorePassword } from "@/lib/password-policy";
import { cn } from "@/lib/utils";
import { ArrowLeft, Check, Eye, EyeOff, X } from "lucide-react";

/**
 * The auth mark — the official seal sitting inside the rotating
 * "LET'S CREATE TOMORROW" stamp ring (brand book p.20/21), so the slogan
 * circles the logo instead of floating beside it.
 *
 * The ring turns as a promoted HTML layer (`.ring-spin-layer`, same trick as
 * BrandLoader): the glyphs rasterise once and the compositor rotates the
 * bitmap, so the text never re-renders per frame. `prefers-reduced-motion`
 * stops the spin in globals.css.
 */
function RingedSeal({
  ring,
  seal,
  speed = 36,
}: {
  /** Diameter of the slogan ring, px. */
  ring: number;
  /** Diameter of the seal inside it, px. */
  seal: number;
  /** One full revolution, seconds. */
  speed?: number;
}) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: ring, height: ring }}
    >
      <span
        aria-hidden="true"
        className="ring-spin-layer absolute inset-0"
        style={{ animationDuration: `${speed}s` }}
      >
        <SloganRing size={ring} animated={false} />
      </span>
      <PassportSeal size={seal} />
    </div>
  );
}

export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  back,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  back?: View;
  children: ReactNode;
}) {
  const setView = useApp((s) => s.setView);
  const { t } = useI18n();

  return (
    <main className="force-light min-h-screen flex flex-col bg-background" data-surface="editorial">
      <div className="mt-6 mx-6 flex items-center justify-between gap-4">
        <button
          onClick={() => setView(back ?? "landing")}
          className="inline-flex items-center gap-2 text-sm text-iron-ink hover:text-cobble-ink transition-colors"
          aria-label={t("common.back")}
        >
          <ArrowLeft className="h-4 w-4" /> {t("common.back")}
        </button>
        <LocaleSwitcher tone="light" />
      </div>

      <div className="flex-1 grid lg:grid-cols-2 items-start gap-12 px-6 md:px-16 py-10 max-w-6xl w-full mx-auto">
        {/* Brand column — seal with the slogan ring circling it (large: this
            is the only brand moment on the desktop auth surfaces). Top-aligned
            with the form column: centering it against a tall form once stranded
            it hundreds of px below the fields it sits beside. */}
        <div className="hidden lg:flex flex-col items-center relative">
          <div className="flex flex-col items-center gap-6">
            <RingedSeal ring={224} seal={96} />
            <Wordmark tone="dark" size="lg" className="text-center" />
          </div>
          <p className="mt-10 text-sm text-iron-ink text-center max-w-xs leading-relaxed">
            {t("auth.brandNote")}
          </p>
        </div>

        {/* Form column */}
        <div className="w-full max-w-md mx-auto">
          {/* Same mark, compact, so mobile log-in shows the logo too — capped
              at 128px so a phone-width column never overflows. */}
          <div className="mb-8 flex justify-center lg:hidden">
            <RingedSeal ring={128} seal={58} />
          </div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="font-editorial text-3xl text-cobble-ink mt-2 brand-rule">{title}</h1>
          {subtitle && <p className="mt-3 text-sm text-iron-ink leading-relaxed">{subtitle}</p>}
          {children}
        </div>
      </div>
    </main>
  );
}

export function FormError({ message, reference }: { message: string | null; reference?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-danger-ink bg-coral/10 border border-coral/40 rounded px-3 py-2">
      {message}
      {reference && (
        <span className="mt-1 block font-mono text-[10px] tracking-tight text-danger-ink/70">
          Ref {reference}
        </span>
      )}
    </p>
  );
}

export function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
  showLabel,
  hideLabel,
  capsLockLabel,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  error?: string | null;
  hint?: string;
  showLabel: string;
  hideLabel: string;
  capsLockLabel: string;
  children?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const helpId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  const readCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsOn(e.getModifierState?.("CapsLock") ?? false);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {children}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={readCaps}
          onKeyDown={readCaps}
          onBlur={() => setCapsOn(false)}
          aria-invalid={!!error}
          aria-describedby={helpId}
          className="rounded-none border-input focus-visible:ring-gold pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hideLabel : showLabel}
          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-none text-muted-foreground transition-colors hover:text-cobble-ink"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {capsOn && <p className="text-[11px] text-amber-ink">{capsLockLabel}</p>}
      {error && <p id={`${id}-error`} className="text-[11px] text-danger-ink">{error}</p>}
      {!error && hint && <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PasswordStrength({
  password,
  label,
  labels,
}: {
  password: string;
  label: string;
  labels: { weak: string; fair: string; good: string; strong: string };
}) {
  const { t } = useI18n();
  if (!password) return null;
  const { score, label: strength, checks } = scorePassword(password);
  const filled = Math.min(4, score + 1);
  const tones = ["bg-coral", "bg-amber-brand", "bg-gold", "bg-limestone"];

  // Annotated so `key` stays the literal StringKey union: without it TS widens
  // the mixed (some with `params`, some without) array to `{ key: string }`,
  // which is not assignable to `t(key: StringKey, …)`.
  const rules: ReadonlyArray<{ key: StringKey; met: boolean; params?: Record<string, string | number> }> = [
    { key: "auth.ruleLength", met: checks.length, params: { min: PASSWORD_MIN_LENGTH } },
    { key: "auth.ruleLower", met: checks.lower },
    { key: "auth.ruleUpper", met: checks.upper },
    { key: "auth.ruleDigit", met: checks.digit },
    { key: "auth.ruleSymbol", met: checks.symbol },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-iron-ink">{labels[strength]}</span>
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-none", i < filled ? tones[i] : "bg-limestone/30")} />
        ))}
      </div>
      <ul className="space-y-1 pt-1" aria-label={label}>
        {rules.map((rule) => (
          <li key={rule.key} className="flex items-center gap-1.5 text-[11px]">
            {rule.met ? (
              <Check className="h-3 w-3 text-limestone" aria-hidden="true" />
            ) : (
              <X className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />
            )}
            <span className={rule.met ? "text-muted-foreground" : "text-muted-foreground/60"}>
              {t(rule.key, rule.params)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
