"use client";

/**
 * The Austria — Citizenship for descendants of Holocaust victims flow.
 *
 * This is the client-facing procedure: a guided, map-like journey from "I
 * think my ancestor was persecuted" to "my case is with the desk". It renders
 * the whole procedure as a map (every step, in order, with its state) and lets
 * the client walk the front of it interactively:
 *
 *   questionnaire → pre-assessment → profile → documents → agreement & pay
 *
 * The remaining steps (consultation, RM assessment, dependants, invoice,
 * cover letter, submission) are shown on the map as the journey ahead — the
 * client sees where they are and what comes next, which is the point of a
 * procedure this long.
 *
 * The pre-assessment is computed from the answers by the pure domain module
 * (`@/lib/domain/austria-descendants`) and is always framed as an indicative
 * routing signal, never as a likelihood of success.
 */
import { useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Eyebrow, Spinner } from "@/components/brand/ui";
import {
  assessCase,
  assessmentLevelLabel,
  assessmentLevelSummary,
  CASE_ASSESSMENT_DOCUMENTS,
  FEE_SCHEDULE,
  assessmentFee,
  missingQuestionnaireFields,
  persecutionReasonLabel,
  PROCEDURE_STEPS,
  questionnaireFields,
  visibleField,
  type AncestorAssessmentInput,
  type AssessmentLevel,
  type CaseAssessment,
  type QuestionnaireAnswers,
} from "@/lib/domain/austria-descendants";

/** The interactive steps, in order — the front of the procedure the client can walk. */
const INTERACTIVE_STEPS = [
  "questionnaire",
  "pre_assessment",
  "profile",
  "documents",
  "agreement_pay",
] as const;
type InteractiveStep = (typeof INTERACTIVE_STEPS)[number];

const STEP_INDEX: Record<InteractiveStep, number> = {
  questionnaire: 0,
  pre_assessment: 1,
  profile: 2,
  documents: 3,
  agreement_pay: 4,
};

const field = "lane-field";

/** The profile the desk opens the file with. */
type Profile = {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  nationality: string;
  phone: string;
  address: string;
  city: string;
  country: string;
};

const EMPTY_PROFILE: Profile = {
  firstName: "",
  lastName: "",
  email: "",
  dateOfBirth: "",
  nationality: "",
  phone: "",
  address: "",
  city: "",
  country: "",
};

export function ProcedureFlow() {
  const setView = useApp((s) => s.setView);

  const [step, setStep] = useState<InteractiveStep>("questionnaire");
  const [answers, setAnswers] = useState<QuestionnaireAnswers>({});
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [haveDocs, setHaveDocs] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [withResearch, setWithResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const assessment: CaseAssessment = useMemo(() => {
    const input: AncestorAssessmentInput = {
      ancestorCitizenship: str(answers.ancestorCitizenship),
      livedInAustria1933to1955: yesNo(answers.livedInAustria1933to1955),
      leftAustriaDate: str(answers.leftAustriaDate),
      persecutionReason: str(answers.persecutionReason),
      documentAvailable:
        Object.values(answers).includes(true) && proofAnswered(answers),
    };
    return assessCase(input);
  }, [answers]);

  const missing = useMemo(() => missingQuestionnaireFields(answers), [answers]);
  const profileReady =
    profile.firstName.trim() !== "" &&
    profile.lastName.trim() !== "" &&
    profile.email.includes("@");
  const selectedDocs = CASE_ASSESSMENT_DOCUMENTS.filter((d) => haveDocs[d.key]);
  const fee = assessmentFee(withResearch);

  function setAnswer(key: string, value: string | boolean) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  function go(next: InteractiveStep) {
    setStep(next);
  }

  function onFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 12));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Best-effort upload of any files the client attached. A failure here
      // never blocks the enquiry — the desk re-collects anything missing.
      for (const f of files) {
        try {
          const dataBase64 = await toBase64(f);
          await api.uploadDocument({
            type: "OTHER",
            fileName: f.name,
            mimeType: f.type || "application/octet-stream",
            dataBase64,
          });
        } catch {
          // ignored — recorded in the enquiry message below
        }
      }
      const res = await api.submitEnquiry({
        name: `${profile.firstName} ${profile.lastName}`.trim(),
        email: profile.email,
        phone: profile.phone || undefined,
        country: profile.country || undefined,
        programmeKey: "AT_CITIZENSHIP_DESCENDANTS",
        message: buildEnquiryMessage(
          answers,
          assessment,
          profile,
          selectedDocs,
          withResearch,
          files
        ),
      });
      setReference(res.reference);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  // ── hand-off: the case is with the desk ──────────────────────────────────
  if (reference) {
    return (
      <Frame>
        <div
          className="gold-hairline-top fade-rise relative border border-gold/40 bg-gold/[0.06] p-8"
          role="status"
          aria-live="polite"
        >
          <p className="eyebrow text-gold-ink">
            Pre-assessment: {assessmentLevelLabel(assessment.level)}
          </p>
          <h1 className="mt-3 font-editorial type-h1 text-cobble-ink">
            Your case is with the desk
          </h1>
          <p className="mt-3 type-lead measure text-iron-ink">
            Reference{" "}
            <span className="font-medium text-cobble-ink">{reference}</span>. A
            relationship manager will review your pre-assessment and the
            documents you hold, and will reach out to arrange your consultation.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              onClick={() => setView("signup")}
              className="cta focus-gold text-sm"
            >
              Create your account
            </Button>
            <Button
              variant="outline"
              onClick={() => setView("landing")}
              className="focus-gold rounded-none"
            >
              Back to the site
            </Button>
          </div>
        </div>
      </Frame>
    );
  }

  const stepIndex = STEP_INDEX[step];

  return (
    <Frame>
      <div className="grid gap-10 lg:grid-cols-[280px_1fr]">
        {/* ── The map ─────────────────────────────────────────────────── */}
        <ProcedureMap current={step} reached={stepIndex} onJump={go} />

        {/* ── The current step ────────────────────────────────────────── */}
        <div key={step} className="step-in-right">
          {step === "questionnaire" && (
            <QuestionnaireStep
              answers={answers}
              setAnswer={setAnswer}
              missing={missing}
              onNext={() => go("pre_assessment")}
            />
          )}
          {step === "pre_assessment" && (
            <PreAssessmentStep
              assessment={assessment}
              onBack={() => go("questionnaire")}
              onNext={() => go("profile")}
            />
          )}
          {step === "profile" && (
            <ProfileStep
              profile={profile}
              setProfile={setProfile}
              ready={profileReady}
              onBack={() => go("pre_assessment")}
              onNext={() => go("documents")}
            />
          )}
          {step === "documents" && (
            <DocumentsStep
              haveDocs={haveDocs}
              setHaveDocs={setHaveDocs}
              files={files}
              setFiles={setFiles}
              withResearch={withResearch}
              setWithResearch={setWithResearch}
              fileInput={fileInput}
              onFiles={onFiles}
              onBack={() => go("profile")}
              onNext={() => go("agreement_pay")}
            />
          )}
          {step === "agreement_pay" && (
            <AgreementStep
              assessment={assessment}
              profile={profile}
              selectedDocs={selectedDocs}
              withResearch={withResearch}
              fee={fee}
              busy={busy}
              error={error}
              canSubmit={profileReady}
              onBack={() => go("documents")}
              onSubmit={() => void submit()}
            />
          )}
        </div>
      </div>
    </Frame>
  );
}

// ───────────────────────────── map ─────────────────────────────

function ProcedureMap({
  current,
  reached,
  onJump,
}: {
  current: InteractiveStep;
  reached: number;
  onJump: (s: InteractiveStep) => void;
}) {
  return (
    <nav
      aria-label="Your procedure"
      className="lg:sticky lg:top-6 lg:self-start"
    >
      <p className="eyebrow eyebrow-tight text-muted-foreground">
        Your procedure
      </p>
      <ol className="mt-4 space-y-0">
        {PROCEDURE_STEPS.map((s, i) => {
          const interactive = (INTERACTIVE_STEPS as readonly string[]).includes(
            s.key
          );
          const isCurrent = s.key === current;
          const isDone = interactive && i < reached;
          const isReachable = interactive && i <= reached;
          return (
            <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
              {i < PROCEDURE_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute left-[11px] top-6 h-full w-px bg-limestone"
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "rail-node mt-0.5",
                  isDone && "rail-node--done",
                  isCurrent && "rail-node--current",
                  !isDone && !isCurrent && "rail-node--upcoming"
                )}
              >
                {isDone ? <CheckMark /> : i + 1}
              </span>
              <div className="min-w-0">
                <button
                  type="button"
                  disabled={!isReachable}
                  onClick={() =>
                    interactive && onJump(s.key as InteractiveStep)
                  }
                  className={cn(
                    "block text-left text-[13px] leading-snug transition-colors",
                    isCurrent
                      ? "font-medium text-cobble-ink"
                      : isReachable
                      ? "text-iron-ink hover:text-cobble-ink"
                      : "text-muted-foreground",
                    !isReachable && "cursor-default"
                  )}
                >
                  {s.label}
                </button>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {s.actor === "CLIENT"
                    ? "You"
                    : s.actor === "DESK"
                    ? "The desk"
                    : "You & the desk"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ───────────────────────────── steps ─────────────────────────────

function QuestionnaireStep({
  answers,
  setAnswer,
  missing,
  onNext,
}: {
  answers: QuestionnaireAnswers;
  setAnswer: (k: string, v: string | boolean) => void;
  missing: string[];
  onNext: () => void;
}) {
  const fields = questionnaireFields().filter((f) => visibleField(f, answers));
  return (
    <section>
      <StepHeading
        eyebrow="Step 1 · Eligibility questionnaire"
        title="Tell us about your ancestor"
        lead="Answer what you can. The pre-assessment runs on your answers and tells you where the case stands — it is an indicative read, not a decision."
      />
      <form
        className="mt-8 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          onNext();
        }}
        noValidate
      >
        {fields.map((f) => (
          <QuestionField
            key={f.key}
            field={f}
            answers={answers}
            setAnswer={setAnswer}
          />
        ))}

        {/* The overall document-of-proof question the pre-assessment scores on. */}
        <div className="border-l-2 border-gold bg-limestone/20 p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[#B08D3C]"
              checked={answers.documentAvailable === true}
              onChange={(e) => setAnswer("documentAvailable", e.target.checked)}
              data-testid="q-document-available"
            />
            <span>
              <span className="text-sm font-medium text-cobble-ink">
                A document of proof is available
              </span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                Do you hold any document that proves the facts above — a
                passport, certificate, manifest or similar? This is what the
                pre-assessment scores on.
              </span>
            </span>
          </label>
        </div>

        {missing.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Still needed: {missing.join(", ")}
          </p>
        )}

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={missing.length > 0}
            className="cta focus-gold flex-1 gap-2 text-sm"
          >
            Run pre-assessment
          </Button>
        </div>
      </form>
    </section>
  );
}

function QuestionField({
  field,
  answers,
  setAnswer,
}: {
  field: ReturnType<typeof questionnaireFields>[number];
  answers: QuestionnaireAnswers;
  setAnswer: (k: string, v: string | boolean) => void;
}) {
  const value = answers[field.key];
  const shown = visibleField(field, answers);
  if (!shown) return null;

  return (
    <div>
      <span className="eyebrow eyebrow-tight text-iron-ink">
        {field.label}
        {field.required && <span className="text-gold-ink"> *</span>}
      </span>

      {field.kind === "YES_NO" ? (
        <div
          className="mt-2 flex gap-2"
          role="radiogroup"
          aria-label={field.label}
          data-testid={`q-${field.key}`}
        >
          {["YES", "NO"].map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={value === v}
              onClick={() => setAnswer(field.key, v)}
              className={cn(
                "border px-4 py-2 text-[11px] uppercase tracking-[0.14em] transition-colors",
                value === v
                  ? "border-cobble bg-cobble text-[#F5F1EA]"
                  : "border-border text-iron-ink hover:border-cobble"
              )}
            >
              {v === "YES" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      ) : field.kind === "CHECKBOX" ? (
        <label className="mt-2 flex items-center gap-3">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#B08D3C]"
            checked={value === true}
            onChange={(e) => setAnswer(field.key, e.target.checked)}
          />
          <span className="text-sm text-iron-ink">{field.label}</span>
        </label>
      ) : field.kind === "SELECT" ? (
        <select
          className={cn(field, "mt-2")}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setAnswer(field.key, e.target.value)}
          required={field.required}
          data-testid={`q-${field.key}`}
        >
          <option value="">Please choose…</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o === field.options?.find((x) => x === o) &&
              field.key === "persecutionReason"
                ? persecutionReasonLabel(o)
                : o}
            </option>
          ))}
        </select>
      ) : field.kind === "TEXTAREA" ? (
        <textarea
          className={cn(field, "mt-2 min-h-[110px]")}
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setAnswer(field.key, e.target.value)}
          data-testid={`q-${field.key}`}
        />
      ) : (
        <input
          className={cn(field, "mt-2")}
          type={field.kind === "DATE" ? "date" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setAnswer(field.key, e.target.value)}
          required={field.required}
          autoComplete={field.key === "ancestorName" ? "name" : undefined}
          data-testid={`q-${field.key}`}
        />
      )}

      {field.help && (
        <span className="mt-1 block text-[11px] text-muted-foreground">
          {field.help}
        </span>
      )}
    </div>
  );
}

function PreAssessmentStep({
  assessment,
  onBack,
  onNext,
}: {
  assessment: CaseAssessment;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <section>
      <StepHeading
        eyebrow="Step 2 · Pre-assessment"
        title="Where your case stands"
        lead="An indicative read of your answers against the desk's rules. It routes your file to a person — it is not a decision, and it is not a likelihood of success."
      />
      <div
        className="mt-8 border border-border/70 bg-card p-6"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <LevelBadge level={assessment.level} />
          <div>
            <p className="font-editorial text-xl text-cobble-ink">
              {assessmentLevelLabel(assessment.level)}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-iron-ink">
              {assessmentLevelSummary(assessment.level)}
            </p>
          </div>
        </div>

        <ul className="mt-5 space-y-1.5 border-t border-border/60 pt-4 text-[13px] text-iron-ink">
          {assessment.reasons.map((r) => (
            <li key={r} className="list-disc pl-4">
              {r}
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[11px] text-muted-foreground">
          Eligibility is decided by the authority, not by this page or by us.
        </p>
      </div>

      <div className="mt-6 flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="focus-gold rounded-none"
        >
          Back
        </Button>
        <Button
          type="button"
          onClick={onNext}
          className="cta focus-gold flex-1 text-sm"
        >
          Continue
        </Button>
      </div>
    </section>
  );
}

function ProfileStep({
  profile,
  setProfile,
  ready,
  onBack,
  onNext,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  ready: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setProfile({ ...profile, [k]: e.target.value });

  return (
    <section>
      <StepHeading
        eyebrow="Step 3 · Your profile"
        title="Create your profile"
        lead="So the desk can open your file. Your passport is helpful but not mandatory at this stage."
      />
      <form
        className="mt-8 grid gap-5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onNext();
        }}
        noValidate
      >
        <ProfileInput
          label="First name"
          value={profile.firstName}
          onChange={set("firstName")}
          required
          autoComplete="given-name"
          testId="p-first-name"
        />
        <ProfileInput
          label="Last name"
          value={profile.lastName}
          onChange={set("lastName")}
          required
          autoComplete="family-name"
          testId="p-last-name"
        />
        <ProfileInput
          label="Email"
          type="email"
          value={profile.email}
          onChange={set("email")}
          required
          autoComplete="email"
          testId="p-email"
        />
        <ProfileInput
          label="Date of birth"
          type="date"
          value={profile.dateOfBirth}
          onChange={set("dateOfBirth")}
          testId="p-dob"
        />
        <ProfileInput
          label="Nationality"
          value={profile.nationality}
          onChange={set("nationality")}
          testId="p-nationality"
        />
        <ProfileInput
          label="Phone"
          type="tel"
          value={profile.phone}
          onChange={set("phone")}
          autoComplete="tel"
          testId="p-phone"
        />
        <ProfileInput
          label="Address"
          value={profile.address}
          onChange={set("address")}
          autoComplete="street-address"
          testId="p-address"
        />
        <ProfileInput
          label="City"
          value={profile.city}
          onChange={set("city")}
          autoComplete="address-level2"
          testId="p-city"
        />
        <ProfileInput
          label="Country"
          value={profile.country}
          onChange={set("country")}
          autoComplete="country-name"
          testId="p-country"
        />

        <div className="sm:col-span-2">
          <span className="eyebrow eyebrow-tight text-iron-ink">
            Your passport{" "}
            <span className="text-muted-foreground">(optional)</span>
          </span>
          <input
            type="file"
            accept="image/*,.pdf"
            className="mt-2 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-none file:border file:border-border file:bg-transparent file:px-3 file:py-2 file:text-[11px] file:uppercase file:tracking-[0.14em] file:text-iron-ink hover:file:border-cobble"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Not mandatory now — you can upload it later from your portal.
          </span>
        </div>

        <div className="flex gap-3 sm:col-span-2">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="focus-gold rounded-none"
          >
            Back
          </Button>
          <Button
            type="submit"
            disabled={!ready}
            className="cta focus-gold flex-1 text-sm"
          >
            Continue
          </Button>
        </div>
      </form>
    </section>
  );
}

function ProfileInput({
  label,
  value,
  onChange,
  type = "text",
  required,
  autoComplete,
  testId,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow eyebrow-tight text-iron-ink">
        {label} {required && <span className="text-gold-ink">*</span>}
      </span>
      <input
        className={cn(field, "mt-2")}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        autoComplete={autoComplete}
        data-testid={testId}
      />
    </label>
  );
}

function DocumentsStep({
  haveDocs,
  setHaveDocs,
  files,
  setFiles,
  withResearch,
  setWithResearch,
  fileInput,
  onFiles,
  onBack,
  onNext,
}: {
  haveDocs: Record<string, boolean>;
  setHaveDocs: (d: Record<string, boolean>) => void;
  files: File[];
  setFiles: (f: File[]) => void;
  withResearch: boolean;
  setWithResearch: (b: boolean) => void;
  fileInput: React.RefObject<HTMLInputElement | null>;
  onFiles: (l: FileList | null) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <section>
      <StepHeading
        eyebrow="Step 4 · Case documents"
        title="What can you provide?"
        lead="Tell us which of these you hold. If you have none yet, archive research can establish the facts for you."
      />

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {CASE_ASSESSMENT_DOCUMENTS.map((d) => (
          <label
            key={d.key}
            className={cn(
              "flex cursor-pointer items-start gap-3 border p-4 transition-colors",
              haveDocs[d.key]
                ? "border-gold/60 bg-gold/[0.05]"
                : "border-border/70 bg-card hover:border-cobble"
            )}
          >
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[#B08D3C]"
              checked={haveDocs[d.key] === true}
              onChange={(e) =>
                setHaveDocs({ ...haveDocs, [d.key]: e.target.checked })
              }
            />
            <span>
              <span className="block text-sm font-medium text-cobble-ink">
                {d.label}
              </span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                {d.purpose}
              </span>
            </span>
          </label>
        ))}
      </div>

      {/* Archive research upsell — offered when the client holds few documents. */}
      <div className="mt-6 border-l-2 border-gold bg-limestone/20 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#B08D3C]"
            checked={withResearch}
            onChange={(e) => setWithResearch(e.target.checked)}
          />
          <span>
            <span className="text-sm font-medium text-cobble-ink">
              Add archive research — €{FEE_SCHEDULE.assessmentWithResearch}
            </span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              If you hold no documents, or only some, our researchers establish
              the facts in the Austrian and successor-state archives. Includes
              up to 3 hours of research.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-6">
        <span className="eyebrow eyebrow-tight text-iron-foreground">
          Attach files <span className="text-muted-foreground">(optional)</span>
        </span>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="mt-2 w-full border border-dashed border-border px-4 py-6 text-[13px] text-muted-foreground transition-colors hover:border-cobble hover:text-iron-ink"
        >
          Choose files to attach…
        </button>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1 text-[12px] text-iron-ink">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-danger-ink"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="focus-gold rounded-none"
        >
          Back
        </Button>
        <Button
          type="button"
          onClick={onNext}
          className="cta focus-gold flex-1 text-sm"
        >
          Continue
        </Button>
      </div>
    </section>
  );
}

function AgreementStep({
  assessment,
  profile,
  selectedDocs,
  withResearch,
  fee,
  busy,
  error,
  canSubmit,
  onBack,
  onSubmit,
}: {
  assessment: CaseAssessment;
  profile: Profile;
  selectedDocs: typeof CASE_ASSESSMENT_DOCUMENTS;
  withResearch: boolean;
  fee: number;
  busy: boolean;
  error: string | null;
  canSubmit: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <section>
      <StepHeading
        eyebrow="Step 5 · Your enquiry"
        title="Submit your enquiry"
        lead="Review your pre-assessment and submit your enquiry to the desk. Your relationship manager then takes the case forward."
      />

      <div className="mt-8 border border-border/70 bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-editorial text-lg text-cobble-ink">
              {withResearch
                ? "Case assessment + archive research"
                : "Case assessment"}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {withResearch
                ? "Assessment plus up to 3 hours of archive research."
                : "Assessment of your eligibility and the documents you hold."}
            </p>
          </div>
          <p className="font-editorial text-2xl text-cobble-ink">€{fee}</p>
        </div>

        <dl className="mt-5 space-y-1.5 border-t border-border/60 pt-4 text-[13px] text-iron-ink">
          <div className="flex justify-between">
            <dt>Pre-assessment</dt>
            <dd>{assessmentLevelLabel(assessment.level)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Documents you hold</dt>
            <dd>
              {selectedDocs.length === 0
                ? "None yet"
                : `${selectedDocs.length} indicated`}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Applicant</dt>
            <dd>{`${profile.firstName} ${profile.lastName}`.trim()}</dd>
          </div>
        </dl>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
        By continuing you agree to the processing of your enquiry. No payment is
        taken at this stage — the desk will contact you to discuss next steps
        and any fees.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 border-l-2 border-[#8C2F2F] bg-[#8C2F2F]/[0.05] px-3 py-2 text-sm text-danger-ink"
        >
          {error}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="focus-gold rounded-none"
        >
          Back
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={busy || !canSubmit}
          className="cta focus-gold flex-1 gap-2 text-sm"
          data-testid="procedure-submit"
        >
          {busy && (
            <Spinner className="border-[#F5F1EA] border-t-transparent" />
          )}
          {busy ? "Submitting…" : "Submit enquiry"}
        </Button>
      </div>
      {!canSubmit && (
        <p className="mt-2 text-xs text-muted-foreground">
          Add your first name, last name and a valid email to continue.
        </p>
      )}
    </section>
  );
}

// ───────────────────────────── presentational ─────────────────────────────

function StepHeading({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead: string;
}) {
  return (
    <div>
      <p className="eyebrow text-gold-ink">{eyebrow}</p>
      <h1 className="mt-3 font-editorial type-h1 text-cobble-ink">{title}</h1>
      <p className="mt-2 type-lead measure text-iron-ink">{lead}</p>
    </div>
  );
}

const LEVEL_STYLES: Record<AssessmentLevel, string> = {
  VERY_HIGH: "border-emerald-700/40 bg-emerald-700/10 text-emerald-800",
  HIGH: "border-gold/50 bg-gold/10 text-cobble-ink",
  MEDIUM: "border-amber-600/40 bg-amber-600/10 text-amber-800",
  VERY_LOW: "border-border bg-muted text-muted-foreground",
};

function LevelBadge({ level }: { level: AssessmentLevel }) {
  return (
    <span
      className={cn(
        "shrink-0 border px-3 py-1 text-[10px] uppercase tracking-[0.16em]",
        LEVEL_STYLES[level]
      )}
      data-testid="assessment-level"
    >
      {assessmentLevelLabel(level)}
    </span>
  );
}

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

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="force-light min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <Eyebrow>
          Austria · Citizenship for descendants of Holocaust victims
        </Eyebrow>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

// ───────────────────────────── helpers ─────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function yesNo(v: unknown): boolean | null {
  if (v === "YES") return true;
  if (v === "NO") return false;
  return null;
}

/** True when the client has answered the overall document-of-proof question. */
function proofAnswered(answers: QuestionnaireAnswers): boolean {
  return answers.documentAvailable === true;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Assemble the desk-readable enquiry body from everything the client gave. */
function buildEnquiryMessage(
  answers: QuestionnaireAnswers,
  assessment: CaseAssessment,
  profile: Profile,
  selectedDocs: typeof CASE_ASSESSMENT_DOCUMENTS,
  withResearch: boolean,
  files: File[]
): string {
  const lines: string[] = [
    "Austria — Citizenship for descendants of Holocaust victims",
    `Pre-assessment: ${assessmentLevelLabel(assessment.level)}`,
    "",
    "Applicant:",
    `  Name: ${profile.firstName} ${profile.lastName}`,
    `  Email: ${profile.email}`,
    profile.phone && `  Phone: ${profile.phone}`,
    profile.dateOfBirth && `  Date of birth: ${profile.dateOfBirth}`,
    profile.nationality && `  Nationality: ${profile.nationality}`,
    profile.address &&
      `  Address: ${profile.address}, ${profile.city} ${profile.country}`.trim(),
    "",
    "Questionnaire:",
  ];
  for (const f of questionnaireFields()) {
    if (!visibleField(f, answers)) continue;
    const v = answers[f.key];
    if (v === undefined || v === null || v === "") continue;
    const value =
      typeof v === "boolean"
        ? v
          ? "Yes"
          : "No"
        : f.key === "persecutionReason"
        ? persecutionReasonLabel(v as string)
        : String(v);
    lines.push(`  ${f.label}: ${value}`);
  }
  lines.push(
    `  Document of proof available: ${
      answers.documentAvailable === true ? "Yes" : "No"
    }`
  );
  lines.push("");
  lines.push("Documents indicated:");
  if (selectedDocs.length === 0) lines.push("  None yet");
  for (const d of selectedDocs) lines.push(`  - ${d.label}`);
  lines.push(`  Archive research: ${withResearch ? "Yes" : "No"}`);
  if (files.length > 0) {
    lines.push("  Attached files:");
    for (const f of files) lines.push(`    - ${f.name}`);
  }
  const full = lines.join("\n");
  if (full.length <= 4000) return full;
  // Truncate at a line boundary to avoid cutting mid-line.
  const truncated = full.slice(0, 4000);
  const lastNewline = truncated.lastIndexOf("\n");
  return lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
}
