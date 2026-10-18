"use client";

/**
 * The guided intake — the public path from "thinking about it" to "account
 * created", in four steps.
 *
 * Why this exists rather than a contact form: the firm's whole claim is that
 * the advice is specific. A visitor who picks a route and answers the questions
 * THAT ROUTE triggers arrives at the desk as a real file, not a lead. So the
 * questions are derived from the researched catalogue (`guided-intake.ts`) and
 * nothing is asked that the selected route does not actually require.
 *
 * The visitor's programme choice and answers are parked in sessionStorage
 * before the account exists (see `@/lib/guided-draft`), then read back by the
 * onboarding wizard so the client is not asked the same things twice.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n, type StringKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { PassportSeal } from "@/components/brand/devices";
import { EmptyState, Spinner } from "@/components/brand/ui";
import { usePrefersReducedMotion } from "@/components/motion/reveal";
import {
  GUIDED_STEPS,
  INTENTS,
  assessEligibility,
  documentSummary,
  intentByKey,
  missingRequired,
  questionsForProgramme,
  screeningSummary,
  type AnswerMap,
  type EligibilityVerdict,
} from "@/lib/domain/guided-intake";
import { saveGuidedDraft } from "@/lib/guided-draft";
import { countryName, isEuEfta } from "@/lib/domain/countries";
import type { PassportFields } from "@/lib/domain/mrz";
import { PassportScan } from "./passport-scan";

/** One catalogue row, as the public API returns it. */
type Row = Awaited<ReturnType<typeof api.catalog>>["programmes"][number];

/** Inline check for a completed step in the progress rail. */
function CheckMark() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 6.2 5 8.7 9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * i18n keys for the wizard chrome. The step/intent *data* (order, families)
 * lives in `@/lib/domain/guided-intake`; only the translated copy lives here,
 * keyed by the domain's stable identifiers. Typed as `StringKey`, so a renamed
 * or mis-spelled key fails the build rather than rendering a raw dot-path.
 */
const GUIDED_STEP_KEYS: Record<
  string,
  { label: StringKey; rail: StringKey; help: StringKey }
> = {
  INTENT: {
    label: "guided.step.intent.label",
    rail: "guided.step.intent.rail",
    help: "guided.step.intent.help",
  },
  PROGRAMME: {
    label: "guided.step.programme.label",
    rail: "guided.step.programme.rail",
    help: "guided.step.programme.help",
  },
  QUESTIONNAIRE: {
    label: "guided.step.questionnaire.label",
    rail: "guided.step.questionnaire.rail",
    help: "guided.step.questionnaire.help",
  },
  ACCOUNT: {
    label: "guided.step.account.label",
    rail: "guided.step.account.rail",
    help: "guided.step.account.help",
  },
};

const INTENT_KEYS: Record<string, { label: StringKey; help: StringKey }> = {
  CITIZENSHIP: {
    label: "guided.intent.citizenship.label",
    help: "guided.intent.citizenship.help",
  },
  RESIDENCE: {
    label: "guided.intent.residence.label",
    help: "guided.intent.residence.help",
  },
  BUSINESS: {
    label: "guided.intent.business.label",
    help: "guided.intent.business.help",
  },
  ADVICE: {
    label: "guided.intent.advice.label",
    help: "guided.intent.advice.help",
  },
};

/* Field, choice card and progress-rail skins live once in `globals.css`
   (`.lane-field`, `.choice`, `.rail-node`) so every form surface in the product
   shares one definition. This file composes; it does not restyle. */
const field = "lane-field";

export function GuidedIntake() {
  const setView = useApp((s) => s.setView);
  const { t } = useI18n();

  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState<string | null>(null);
  const [programmeKey, setProgrammeKey] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [catalogue, setCatalogue] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string } | null>(null);
  // Fields the visitor has left. Validation copy only appears after a blur, so
  // an empty form never greets them in red.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // Direction of the last transition — decides which way the step settles in.
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const reducedMotion = usePrefersReducedMotion();

  // The wizard's single content anchor: moving between steps moves DOM focus
  // here, so a keyboard or screen-reader user is never stranded on the button
  // that triggered the change. `tabIndex={-1}` keeps it out of the tab order.
  const stepAnchor = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  /** Advance/retreat a step, recording the direction for the transition. */
  function go(next: number) {
    if (next === step) return;
    setDirection(next > step ? "forward" : "back");
    setStep(next);
  }

  // The catalogue is the authority for what a route costs and demands. No
  // marketing fallback here: a guided path that offered a route the desk
  // cannot file would be worse than offering none.
  useEffect(() => {
    let live = true;
    api
      .catalog()
      .then((r) => {
        if (live) setCatalogue(r.programmes);
      })
      .catch(() => {
        if (live) setCatalogue([]);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  // Move focus to the step heading on every step change (but not on first
  // paint — that would steal focus before the visitor has interacted).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepAnchor.current?.focus();
  }, [step]);

  const available = useMemo(() => {
    if (!intent) return catalogue;
    const fams = new Set<string>(intentByKey(intent)?.families ?? []);
    return fams.size === 0
      ? catalogue
      : catalogue.filter((p) => fams.has(p.family));
  }, [catalogue, intent]);

  const selected = catalogue.find((p) => p.key === programmeKey);
  const questions = programmeKey ? questionsForProgramme(programmeKey) : [];
  const missing = programmeKey ? missingRequired(programmeKey, answers) : [];
  const verdict: EligibilityVerdict | null = programmeKey
    ? assessEligibility(programmeKey, answers)
    : null;
  const emailOk = String(answers.email ?? "").includes("@");

  function answer(key: string, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  const blur = (key: string) => () =>
    setTouched((prev) => ({ ...prev, [key]: true }));

  /**
   * Apply what the visitor's passport says to the questions this route actually
   * asked, and report how many answers that filled.
   *
   * Three deliberate rules: only questions the route asked are touched (the
   * question list is derived from the catalogue, so writing to a question the
   * route skipped would put an answer in the enquiry message that the form
   * never showed); an answer the visitor has already typed is never overwritten
   * by the document; and the EU/EFTA question is answered outright, because
   * that one decides the eligibility read rather than merely describing the
   * applicant.
   */
  function fillFromPassport(fields: PassportFields): number {
    const asked = new Set(questions.map((q) => q.key));
    let filled = 0;

    const put = (key: string, value: string | null) => {
      if (!value || !asked.has(key) || String(answers[key] ?? "").trim())
        return;
      answer(key, value);
      filled += 1;
    };

    put("fullName", fields.fullName);
    put("dateOfBirth", fields.dateOfBirth);
    put("nationality", countryName(fields.nationality));

    if (
      asked.has("nationalityZone") &&
      fields.nationality &&
      !String(answers.nationalityZone ?? "").trim()
    ) {
      answer("nationalityZone", isEuEfta(fields.nationality) ? "YES" : "NO");
      filled += 1;
    }

    return filled;
  }

  /** A required field the visitor has left empty — the only case we mark red. */
  function isMissingRequired(key: string): boolean {
    const q = questions.find((item) => item.key === key);
    if (!q?.required) return false;
    return Boolean(touched[key]) && !String(answers[key] ?? "").trim();
  }

  async function submitIntake() {
    if (!programmeKey) return;
    setBusy(true);
    setError(null);
    try {
      // The enquiry is the durable record: it lands in the desk's queue with the
      // route and the answers attached, whether or not signup is ever finished.
      const res = await api.submitEnquiry({
        name: String(answers.fullName ?? "").trim() || "Guided intake",
        email: String(answers.email ?? "").trim(),
        phone: String(answers.phone ?? "").trim() || undefined,
        country: String(answers.residenceCountry ?? "").trim() || undefined,
        programmeKey,
        budget: answers.availableFunds
          ? Number(answers.availableFunds)
          : undefined,
        message: buildMessage(programmeKey, answers, verdict),
      });
      // Park the answers for onboarding, then show the hand-off.
      saveGuidedDraft({
        intent,
        programmeKey,
        answers,
        savedAt: new Date().toISOString(),
      });
      setDone({ reference: res.reference });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Frame onBack={() => setView("landing")}>
        <div className="py-10" aria-busy="true" aria-live="polite">
          <span className="sr-only">{t("guided.loading")}</span>
          {/* Skeleton mirrors the real step layout — progress rail, serif
              heading, two option cards — so the arrival of content shifts
              nothing. Shimmer is gold-tinted and reduced-motion aware. */}
          <div className="flex items-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2.5">
                <div className="skeleton-shimmer h-7 w-7" />
                {i < 3 && <div className="skeleton-shimmer h-px w-10" />}
              </div>
            ))}
          </div>
          <div className="skeleton-shimmer mt-9 h-9 w-2/3" />
          <div className="skeleton-shimmer mt-3 h-3.5 w-1/2" />
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border border-limestone p-5">
                <div className="skeleton-shimmer h-5 w-40" />
                <div className="skeleton-shimmer mt-3 h-3 w-full" />
                <div className="skeleton-shimmer mt-2 h-3 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </Frame>
    );
  }

  // ── hand-off: the account step ───────────────────────────────────────────
  if (done) {
    return (
      <Frame onBack={() => setView("landing")}>
        <div
          className="gold-hairline-top fade-rise relative border border-gold/40 bg-gold/[0.06] p-8"
          role="status"
          aria-live="polite"
        >
          <PassportSeal size={44} />
          <p className="mt-4 eyebrow text-gold-ink">
            {t("guided.doneEyebrow")}
          </p>
          <h1 className="mt-3 font-editorial type-h1 text-cobble-ink">
            {t("guided.doneTitle", { reference: done.reference })}
          </h1>
          <p className="mt-3 type-lead measure text-iron-ink">
            {t("guided.doneBody")}
          </p>
          {verdict && <VerdictBlock verdict={verdict} />}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              onClick={() => setView("signup")}
              className="cta focus-gold text-sm"
            >
              {t("guided.createAccount")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setView("landing")}
              className="focus-gold rounded-none transition-colors duration-200"
            >
              {t("guided.backToSite")}
            </Button>
          </div>
        </div>
      </Frame>
    );
  }

  const stepKey = GUIDED_STEP_KEYS[GUIDED_STEPS[step].key];

  return (
    <Frame onBack={() => (step === 0 ? setView("landing") : go(step - 1))}>
      {/* Progress rail — the considered product moment. Completed steps are inked
          gold with a check; the connecting hairline fills as you advance, so
          progress reads as one continuous line, not four disconnected dots. */}
      <nav aria-label={t("guided.progressLabel")}>
        <ol className="flex items-center">
          {GUIDED_STEPS.map((s, i) => {
            const state =
              i < step ? "done" : i === step ? "current" : "upcoming";
            return (
              <li
                key={s.key}
                className="flex flex-1 items-center last:flex-none"
              >
                <div className="flex items-center gap-2.5">
                  {state === "done" ? (
                    <button
                      type="button"
                      onClick={() => go(i)}
                      aria-label={`${t(
                        GUIDED_STEP_KEYS[s.key].rail
                      )} — done, go back`}
                      title={`${t(
                        GUIDED_STEP_KEYS[s.key].rail
                      )} — done, go back`}
                      className={cn(
                        "rail-node min-h-11 min-w-11",
                        "rail-node--done"
                      )}
                    >
                      <CheckMark />
                    </button>
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "rail-node",
                        state === "current" && "rail-node--current",
                        state === "upcoming" && "rail-node--upcoming"
                      )}
                    >
                      {i + 1}
                    </span>
                  )}
                  <span
                    className={cn(
                      "hidden whitespace-nowrap eyebrow eyebrow-tight transition-colors duration-300 sm:block",
                      state === "current"
                        ? "text-cobble"
                        : "text-muted-foreground"
                    )}
                  >
                    {t(GUIDED_STEP_KEYS[s.key].rail)}
                  </span>
                </div>
                {i < GUIDED_STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="relative mx-3 h-px flex-1 overflow-hidden bg-limestone"
                  >
                    <span
                      className={cn(
                        "absolute inset-0 origin-left bg-gold transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
                        i < step ? "scale-x-100" : "scale-x-0"
                      )}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step content — refocused and announced on every step change. The wrapper
          settles in directionally (right on forward, left on back) so the change
          reads as movement through a sequence; `key` restarts the animation per
          step, and the anchor carries the live region so screen readers hear the
          new heading. */}
      <div
        key={step}
        ref={stepAnchor}
        tabIndex={-1}
        className={cn(
          "outline-none",
          !reducedMotion &&
            (direction === "forward" ? "step-in-right" : "step-in-left")
        )}
      >
        {/* Live region wraps ONLY the heading — if it wrapped the form, every
            keystroke would re-announce the whole step to a screen reader. */}
        <div aria-live="polite" aria-atomic="true">
          <h1 className="mt-8 font-editorial type-h1 text-cobble-ink">
            {t(stepKey.label)}
          </h1>
          <p className="mt-2 type-lead measure text-iron-ink">
            {t(stepKey.help)}
          </p>
        </div>

        {/* ── 1. intent ───────────────────────────────────────────────── */}
        {step === 0 && (
          <div
            className="mt-8 grid gap-3 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t("guided.intentLabel")}
          >
            {INTENTS.map((i) => (
              <button
                key={i.key}
                type="button"
                role="radio"
                aria-checked={intent === i.key}
                onClick={() => {
                  setIntent(i.key);
                  setProgrammeKey(null);
                  go(1);
                }}
                className="choice group"
              >
                <span className="choice__title">
                  {t(INTENT_KEYS[i.key].label)}
                </span>
                <span className="choice__body">
                  {t(INTENT_KEYS[i.key].help)}
                </span>
                <span aria-hidden="true" className="choice__rule" />
              </button>
            ))}
          </div>
        )}

        {/* ── 2. programme ────────────────────────────────────────────── */}
        {step === 1 && (
          <>
            {available.length === 0 ? (
              <EmptyState
                className="mt-8"
                title={t("guided.noRoutesTitle")}
                hint={t("guided.noRoutesBody")}
                action={
                  <Button
                    variant="outline"
                    onClick={() => go(0)}
                    className="focus-gold rounded-none"
                  >
                    {t("guided.chooseBroader")}
                  </Button>
                }
              />
            ) : (
              <div
                className="mt-8 grid grid-cols-1 gap-3"
                role="radiogroup"
                aria-label={t("guided.routeLabel")}
              >
                {available.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={programmeKey === p.key}
                    onClick={() => {
                      setProgrammeKey(p.key);
                      go(2);
                    }}
                    className="choice group"
                  >
                    <span className="choice__head">
                      <span className="choice__title">{p.label}</span>
                      <span className="choice__index">
                        {p.kind === "CITIZENSHIP"
                          ? t("landing.programmes.citizenship")
                          : t("landing.programmes.residence")}
                      </span>
                    </span>
                    <span className="choice__body">{p.summary}</span>
                    <span className="choice__meta">
                      {p.minInvestment > 0
                        ? t("guided.routeFrom", {
                            currency: p.currency ?? "EUR",
                            amount: p.minInvestment.toLocaleString("en-CH"),
                          })
                        : t("guided.routeNoThreshold")}
                      {" · "}
                      {t("guided.routeWeeks", {
                        weeks: p.processingWeeks ?? 0,
                        authority: p.authority ?? "",
                      })}
                    </span>
                    <span aria-hidden="true" className="choice__rule" />
                  </button>
                ))}
              </div>
            )}
            <div className="mt-7">
              <Button
                variant="outline"
                onClick={() => go(0)}
                className="focus-gold rounded-none"
              >
                {t("common.back")}
              </Button>
            </div>
          </>
        )}

        {/* ── 3. questionnaire ─────────────────────────────────────────── */}
        {step === 2 && programmeKey && (
          <>
            <div className="mt-8 border-l-2 border-gold bg-limestone/20 p-4">
              <p className="eyebrow text-gold-ink">
                {t("guided.requiresTitle")}
              </p>
              <p className="mt-2 text-sm text-iron-ink">
                {selected ? `${selected.label} — ` : ""}
                {t("guided.requiresBody", {
                  docs: documentSummary(programmeKey).length,
                  checks: screeningSummary(programmeKey).length,
                })}
              </p>
            </div>

            {/* Read the answers off a passport instead of asking the visitor to
                copy them out. Runs on the device — see `passport-scan`. */}
            <div className="mt-8">
              <PassportScan onExtract={fillFromPassport} />
            </div>

            <form
              className="mt-8 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void submitIntake();
              }}
              noValidate
            >
              {questions.map((q) => {
                const invalid = isMissingRequired(q.key);
                return (
                  <label key={q.key} className="block">
                    <span className="eyebrow eyebrow-tight text-iron-ink">
                      {q.label}
                      {q.required && <span className="text-gold-ink"> *</span>}
                    </span>
                    {q.kind === "CHOICE" || q.kind === "YES_NO" ? (
                      <select
                        className={field}
                        value={answers[q.key] ?? ""}
                        onChange={(e) => answer(q.key, e.target.value)}
                        onBlur={blur(q.key)}
                        aria-invalid={invalid || undefined}
                        required={q.required || undefined}
                        aria-required={q.required || undefined}
                      >
                        <option value="">{t("guided.pleaseChoose")}</option>
                        {q.kind === "YES_NO" ? (
                          <>
                            <option value="YES">{t("guided.yes")}</option>
                            <option value="NO">{t("guided.no")}</option>
                          </>
                        ) : (
                          (q.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))
                        )}
                      </select>
                    ) : q.key === "sourceOfWealth" ? (
                      <textarea
                        className={cn(field, "min-h-[92px]")}
                        rows={3}
                        value={answers[q.key] ?? ""}
                        onChange={(e) => answer(q.key, e.target.value)}
                        onBlur={blur(q.key)}
                        aria-invalid={invalid || undefined}
                        required={q.required || undefined}
                        aria-required={q.required || undefined}
                      />
                    ) : (
                      <input
                        className={field}
                        type={
                          q.kind === "NUMBER"
                            ? "number"
                            : q.key === "dateOfBirth"
                            ? "date"
                            : q.kind === "COUNTRY"
                            ? "text"
                            : "text"
                        }
                        value={answers[q.key] ?? ""}
                        onChange={(e) => answer(q.key, e.target.value)}
                        onBlur={blur(q.key)}
                        aria-invalid={invalid || undefined}
                        required={q.required || undefined}
                        aria-required={q.required || undefined}
                        autoComplete={
                          q.key === "fullName"
                            ? "name"
                            : q.key === "phone"
                            ? "tel"
                            : undefined
                        }
                      />
                    )}
                    {q.help && (
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {q.help}
                      </span>
                    )}
                    {invalid ? (
                      <span className="mt-1 block text-[11px] text-danger-ink">
                        {t("common.required")}
                      </span>
                    ) : (
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {q.rationale}
                      </span>
                    )}
                  </label>
                );
              })}

              <label className="block">
                <span className="eyebrow eyebrow-tight text-iron-ink">
                  {t("guided.emailLabel")}{" "}
                  <span className="text-gold-ink">*</span>
                </span>
                <input
                  className={field}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={answers.email ?? ""}
                  onChange={(e) => answer("email", e.target.value)}
                  onBlur={blur("email")}
                  aria-invalid={Boolean(touched.email && !emailOk) || undefined}
                  required
                  aria-required="true"
                />
                {touched.email && !emailOk ? (
                  <span className="mt-1 block text-[11px] text-danger-ink">
                    {t("guided.emailInvalid")}
                  </span>
                ) : (
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {t("guided.emailHint")}
                  </span>
                )}
              </label>

              {verdict && <VerdictBlock verdict={verdict} />}

              {error && (
                <p
                  role="alert"
                  aria-live="assertive"
                  className="border-l-2 border-[#8C2F2F] bg-[#8C2F2F]/[0.05] px-3 py-2 text-sm text-danger-ink"
                >
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => go(1)}
                  className="focus-gold rounded-none"
                >
                  {t("common.back")}
                </Button>
                <Button
                  type="submit"
                  disabled={busy || missing.length > 0 || !emailOk}
                  aria-busy={busy}
                  className="cta focus-gold flex-1 gap-2 text-sm"
                >
                  {busy && (
                    <Spinner className="border-[#F5F1EA] border-t-transparent" />
                  )}
                  {busy ? t("guided.sending") : t("guided.send")}
                </Button>
              </div>
              {missing.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("guided.stillNeeded", { fields: missing.join(", ") })}
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </Frame>
  );
}

/**
 * The indicative read. Deliberately framed as a routing signal on every render
 * so no client can read a "LIKELY" as an approval.
 */
function VerdictBlock({ verdict }: { verdict: EligibilityVerdict }) {
  return (
    <div
      className="mt-6 border-l-2 border-gold bg-limestone/20 p-4"
      aria-live="polite"
    >
      <p className="eyebrow text-gold-ink">Indicative read — not a decision</p>
      <p className="mt-2 text-sm text-cobble-ink">
        {verdict.verdict === "LIKELY"
          ? "The answers given meet the published thresholds for this route."
          : verdict.verdict === "REVIEW"
          ? "There is no fixed threshold to check against — this goes to a person."
          : "Some answers fall outside the published thresholds."}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-iron-ink list-disc pl-4">
        {verdict.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Eligibility is decided by the authority, not by this page or by us.
      </p>
    </div>
  );
}

/** Assemble the desk-readable enquiry body from the answered questions. */
function buildMessage(
  programmeKey: string,
  answers: AnswerMap,
  verdict: EligibilityVerdict | null
): string {
  const lines = [`Route: ${programmeKey}`];
  for (const [k, v] of Object.entries(answers)) {
    if (k === "email" || !String(v ?? "").trim()) continue;
    lines.push(`${k}: ${v}`);
  }
  if (verdict) lines.push(`Indicative read: ${verdict.verdict}`);
  return lines.join("\n").slice(0, 4000);
}

function Frame({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <main className="force-light min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 sm:px-8 py-10 sm:py-16">
        <button
          type="button"
          onClick={onBack}
          className="link-sweep eyebrow eyebrow-tight -ml-2 inline-flex min-h-11 items-center px-2 text-iron-ink transition-colors hover:text-cobble-ink"
        >
          ← {t("common.back")}
        </button>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
