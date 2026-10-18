"use client";
/**
 * Client portal — onboarding wizard (5 steps) + case dashboard.
 *
 * Visual Language v2: cobble/gold editorial, mobile-first, calm and discreet.
 * Data access exclusively through the typed api client (src/lib/api-client.ts).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useCaseChat } from "@/hooks/use-case-chat";
import { useI18n, type StringKey } from "@/lib/i18n";
import { prepareUpload } from "@/lib/upload-image";
import {
  acceptAttribute,
  clampUploadMb,
  extensionRegex,
  fileAccepted,
} from "@/lib/upload/accept";
import type { DocumentStatus } from "@/features/client/completeness-map";
import {
  api,
  ApiError,
  type CaseView,
  type DocumentRow,
  type ExtractedField,
  type Programme,
  type RequestRow,
  type SessionUser,
} from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { readGuidedDraft } from "@/lib/guided-draft";
import { PassportSeal, SloganRing } from "@/components/brand/devices";
import {
  SectionTitle,
  Eyebrow,
  StatusBadge,
  StateBadge,
  EmptyState,
  ExtractionQuality,
  ProvisionalChip,
  Spinner,
} from "@/components/brand/ui";
import { ProgressStepper, stageInfoFor } from "./progress-stepper";
import { UploadDropzone } from "./upload-dropzone";
import { CallLauncher } from "@/features/calls/call-launcher";
import { EvidenceReadiness } from "@/features/cases/evidence-readiness";
import { AskMyCase } from "./ask-my-case";
import { JourneyBar } from "./journey-bar";
import { RoleTiles } from "@/features/rm/role-tiles";
import { NextOneThingCard } from "./next-one-thing";
import { RfiThreadPanel } from "@/features/rfi/RfiThread";
import { CompletenessMap } from "./completeness-map";
import { computeCaseProgress } from "@/lib/domain/case-progress";
import {
  caseStatusLabel,
  docStatusLabel,
  DOC_TYPE_LABELS,
} from "@/lib/domain/states";
import { programmeByKey } from "@/lib/domain/programmes";
import { usePlatformSettings } from "@/lib/settings/client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Award,
  ArrowLeft,
  Ban,
  BookUser,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  Compass,
  CreditCard,
  Download,
  FileSearch,
  FileText,
  Inbox,
  Landmark,
  MessageSquare,
  Pencil,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Send,
  ShieldCheck,
  Truck,
  Upload,
  UserRound,
  BellRing,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const CONFIRMED_DOC_STATES = new Set([
  "CLIENT_CONFIRMED",
  "IN_REVIEW",
  "RM_APPROVED",
]);

const FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  documentNumber: "Document number",
  nationality: "Nationality",
  dateOfBirth: "Date of birth",
  dateOfExpiry: "Date of expiry",
  issuingCountry: "Issuing country",
};

const ROLE_LABELS: Record<string, string> = {
  CLIENT: "Client",
  RM: "Relationship Manager",
  SENIOR_RM: "Senior RM",
  ADMIN: "Administrator",
  AUDITOR: "Auditor",
};

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadHint(exts: string[], maxMb: number): string {
  const clean = exts
    .map((e) => e.toUpperCase().replace(/^\./, ""))
    .filter(Boolean);
  return `${clean.length > 0 ? `${clean.join(", ")} · ` : ""}up to ${maxMb} MB`;
}

function DocIcon({ type, className }: { type: string; className?: string }) {
  const cls = cn("h-4 w-4", className);
  switch (type) {
    case "PASSPORT":
      return <BookUser className={cls} aria-hidden="true" />;
    case "NATIONAL_ID":
      return <CreditCard className={cls} aria-hidden="true" />;
    case "POLICE_RECORD":
      return <ShieldCheck className={cls} aria-hidden="true" />;
    case "CERTIFICATE_OF_REGISTRATION":
      return <ScrollText className={cls} aria-hidden="true" />;
    case "BANK_STATEMENT":
      return <Landmark className={cls} aria-hidden="true" />;
    default:
      return <FileText className={cls} aria-hidden="true" />;
  }
}

/** Editorial card — white, rounded-none, thin border, generous padding. */
function Panel({
  children,
  className,
  id,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <section
      id={id}
      aria-label={ariaLabel}
      className={cn(
        "rounded-none border border-border bg-card p-5 md:p-6",
        className
      )}
    >
      {children}
    </section>
  );
}

function PageWrap({ children }: { children: ReactNode }) {
  // max-w-3xl, matching Settings — the portal sat on 2xl while every other app
  // surface uses 3xl, so the client's own dashboard was the one screen that read
  // as cramped on desktop and left ~250px of dead space on each side.
  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-6 py-8 space-y-6">
      {children}
    </div>
  );
}

/** Muted, icon-led empty state for tabbed lists (clx.empty* strings). */
function EmptyBlock({
  icon,
  text,
  action,
}: {
  icon: ReactNode;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-none border border-dashed border-border bg-card/50 px-6 py-10 text-center transition-colors hover:border-gold/30 hover:bg-card/80">
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors"
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * G17 — one shared help affordance for the portal's empty states. Dispatches
 * the shell's `cl:open-help` event; AppShell owns the single HelpDialog that
 * listens for it and is mounted above every portal view.
 */
function EmptyStateHelp() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("cl:open-help"))}
      className="text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-gold-ink hover:decoration-gold/60"
    >
      {t("clx.needHelp")}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT 1 — ClientOnboarding
// ─────────────────────────────────────────────────────────────────────────────

type OnbStep = 1 | 2 | 3 | 4 | 5;
// Canon fallback (matches DEFAULT_PLATFORM_SETTINGS.labels.onboardingSteps):
// four wizard steps — step 5 is the Welcome completion screen, not a form step.
const STEP_LABELS = ["Profile", "Passport", "Verify", "Programme"] as const;

export function ClientOnboarding() {
  const { t } = useI18n();
  const session = useApp((s) => s.session);
  const setView = useApp((s) => s.setView);
  const [booted, setBooted] = useState(false);
  const [step, setStep] = useState<OnbStep>(1);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [caseRef, setCaseRef] = useState<string | null>(null);
  const [passportDocId, setPassportDocId] = useState<string | null>(null);
  const [programmeName, setProgrammeName] = useState<string | null>(null);

  // Resume the wizard from the persisted case state.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { case: c } = await api.myCase();
        if (!alive) return;
        if (!c) {
          setStep(1);
          return;
        }
        setCaseId(c.id);
        setCaseRef(c.reference);
        const passport = c.documents.find((d) => d.type === "PASSPORT");
        if (passport) setPassportDocId(passport.id);
        // Profile correction loop — the RM requested changes (ONBOARDING with
        // dataApproval PENDING): land on step 1 so the client can re-submit.
        if (c.status === "ONBOARDING" && c.dataApproval === "PENDING") {
          setStep(1);
          return;
        }
        if (!passport) {
          setStep(2);
        } else if (!CONFIRMED_DOC_STATES.has(passport.status)) {
          setStep(3);
        } else if (!c.programme || c.serviceApproval === "REJECTED") {
          // No programme chosen yet, or the RM rejected the previous choice —
          // step 4 lets the client pick again.
          if (c.programme) setProgrammeName(c.programme.name);
          setStep(4);
        } else {
          setProgrammeName(c.programme.name);
          setStep(5);
        }
      } catch (err) {
        toast({
          title: t("clx.errLoadApplication"),
          description: errMessage(err, t("common.tryAgain")),
          variant: "destructive",
        });
      } finally {
        if (alive) setBooted(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleServiceSelected = useCallback((name: string) => {
    setProgrammeName(name);
    setStep(5);
  }, []);

  if (!booted) {
    return (
      <PageWrap>
        <OnboardingSkeleton />
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      <WizardHeader step={step} caseRef={caseRef} />

      {step === 1 && (
        <ProfileStep
          session={session}
          onCreated={(id, reference) => {
            setCaseId(id);
            setCaseRef(reference);
            // A passport already exists (correction loop) — passport and review
            // are done, so go straight to the programme step (which shows
            // "Verification in progress" while the case is in DATA_SUBMITTED).
            setStep(passportDocId ? 4 : 2);
          }}
        />
      )}
      {step === 2 && (
        <PassportStep
          existingDocId={passportDocId}
          onReview={(docId) => {
            setPassportDocId(docId);
            setStep(3);
          }}
        />
      )}
      {step === 3 && passportDocId && (
        <ReviewStep
          docId={passportDocId}
          onConfirmed={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && caseId && (
        <ServiceStep caseId={caseId} onSelected={handleServiceSelected} />
      )}
      {step === 5 && (
        <WelcomeStep
          caseRef={caseRef}
          programmeName={programmeName}
          onDashboard={() => setView("client-dashboard")}
        />
      )}
    </PageWrap>
  );
}

function OnboardingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-1.5 w-full" />
      </div>
      <Skeleton className="h-72 w-full rounded-none" />
    </div>
  );
}

function WizardHeader({
  step,
  caseRef,
}: {
  step: OnbStep;
  caseRef: string | null;
}) {
  const { t } = useI18n();
  const { settings } = usePlatformSettings();
  // Admin-editable step names (canon underneath); STEP_LABELS stays the fallback.
  const STEP_LABELS_RESOLVED: readonly string[] = settings.labels
    .onboardingSteps.length
    ? settings.labels.onboardingSteps
    : STEP_LABELS;
  const current = Math.min(step, STEP_LABELS_RESOLVED.length);
  return (
    <header className="space-y-4">
      <Eyebrow>{t("clx.onboardingTitle")}</Eyebrow>
      <div className="flex items-end justify-between gap-4">
        <h1 className="font-editorial text-2xl md:text-3xl text-cobble-ink">
          {t("clx.onboardingSubtitle")}
        </h1>
        {caseRef && (
          <span
            className="shrink-0 rounded-full border border-limestone px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-iron-ink"
            aria-label={t("clx.caseRefLabel", { ref: caseRef })}
          >
            {caseRef}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Progress
          value={(current / STEP_LABELS_RESOLVED.length) * 100}
          className="h-1 flex-1"
          aria-label={`Onboarding progress: step ${current} of ${STEP_LABELS_RESOLVED.length}`}
        />
        <span className="whitespace-nowrap text-[11px] uppercase tracking-[0.18em] text-muted-foreground tabular-nums">
          {t("clx.stepOfTotal", {
            n: current,
            total: STEP_LABELS_RESOLVED.length,
          })}
        </span>
      </div>
      <ol
        className="grid grid-cols-4 gap-2"
        aria-label={t("clx.onboardingStepsLabel")}
      >
        {STEP_LABELS_RESOLVED.map((label, i) => {
          const n = i + 1;
          const done = step > n;
          const active = step === n;
          return (
            <li
              key={label}
              className="flex flex-col items-center gap-1.5 text-center"
            >
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold",
                  done && "border-gold bg-gold text-cobble-ink",
                  active && "border-cobble bg-cobble text-[#F5F1EA]",
                  !done && !active && "border-border text-muted-foreground"
                )}
              >
                {done ? <Check className="h-3 w-3" aria-hidden="true" /> : n}
              </span>
              <span
                className={cn(
                  "text-[10px] uppercase tracking-[0.14em]",
                  active
                    ? "text-cobble-ink font-semibold"
                    : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </header>
  );
}

// ── Step 1 · Profile ──

type ProfileForm = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  phone: string;
  address: string;
  city: string;
  country: string;
};

const PROFILE_FIELDS: Array<{
  key: keyof ProfileForm;
  labelKey: StringKey;
  required: boolean;
  type?: "text" | "date";
  autoComplete?: string;
  placeholder?: string;
  wide?: boolean;
}> = [
  {
    key: "firstName",
    labelKey: "onboarding.firstName",
    required: true,
    autoComplete: "given-name",
  },
  {
    key: "lastName",
    labelKey: "onboarding.lastName",
    required: true,
    autoComplete: "family-name",
  },
  {
    key: "dateOfBirth",
    labelKey: "onboarding.dateOfBirth",
    required: true,
    type: "date",
  },
  {
    key: "nationality",
    labelKey: "onboarding.nationality",
    required: true,
    placeholder: "e.g. Swiss",
    autoComplete: "country-name",
  },
  {
    key: "phone",
    labelKey: "onboarding.phone",
    required: false,
    placeholder: "+41 …",
    autoComplete: "tel",
  },
  {
    key: "address",
    labelKey: "onboarding.address",
    required: true,
    autoComplete: "street-address",
    wide: true,
  },
  {
    key: "city",
    labelKey: "onboarding.city",
    required: true,
    autoComplete: "address-level2",
  },
  {
    key: "country",
    labelKey: "onboarding.country",
    required: true,
    autoComplete: "country-name",
  },
];

function ProfileStep({
  session,
  onCreated,
}: {
  session: SessionUser | null;
  onCreated: (caseId: string, reference: string) => void;
}) {
  const { t } = useI18n();
  // Prefill from the public guided intake where the visitor answered these
  // before signing up — the same question is never asked twice. Session data
  // (authoritative, server-issued) wins over the client-writable draft.
  const [form, setForm] = useState<ProfileForm>(() => {
    const draft = readGuidedDraft()?.answers ?? {};
    const [first = "", ...rest] = String(draft.fullName ?? "")
      .trim()
      .split(/\s+/);
    return {
      firstName: session?.firstName ?? first,
      lastName: session?.lastName ?? rest.join(" "),
      dateOfBirth: session?.dateOfBirth ?? String(draft.dateOfBirth ?? ""),
      nationality: session?.nationality ?? String(draft.nationality ?? ""),
      phone: session?.phone ?? String(draft.phone ?? ""),
      address: session?.address ?? "",
      city: session?.city ?? "",
      country: session?.country ?? String(draft.residenceCountry ?? ""),
    };
  });
  const [errors, setErrors] = useState<
    Partial<Record<keyof ProfileForm, string>>
  >({});
  const [submitting, setSubmitting] = useState(false);

  function set(key: keyof ProfileForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Partial<Record<keyof ProfileForm, string>> = {};
    for (const f of PROFILE_FIELDS) {
      if (f.required && !form[f.key].trim())
        next[f.key] = "This field is required";
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      toast({
        title: t("clx.errFieldsMissing"),
        description: t("clx.errFieldsMissingHint"),
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.submitProfile({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        nationality: form.nationality.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        country: form.country.trim(),
      });
      toast({
        title: t("clx.caseCreated", { ref: res.case.reference }),
        description: t("clx.nextUploadPassport"),
      });
      onCreated(res.case.id, res.case.reference);
    } catch (err) {
      toast({
        title: t("clx.errCreateCase"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel>
      <form
        onSubmit={submit}
        noValidate
        className="space-y-5"
        aria-label={t("clx.profileFormLabel")}
      >
        <div className="space-y-1.5">
          <Eyebrow>
            {t("clx.stepN", { n: 1, name: t("clx.stepNameProfile") })}
          </Eyebrow>
          <h2 className="font-editorial text-xl text-cobble-ink">
            {t("clx.stepProfileHint")}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("clx.profileIntro")}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PROFILE_FIELDS.map((f) => {
            const legalBasisKeyMap: Record<string, StringKey> = {
              firstName: "legal.basis.name",
              lastName: "legal.basis.name",
              dateOfBirth: "legal.basis.dateOfBirth",
              nationality: "legal.basis.nationality",
              phone: "legal.basis.phone",
              address: "legal.basis.address",
              city: "legal.basis.city",
              country: "legal.basis.country",
            };
            const legalBasisKey = legalBasisKeyMap[f.key];
            return (
              <div
                key={f.key}
                className={cn("space-y-1.5", f.wide && "sm:col-span-2")}
              >
                <Label htmlFor={`pf-${f.key}`}>
                  {t(f.labelKey)}
                  {!f.required && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      (optional)
                    </span>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-1.5 inline-block cursor-help text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2">
                        ⓘ
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-56 text-xs">{t(legalBasisKey)}</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <Input
                  id={`pf-${f.key}`}
                  type={f.type ?? "text"}
                  value={form[f.key]}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    set(f.key, e.target.value)
                  }
                  autoComplete={f.autoComplete}
                  placeholder={f.placeholder}
                  aria-invalid={errors[f.key] ? true : undefined}
                  aria-describedby={
                    errors[f.key] ? `pf-${f.key}-err` : undefined
                  }
                  className={cn(
                    "transition-all duration-200 hover:border-gold/40 focus-visible:border-gold/60",
                    errors[f.key] && "border-coral focus-visible:ring-coral"
                  )}
                />
                {errors[f.key] && (
                  <p id={`pf-${f.key}-err`} className="text-xs text-danger-ink">
                    {errors[f.key]}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <Button
          type="submit"
          disabled={submitting}
          className="w-full sm:w-auto transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
        >
          {submitting && <Spinner className="h-4 w-4" />}{" "}
          {t("clx.continueToPassport")}
        </Button>
      </form>
    </Panel>
  );
}

// ── Step 2 · Passport upload ──

function PassportStep({
  existingDocId,
  onReview,
}: {
  existingDocId: string | null;
  onReview: (docId: string) => void;
}) {
  const { t } = useI18n();
  const { settings } = usePlatformSettings();
  const [phase, setPhase] = useState<"idle" | "uploading" | "reading">("idle");
  const [fileMeta, setFileMeta] = useState<{
    name: string;
    size: number;
  } | null>(null);
  const [existing, setExisting] = useState<{
    id: string;
    status: string;
    fileName: string;
    sizeBytes: number;
  } | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Cap + accept list shown in the hints come from the admin-editable settings (canon underneath).
  const maxMb = clampUploadMb(settings.operations.maxUploadMb);
  const maxBytes = maxMb * 1024 * 1024;
  const extRe = extensionRegex(settings.operations.acceptedExtensions);
  const accept = acceptAttribute(settings.operations.acceptedExtensions);

  useEffect(() => {
    if (!existingDocId) return;
    let alive = true;
    api
      .document(existingDocId)
      .then(({ document }) => {
        if (alive) {
          setExisting({
            id: document.id,
            status: document.status,
            fileName: document.fileName,
            sizeBytes: document.sizeBytes,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [existingDocId]);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    if (!fileAccepted(file, extRe)) {
      toast({
        title: t("clx.errUnsupportedFile"),
        description: t("clx.chooseOneOf", {
          list: settings.operations.acceptedExtensions
            .map((e) => e.toUpperCase())
            .join(", "),
        }),
        variant: "destructive",
      });
      return;
    }
    if (file.size > maxBytes) {
      toast({
        title: t("clx.errFileTooLarge"),
        description: t("clx.maxFileSize", { mb: maxMb }),
        variant: "destructive",
      });
      return;
    }
    setFileMeta({ name: file.name, size: file.size });
    setPhase("uploading");
    try {
      const prepared = await prepareUpload(file);
      const res = await api.uploadDocument({
        type: "PASSPORT",
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        dataBase64: prepared.dataBase64,
      });
      setPhase("reading");
      // OCR completed server-side during the request — brief beat for the transition only.
      await new Promise((resolve) => setTimeout(resolve, 150));
      onReview(res.document.id);
    } catch (err) {
      setPhase("idle");
      toast({
        title: t("clx.errUploadFailed"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    }
  }

  return (
    <Panel className="space-y-5">
      <div className="space-y-1.5">
        <Eyebrow>
          {t("clx.stepN", { n: 2, name: t("clx.stepNameIdentity") })}
        </Eyebrow>
        <h2 className="font-editorial text-xl text-cobble-ink">
          {t("clx.stepPassportHint")}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("clx.passportIntro")}
        </p>
      </div>

      {existing && (
        <div className="flex items-center justify-between gap-3 rounded border border-border bg-muted/40 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-limestone bg-card text-iron-ink"
              aria-hidden="true"
            >
              <BookUser className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-cobble-ink">
                {existing.fileName}
              </p>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                {formatBytes(existing.sizeBytes)}{" "}
                <StateBadge
                  state={existing.status}
                  label={
                    settings.labels.docStatuses[existing.status] ??
                    docStatusLabel(existing.status)
                  }
                />
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => onReview(existing.id)}
            className="transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-95"
          >
            {t("common.continue")}
          </Button>
        </div>
      )}

      {phase !== "idle" ? (
        <div
          className="flex items-center gap-3 rounded border border-gold/40 bg-gold/5 p-5"
          role="status"
        >
          <Spinner className="h-5 w-5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-cobble-ink">
              {phase === "uploading"
                ? t("clx.uploadingEncrypted")
                : t("clx.readingPassport")}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {phase === "uploading"
                ? `${fileMeta?.name ?? ""} · ${formatBytes(
                    fileMeta?.size ?? 0
                  )}`
                : t("clx.aiExtractsHint")}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            ref={pickRef}
            type="file"
            accept={accept}
            className="sr-only"
            aria-label={t("clx.choosePhotoLabel")}
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label={t("clx.takePhotoLabel")}
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => pickRef.current?.click()}
            className="group flex w-full flex-col items-center gap-2 rounded-none border border-dashed border-limestone bg-muted/30 px-4 py-10 transition-all duration-200 hover:bg-muted/60 hover:border-gold/40 hover:shadow-sm active:scale-[0.99]"
          >
            <Upload
              className="h-5 w-5 text-gold-ink transition-transform group-hover:scale-110"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-cobble-ink">
              Choose a file
            </span>
            <span className="text-xs text-muted-foreground">
              {uploadHint(settings.operations.acceptedExtensions, maxMb)}
            </span>
          </button>
          <Button
            type="button"
            variant="outline"
            className="w-full transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-[0.99]"
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="h-4 w-4" aria-hidden="true" /> Take a photo
          </Button>
        </div>
      )}
    </Panel>
  );
}

// ── Step 3 · Review OCR data ──

function ReviewStep({
  docId,
  onConfirmed,
  onBack,
}: {
  docId: string;
  onConfirmed: () => void;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const { settings } = usePlatformSettings();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadDoc = useCallback(async () => {
    setLoading(true);
    try {
      const { document } = await api.document(docId);
      setDoc(document);
      setValues(
        Object.fromEntries(
          document.fields.map((f) => [f.fieldKey, f.value ?? ""])
        )
      );
    } catch (err) {
      toast({
        title: t("clx.errLoadExtracted"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    void loadDoc();
  }, [loadDoc]);

  const changedKeys = doc
    ? doc.fields
        .filter((f) => (values[f.fieldKey] ?? "") !== (f.value ?? ""))
        .map((f) => f.fieldKey)
    : [];
  const sandboxOcr =
    doc?.ocrJobs?.some((j) => j.provider.includes("sandbox")) ?? false;

  async function confirm() {
    if (!doc) return;
    setSaving(true);
    try {
      const edits = doc.fields
        .filter((f) => (values[f.fieldKey] ?? "") !== (f.value ?? ""))
        .map((f) => ({
          fieldKey: f.fieldKey,
          value: values[f.fieldKey] ?? "",
        }));
      if (edits.length > 0) await api.correctFields(doc.id, edits);
      await api.confirmDocument(doc.id);
      toast({
        title: t("clx.passportConfirmed"),
        description: t("clx.passportConfirmedHint"),
      });
      onConfirmed();
    } catch (err) {
      toast({
        title: t("clx.errConfirm"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel className="space-y-5">
      <div className="space-y-2">
        <Eyebrow>
          {t("clx.stepN", { n: 3, name: t("clx.stepNameVerify") })}
        </Eyebrow>
        <h2 className="font-editorial text-xl text-cobble-ink">
          {t("clx.stepVerifyHint")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <ProvisionalChip />
          <p className="text-sm text-iron-ink">{t("clx.aiVerifyFields")}</p>
        </div>
        {doc && (
          <p className="text-xs text-muted-foreground">
            {doc.fileName} · {formatBytes(doc.sizeBytes)} · uploaded{" "}
            {format(new Date(doc.createdAt), "d MMM yyyy")} ·{" "}
            <StateBadge
              state={doc.status}
              label={
                settings.labels.docStatuses[doc.status] ??
                docStatusLabel(doc.status)
              }
            />
          </p>
        )}
      </div>

      {sandboxOcr && (
        <div className="rounded border border-amber-brand/40 bg-amber-brand/5 p-4">
          <p className="text-sm text-iron-ink leading-relaxed">
            {t("clx.placeholderExtraction")}
          </p>
        </div>
      )}

      {loading ? (
        <div className="space-y-4 py-4" aria-busy="true">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      ) : !doc || doc.fields.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            title={t("clx.emptyExtractionTitle")}
            hint={t("clx.emptyExtractionHint")}
            action={<EmptyStateHelp />}
          />
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadDoc()}
              className="transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-95"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />{" "}
              {t("auth.errorRetry")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {doc.fields.map((f: ExtractedField) => {
              const edited = f.edited || f.source === "CLIENT_EDIT";
              return (
                <div key={f.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor={`fld-${f.id}`}
                      className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {settings.labels.ocrFieldLabels[f.fieldKey] ??
                        FIELD_LABELS[f.fieldKey] ??
                        f.fieldKey}
                    </Label>
                    <StatusBadge
                      status={edited ? "Client edit" : "OCR"}
                      tone={edited ? "green" : "sky"}
                    />
                  </div>
                  <Input
                    id={`fld-${f.id}`}
                    value={values[f.fieldKey] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.fieldKey]: e.target.value }))
                    }
                    className="transition-all duration-200 hover:border-gold/40 focus-visible:border-gold/60"
                  />
                  {/* Numeric confidence is a staff signal; an applicant confirming
                      their passport should see the outcome, not a grade. Matches the
                      dashboard's rule (see ExtractionQuality in brand/ui). */}
                  {f.confidence < 0.55 && (
                    <ExtractionQuality value={f.confidence} />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-gold/30 pt-4 sm:flex-row">
            <p className="text-xs text-muted-foreground">
              {changedKeys.length > 0
                ? `${changedKeys.length} field${
                    changedKeys.length === 1 ? "" : "s"
                  } corrected`
                : "No corrections yet"}
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {onBack && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onBack}
                  className="min-h-11 w-full sm:w-auto transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-[0.99]"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back
                  to passport
                </Button>
              )}
              <Button
                onClick={() => void confirm()}
                disabled={saving}
                className="min-h-11 w-full sm:w-auto transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
              >
                {saving ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}{" "}
                Confirm &amp; continue
              </Button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Step 4 · Choose service ──

function ServiceStep({
  caseId,
  onSelected,
}: {
  caseId: string;
  onSelected: (programmeName: string) => void;
}) {
  const { t } = useI18n();
  const [programmes, setProgrammes] = useState<Programme[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [caseStatus, setCaseStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  // The route the client chose in the public guided intake, if any. Shown as a
  // recommendation they can override — never applied silently, because the
  // binding choice is the one they confirm here.
  const [suggestedKey] = useState<string | null>(
    () => readGuidedDraft()?.programmeKey ?? null
  );
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  // The RM rejected the previous choice — show the notice and keep the picker
  // open instead of auto-advancing to the welcome step.
  const [serviceRejected, setServiceRejected] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [{ case: c }, { programmes: ps }] = await Promise.all([
        api.myCase(),
        api.programmes(),
      ]);
      const rejected = c?.serviceApproval === "REJECTED";
      if (c?.programme && !rejected) {
        onSelected(c.programme.name);
        return;
      }
      setServiceRejected(rejected);
      setCaseStatus(c?.status ?? null);
      setProgrammes(ps);
      // Land the client on the route they already chose, when it exists here.
      const draftKey = readGuidedDraft()?.programmeKey;
      if (draftKey) {
        const match = ps.find((p) => p.key === draftKey);
        if (match) setSelected((cur) => cur || match.id);
      }
    } catch (err) {
      setLoadError(errMessage(err, "Could not load programmes."));
    }
  }, [onSelected]);

  useEffect(() => {
    void load();
  }, [load]);

  async function recheck() {
    setChecking(true);
    try {
      const { case: c } = await api.myCase();
      const rejected = c?.serviceApproval === "REJECTED";
      if (c?.programme && !rejected) {
        onSelected(c.programme.name);
        return;
      }
      setServiceRejected(rejected);
      if (c && c.status !== "DATA_SUBMITTED") {
        setCaseStatus(c.status);
        toast({
          title: t("clx.detailsApproved"),
          description: t("clx.detailsApprovedHint"),
        });
      } else {
        toast({
          title: t("clx.stillUnderReview"),
          description: t("clx.stillUnderReviewHint"),
        });
      }
    } catch (err) {
      toast({
        title: t("clx.errCheckStatus"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  }

  const chosen = programmes?.find((p) => p.id === selected) ?? null;

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    try {
      await api.selectService(caseId, selected, true);
      const name = chosen?.name ?? "Your chosen programme";
      toast({ title: t("clx.programmeSelected"), description: name });
      onSelected(name);
    } catch (err) {
      toast({
        title: t("clx.errSelectProgramme"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel className="space-y-5">
      <div className="space-y-1.5">
        <Eyebrow>
          {t("clx.stepN", { n: 4, name: t("clx.stepNameProgramme") })}
        </Eyebrow>
        <h2 className="font-editorial text-xl text-cobble-ink">
          {t("clx.stepProgrammeHint")}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("clx.programmeIntro")}
          {suggestedKey && (
            <>
              {" "}
              <span className="text-gold-ink">
                {t("clx.programmePreselected")}
              </span>
            </>
          )}
        </p>
      </div>

      {serviceRejected && (
        <div className="rounded border border-amber-brand/40 bg-amber-brand/5 p-4">
          <p className="text-sm leading-relaxed text-iron-ink">
            {t("clx.programmeRejected")}
          </p>
        </div>
      )}

      {caseStatus === "DATA_SUBMITTED" ? (
        <div className="space-y-3 rounded border border-gold/40 bg-gold/5 p-5">
          <p className="text-sm font-medium text-cobble-ink">
            {t("clx.verifyingTitle")}
          </p>
          <p className="text-sm leading-relaxed text-iron-ink">
            {t("clx.programmeLocked")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void recheck()}
            disabled={checking}
            className="transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-95"
          >
            {checking ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}{" "}
            Check again
          </Button>
        </div>
      ) : loadError ? (
        <div className="flex items-center justify-between gap-3 rounded border border-coral/50 bg-coral/10 p-4">
          <p className="text-sm text-iron-ink">{loadError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-95"
          >
            {t("auth.errorRetry")}
          </Button>
        </div>
      ) : !programmes ? (
        <div className="space-y-3 py-4" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
          aria-label={t("clx.progFormLabel")}
        >
          <div className="space-y-1.5">
            <Label htmlFor="prog">{t("clx.stepNameProgramme")}</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger
                id="prog"
                aria-label={t("clx.chooseProgLabel")}
                className="w-full"
              >
                <SelectValue placeholder={t("clx.progSelectPh")} />
              </SelectTrigger>
              <SelectContent>
                {programmes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {p.country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {chosen && (
            <div className="rounded border border-limestone bg-muted/40 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
                {chosen.name} · {chosen.country}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-iron-ink">
                {chosen.description}
              </p>
            </div>
          )}

          <div className="flex items-start gap-3">
            <Checkbox
              id="ack"
              checked={ack}
              onCheckedChange={(v) => setAck(v === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="ack"
              className="cursor-pointer text-sm font-normal leading-relaxed text-iron-ink"
            >
              I understand this programme&apos;s requirements and fees structure
              will be confirmed by my Relationship Manager
            </Label>
          </div>

          <Button
            type="submit"
            disabled={!selected || !ack || submitting}
            className="w-full sm:w-auto transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
          >
            {submitting && <Spinner className="h-4 w-4" />} Submit programme
            choice
          </Button>
        </form>
      )}
    </Panel>
  );
}

// ── Step 5 · Welcome ──

function WelcomeStep({
  caseRef,
  programmeName,
  onDashboard,
}: {
  caseRef: string | null;
  programmeName: string | null;
  onDashboard: () => void;
}) {
  const { t } = useI18n();
  return (
    <Panel className="space-y-8 py-10 text-center">
      <div className="relative mx-auto h-28 w-28">
        <SloganRing
          size={112}
          className="absolute inset-0 opacity-70"
          speed={40}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <PassportSeal size={56} />
        </div>
      </div>
      <div className="space-y-3">
        <Eyebrow>{t("clx.stepWelcomeHint")}</Eyebrow>
        <h2 className="font-editorial text-2xl text-cobble-ink md:text-3xl">
          {t("clx.welcomeTitle")}
        </h2>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-iron-ink md:text-base">
          {t("clx.welcomeVerifyHint")}
          {caseRef && (
            <>
              {" "}
              Your reference is{" "}
              <span className="font-semibold tracking-wide text-cobble-ink">
                {caseRef}
              </span>
              .
            </>
          )}
        </p>
        {programmeName && (
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Programme · {programmeName}
          </p>
        )}
      </div>
      <Button
        size="lg"
        onClick={onDashboard}
        className="transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
      >
        {t("clx.goToDashboard")}
      </Button>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT 2 — ClientDashboard
// ─────────────────────────────────────────────────────────────────────────────

type NotificationsPayload = Awaited<ReturnType<typeof api.notifications>>;

type NextAction = {
  icon: ReactNode;
  text: string;
  cta?: { label: string; onClick: () => void };
};

/** Official letters issued on the firm letterhead — list + download (real PDFs). */
function OfficialLetters({
  caseId,
  approvalLetterId,
  onCountChange,
}: {
  caseId: string;
  approvalLetterId?: string | null;
  onCountChange?: (n: number) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Array<{
    id: string;
    fileName: string;
    type: string | null;
    ref: string | null;
    sizeBytes: number;
    createdAt: string;
  }> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.letters(caseId);
        if (alive) setRows(data.letters);
      } catch {
        if (alive) setRows([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [caseId]);

  // Live count for the Letters tab badge — the approval letter counts too
  // unless the letters list already contains it.
  useEffect(() => {
    if (!rows) return;
    const n =
      rows.length +
      (approvalLetterId && !rows.some((r) => r.id === approvalLetterId)
        ? 1
        : 0);
    onCountChange?.(n);
  }, [rows, approvalLetterId, onCountChange]);

  async function download(row: { id: string; fileName: string }) {
    setBusyId(row.id);
    try {
      const blob = await api.downloadLetterById(row.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = row.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: t("clx.letterDownloaded"),
        description: t("clx.savedToDevice", { name: row.fileName }),
      });
    } catch (err) {
      toast({
        title: t("clx.downloadFailed"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel ariaLabel="Official letters" className="border-gold/40">
      <Eyebrow>{t("clx.correspondence")}</Eyebrow>
      <h2 className="mt-1 font-editorial text-xl text-cobble-ink">
        {t("clx.officialLetters")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("clx.lettersIntro")}
      </p>
      <div className="mt-4">
        {rows === null ? (
          <div className="space-y-3 py-4" aria-busy="true">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-none" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-none" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <EmptyBlock
            icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
            text={t("clx.emptyLetters")}
            action={
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-muted-foreground max-w-xs">
                  {t("clx.emptyLettersHint")}
                </p>
                <EmptyStateHelp />
              </div>
            }
          />
        ) : (
          /* [contain:paint] on the scrolling lists below: these are `overflow-y-auto`
              + `max-h-*` scrollers, but Chromium still propagates their scrolled
              content into the DOCUMENT's scrollable overflow — a 512px list with
              2.5k of rows inflated the page by ~1.5kpx, which created a large
              empty scroll area at the end of the dashboard and pushed the sticky
              mobile bottom nav out of the viewport there. `contain: paint` makes
              the list's own clipping authoritative. */
          <ul className="styled-scroll max-h-[32rem] space-y-2.5 overflow-y-auto pr-1 [contain:paint]">
            {rows.map((row) => (
              <li
                key={row.id}
                className="group flex flex-wrap items-center justify-between gap-3 rounded-none border border-border/70 bg-muted/20 px-3.5 py-2.5 transition-all duration-200 hover:border-gold/30 hover:bg-muted/40 hover:shadow-sm"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <FileText
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-cobble-ink transition-colors group-hover:text-gold-ink">
                      {row.ref ?? row.fileName}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {format(new Date(row.createdAt), "d MMM yyyy")} ·{" "}
                      {formatBytes(row.sizeBytes)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void download(row)}
                  disabled={busyId === row.id}
                  className="transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-95"
                >
                  {busyId === row.id ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}{" "}
                  PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ── Dashboard tabs ──

type DashboardTab =
  | "overview"
  | "documents"
  | "messages"
  | "letters"
  | "evidence"
  | "ask";
const DASHBOARD_TABS: DashboardTab[] = [
  "overview",
  "documents",
  "messages",
  "letters",
  "evidence",
  "ask",
];

/** Sticky tab bar — WAI-ARIA tabs with live counts, arrow-key navigation. */
function DashboardTabs({
  active,
  onChange,
  counts,
}: {
  active: DashboardTab;
  onChange: (t: DashboardTab) => void;
  counts: {
    documents: number;
    messages: number;
    letters: number;
    evidence?: number;
  };
}) {
  const { t } = useI18n();
  const labels: Record<DashboardTab, string> = {
    overview: t("clx.tabOverview"),
    documents: t("clx.tabDocuments"),
    messages: t("clx.tabMessages"),
    letters: t("clx.tabLetters"),
    evidence: t("clx.tabEvidence"),
    ask: t("askmycase.title"),
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const idx = DASHBOARD_TABS.indexOf(active);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (idx + 1) % DASHBOARD_TABS.length;
    else if (e.key === "ArrowLeft")
      next = (idx - 1 + DASHBOARD_TABS.length) % DASHBOARD_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = DASHBOARD_TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = DASHBOARD_TABS[next];
    onChange(id);
    document.getElementById(`clx-tab-${id}`)?.focus();
  }

  return (
    <div className="sticky top-14 z-30 -mx-4 min-w-0 border-b border-border/70 bg-background px-4 md:-mx-6 md:px-6 lg:top-16">
      <div
        role="tablist"
        aria-label={t("clx.dashboardSectionsLabel")}
        onKeyDown={onKeyDown}
        className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {DASHBOARD_TABS.map((id) => {
          const selected = active === id;
          const count = id === "overview" ? null : counts[id];
          return (
            <button
              key={id}
              id={`clx-tab-${id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`clx-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(id)}
              className={cn(
                "-mb-px flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-xs uppercase tracking-[0.14em] transition-all duration-200 sm:px-4",
                selected
                  ? "border-gold font-semibold text-cobble-ink"
                  : "border-transparent text-muted-foreground hover:text-cobble-ink hover:border-gold/30 active:scale-[0.98]"
              )}
            >
              {labels[id]}
              {count !== null && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums",
                    selected
                      ? "bg-gold/20 text-amber-ink"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ClientDashboard() {
  const setView = useApp((s) => s.setView);
  const session = useApp((s) => s.session);
  const { settings } = usePlatformSettings();
  const [loading, setLoading] = useState(true);
  const [caseView, setCaseView] = useState<CaseView | null>(null);
  const [notifRes, setNotifRes] = useState<NotificationsPayload | null>(null);
  const { t } = useI18n();
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [msgCount, setMsgCount] = useState(0);
  const [lettersCount, setLettersCount] = useState(0);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const handleMsgCount = useCallback((n: number) => setMsgCount(n), []);
  const handleLettersCount = useCallback((n: number) => setLettersCount(n), []);
  const goDocuments = useCallback(() => setTab("documents"), []);
  // Deep-link navigation for the Next-One-Thing hero card: switch tab first,
  // then scroll to the anchor once the panel unhides.
  const goAnchor = useCallback((tab: DashboardTab, anchor: string) => {
    setTab(tab);
    window.setTimeout(() => {
      document
        .getElementById(anchor)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, []);

  const refreshCase = useCallback(async () => {
    try {
      const { case: c } = await api.myCase();
      setCaseView(c);
    } catch (err) {
      toast({
        title: t("clx.errRefreshCase"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    }
  }, []);

  // ── Live status timeline ──────────────────────────────────────────────
  // The case view is fetched once on mount and refreshed after uploads, so a
  // status change made by the RM in another session never reaches an open
  // portal — the timeline reads as frozen. Poll while the tab is visible and
  // re-sync on focus/visibility return, so the stepper tracks the real case.
  useEffect(() => {
    const POLL_MS = 30_000;
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      api
        .myCase()
        .then(({ case: c }) => {
          if (alive) setCaseView(c);
        })
        .catch(() => undefined); // transient — the next tick retries
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };

    timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [caseRes, notifRes_] = await Promise.allSettled([
        api.myCase(),
        api.notifications(),
      ]);
      if (!alive) return;
      if (caseRes.status === "fulfilled") setCaseView(caseRes.value.case);
      else
        toast({
          title: t("clx.errLoadCase"),
          description: errMessage(caseRes.reason, "Please try again."),
          variant: "destructive",
        });
      if (notifRes_.status === "fulfilled") setNotifRes(notifRes_.value);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const downloadLetter = useCallback(async () => {
    if (!caseView) return;
    try {
      const res = await api.downloadLetter(caseView.id);
      if (res.download) {
        const bin = atob(res.download);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.letter.fileName || "approval-letter.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast({
          title: t("clx.letterDownloaded"),
          description: t("clx.savedShort"),
        });
      } else {
        // Never surface `res.note`: the server's text names the storage
        // mechanism and "seeded records" to the applicant. State the situation
        // and the next step instead.
        toast({
          title: t("clx.letterSandbox"),
          description: t("clx.letterSandboxNote"),
        });
      }
    } catch (err) {
      toast({
        title: t("clx.downloadFailed"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    }
  }, [caseView]);

  /** G16 — download every document on the case in one action. */
  async function downloadAllDocuments() {
    if (!caseView || caseView.documents.length === 0) return;
    setDownloadingAll(true);
    let ok = 0;
    let failed = 0;
    for (const doc of caseView.documents) {
      try {
        const blob = await api.downloadDocumentById(doc.id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setDownloadingAll(false);
    if (failed === 0) {
      toast({ title: t("clx.docsDownloaded", { n: ok }) });
    } else {
      toast({
        title: t("clx.docsDownloadPartial", { ok, failed }),
        variant: "destructive",
      });
    }
  }

  if (loading) {
    return (
      <PageWrap>
        <DashboardSkeleton />
      </PageWrap>
    );
  }

  const c = caseView;
  if (!c) {
    return (
      <PageWrap>
        <EmptyState
          title={t("clx.emptyNoAppTitle")}
          hint={t("clx.emptyNoAppHint")}
          action={<EmptyStateHelp />}
        />
        <div className="flex justify-center">
          <Button
            onClick={() => setView("client-onboarding")}
            className="transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
          >
            {t("clx.startApplication")}
          </Button>
        </div>
      </PageWrap>
    );
  }

  const openRequests = c.requests.filter((r) => r.status === "OPEN");

  // FS-7 done mapping (best judgment, see mount comment): stage progress,
  // passport approval, and desk approvals already on this case object.
  const passport = c.documents.find((d) => d.type === "PASSPORT");
  const stageInfo = stageInfoFor(c.status, c.timeline, openRequests.length);
  const roleTileDone: string[] = [];
  if (stageInfo.completedUpTo >= 1) roleTileDone.push("profile");
  if (passport && passport.status === "RM_APPROVED")
    roleTileDone.push("identity");
  if (c.dataApproval === "APPROVED") roleTileDone.push("funds");
  if (c.serviceApproval === "APPROVED") roleTileDone.push("programme");
  if (stageInfo.completedUpTo >= 3) roleTileDone.push("review");
  const tabCounts = {
    documents: c.documents.length,
    messages: msgCount,
    letters: lettersCount,
    evidence: 1,
  };

  // Expected authority timeline, resolved client-side from the public research
  // catalogue. `processingWeeks` is an INDICATIVE planning figure (see
  // programmes.ts accuracy contract), shown as a range so it reads as an
  // expectation, not a promise.
  const programmeEta = c.programme
    ? programmeByKey(c.programme.key)?.processingWeeks ?? null
    : null;
  const etaCopy =
    programmeEta !== null
      ? t("clx.etaCopy", {
          programme: c.programme?.name ?? t("clx.yourProgramme"),
          weeks: programmeEta,
        })
      : null;

  const nextActions: NextAction[] = [];
  switch (c.status) {
    case "ONBOARDING":
      // dataApproval is only ever PENDING here when the RM requested a
      // correction — the wizard resumes at the profile step in that case.
      nextActions.push(
        c.dataApproval === "PENDING"
          ? {
              icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
              text: t("clx.naCorrectDetails"),
              cta: {
                label: t("clx.naReviewDetails"),
                onClick: () => setView("client-onboarding"),
              },
            }
          : {
              icon: <UserRound className="h-4 w-4" aria-hidden="true" />,
              text: t("clx.naCompleteProfile"),
              cta: {
                label: t("common.continue"),
                onClick: () => setView("client-onboarding"),
              },
            }
      );
      break;
    case "DATA_SUBMITTED":
      nextActions.push({
        icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
        text: t("clx.naVerifying"),
      });
      break;
    case "DATA_APPROVED":
      nextActions.push({
        icon: <Compass className="h-4 w-4" aria-hidden="true" />,
        text: t("clx.naChooseProgramme"),
        cta: {
          label: t("clx.naChoose"),
          onClick: () => setView("client-onboarding"),
        },
      });
      break;
    case "SERVICE_SELECTED":
      nextActions.push(
        c.serviceApproval === "REJECTED"
          ? {
              icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
              text: t("clx.naProgrammeRejected"),
              cta: {
                label: t("clx.naChooseAgain"),
                onClick: () => setView("client-onboarding"),
              },
            }
          : {
              icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
              text: t("clx.naAwaitingApproval"),
            }
      );
      break;
    case "SERVICE_APPROVED":
      nextActions.push({
        icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
        text: t("clx.naPreparingRequests"),
      });
      break;
    case "DOCS_REQUESTED":
      nextActions.push(
        openRequests.length > 0
          ? {
              icon: <Upload className="h-4 w-4" aria-hidden="true" />,
              text: t(
                openRequests.length === 1
                  ? "clx.naUploadOne"
                  : "clx.naUploadMany",
                { n: openRequests.length }
              ),
              cta: { label: t("clx.naUpload"), onClick: goDocuments },
            }
          : {
              icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
              text: t("clx.naAllReceived"),
            }
      );
      break;
    case "IN_PROGRESS":
      nextActions.push({
        icon: <FileSearch className="h-4 w-4" aria-hidden="true" />,
        text: etaCopy ?? t("clx.naPreparingDossier"),
      });
      break;
    case "DISPATCHED":
      nextActions.push({
        icon: <Truck className="h-4 w-4" aria-hidden="true" />,
        text: etaCopy ?? t("clx.naOnWay"),
      });
      break;
    case "FOLLOW_UP":
      nextActions.push({
        icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />,
        text: etaCopy ?? t("clx.naFollowUp"),
      });
      break;
    case "APPROVED_IN_PRINCIPLE":
      nextActions.push({
        icon: <Award className="h-4 w-4" aria-hidden="true" />,
        text: t("clx.naApprovedReady"),
        cta: {
          label: t("clx.naDownload"),
          onClick: () => {
            setTab("letters");
            void downloadLetter();
          },
        },
      });
      break;
    case "COMPLETED":
      nextActions.push({
        icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
        text: t("clx.naComplete"),
      });
      break;
    case "CANCELLED":
      nextActions.push({
        icon: <Ban className="h-4 w-4" aria-hidden="true" />,
        text: t("clx.naCancelled"),
      });
      break;
  }
  if (c.letter && c.status !== "APPROVED_IN_PRINCIPLE") {
    nextActions.push({
      icon: <Award className="h-4 w-4" aria-hidden="true" />,
      text: t("clx.naLetterReady"),
      cta: {
        label: t("clx.naDownload"),
        onClick: () => {
          setTab("letters");
          void downloadLetter();
        },
      },
    });
  }
  if (openRequests.length > 0 && c.status !== "DOCS_REQUESTED") {
    nextActions.push({
      icon: <Upload className="h-4 w-4" aria-hidden="true" />,
      text: t(openRequests.length === 1 ? "clx.naOpenOne" : "clx.naOpenMany", {
        n: openRequests.length,
      }),
      cta: { label: t("clx.naUpload"), onClick: goDocuments },
    });
  }

  return (
    <PageWrap>
      {/* ── Header ── */}
      <header className="space-y-3">
        <Eyebrow>{t("clx.caseDashboard")}</Eyebrow>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-editorial text-2xl text-cobble-ink md:text-3xl">
            {c.reference}
          </h1>
          <StateBadge state={c.status} />
          <span className="text-sm text-muted-foreground">
            {settings.labels.caseStatuses[c.status] ??
              caseStatusLabel(c.status)}
          </span>
        </div>
        <div className="h-px w-full bg-gold/40" aria-hidden="true" />
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Programme
            </dt>
            <dd className="font-medium text-cobble-ink">
              {c.programme
                ? `${c.programme.name} — ${c.programme.country}`
                : "Not selected yet"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Your Relationship Manager
            </dt>
            <dd className="font-medium text-cobble-ink">
              {c.rm?.name ?? "Being assigned"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Opened
            </dt>
            <dd className="font-medium text-cobble-ink">
              {format(new Date(c.createdAt), "d MMM yyyy")}
            </dd>
          </div>
        </dl>
      </header>

      {/* ── Next actions ── */}
      <section
        aria-label={t("clx.nextActions")}
        className="space-y-3 rounded-none bg-cobble p-5 text-[#F5F1EA] md:p-6"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
          {t("clx.nextActions")}
        </p>
        <ul className="space-y-2.5">
          {nextActions.map((a) => (
            <li
              key={a.text}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span className="flex items-center gap-2.5">
                {a.icon}
                <span>{a.text}</span>
              </span>
              {a.cta && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={a.cta.onClick}
                  className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
                >
                  {a.cta.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Next one thing (hero card: top RFI / request / booking gap) ── */}
      <NextOneThingCard
        caseId={c.id}
        requests={c.requests.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          dueDate: r.dueDate,
        }))}
        gaps={c.dispatches.flatMap((d) =>
          (d.followUps ?? [])
            .filter((f) => f.status !== "COMPLETED")
            .map((f) => ({
              id: f.id,
              label: `Follow-up ${f.dueDate.slice(0, 10)}`,
              detail: f.note,
            }))
        )}
        onNavigate={goAnchor}
      />

      {/* ── Progress stepper (evidence-driven from the real case status) ── */}
      <ProgressStepper
        info={stageInfo}
        onStageClick={() => goAnchor("overview", "clx-status-timeline")}
      />

      {/* ── Journey bar (visual progress indicator) ── */}
      <div id="clx-progress" className="scroll-mt-24">
        <JourneyBar
          caseData={{
            status: c.status,
            programmeKey: c.programme?.key ?? null,
            documents: c.documents.map((d) => ({
              type: d.type,
              status: d.status,
            })),
            dispatches: c.dispatches,
            letters: c.letter ? [c.letter] : [],
            followUps: c.dispatches.flatMap((d) => d.followUps ?? []),
          }}
          events={c.timeline.map((t) => ({
            title: `${
              settings.labels.caseStatuses[t.to] ?? caseStatusLabel(t.to)
            }${t.reason ? ` — ${t.reason}` : ""}`,
            timestamp: t.createdAt,
          }))}
          onStageClick={(index) => {
            if (index + 1 < stageInfo.current)
              goAnchor("overview", "clx-status-timeline");
            else goAnchor("overview", "requested-documents");
          }}
        />
      </div>

      {/* ── FS-7 checklist tiles: role from the signed-in principal (the portal
          case carries no applicant rows, so the client sees the PRIMARY track;
          dependants keep the same track until per-applicant reads land).
          Done mapping (best judgment, documented): profile = past stage 1,
          identity = passport RM-approved, funds = data approved by the desk,
          programme = service approved, review = through stage 3. */}
      <RoleTiles
        role="PRIMARY"
        doneKeys={roleTileDone}
        onOpen={(key) => {
          if (key === "profile") setView("client-onboarding");
          else if (key === "programme") setView("client-apply");
          else goAnchor("overview", "requested-documents");
        }}
      />

      {/* ── Sticky tab bar ── */}
      <DashboardTabs active={tab} onChange={setTab} counts={tabCounts} />

      {/* ── Overview ── */}
      <div
        id="clx-panel-overview"
        role="tabpanel"
        aria-labelledby="clx-tab-overview"
        hidden={tab !== "overview"}
        className="space-y-6"
      >
        <Panel id="requested-documents" ariaLabel="Requested documents">
          <SectionTitle>{t("clx.requestedDocuments")}</SectionTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Items your Relationship Manager has asked you to provide.
          </p>
          <div className="mt-4">
            {c.requests.length === 0 ? (
              <EmptyBlock
                icon={<FileSearch className="h-5 w-5" aria-hidden="true" />}
                text={t("clx.emptyNoRequestsHint")}
                action={
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground max-w-xs">
                      {t("clx.emptyNoRequestsDetail")}
                    </p>
                    <EmptyStateHelp />
                  </div>
                }
              />
            ) : (
              <ul className="styled-scroll max-h-[32rem] divide-y divide-border overflow-y-auto pr-1 [contain:paint]">
                {c.requests.map((r: RequestRow) => (
                  <li
                    key={r.id}
                    className="group flex flex-col justify-between gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center transition-colors hover:bg-muted/20 rounded-none px-2 -mx-2"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-cobble-ink transition-colors group-hover:text-gold-ink">
                          {r.title}
                        </p>
                        <StatusBadge
                          status={r.status === "OPEN" ? "Open" : "Fulfilled"}
                          tone={r.status === "OPEN" ? "amber" : "green"}
                        />
                        {r.status === "FULFILLED" && (
                          <CheckCircle2
                            className="h-4 w-4 text-olive-ink"
                            aria-label={t("clx.fulfilledLabel")}
                          />
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {r.instructions}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                        <span>
                          {settings.labels.docTypes[r.docType] ??
                            DOC_TYPE_LABELS[r.docType] ??
                            r.docType}
                        </span>
                        {r.dueDate && (
                          <span>
                            Due {format(new Date(r.dueDate), "d MMM yyyy")}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <RequestUpload
                        request={r}
                        onUploaded={() => void refreshCase()}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel id="clx-status-timeline" ariaLabel="Status timeline">
          <SectionTitle>{t("clx.statusTimeline")}</SectionTitle>
          <div className="mt-4">
            {c.timeline.length === 0 ? (
              <EmptyBlock
                icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
                text={t("clx.emptyNoHistoryHint")}
                action={
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground max-w-xs">
                      {t("clx.emptyNoHistoryDetail")}
                    </p>
                    <EmptyStateHelp />
                  </div>
                }
              />
            ) : (
              <div className="styled-scroll max-h-[32rem] overflow-y-auto pr-1 [contain:paint]">
                <ol className="relative ml-3 space-y-6 border-l border-gold/50">
                  {[...c.timeline].reverse().map((tl) => (
                    <li
                      key={tl.id}
                      className="group relative pl-6 transition-colors hover:bg-muted/20 rounded-none py-1 -my-1"
                    >
                      <span
                        className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border border-gold bg-card transition-transform group-hover:scale-125"
                        aria-hidden="true"
                      />
                      <p className="text-sm font-medium text-cobble-ink transition-colors group-hover:text-gold-ink">
                        {tl.from
                          ? `${
                              settings.labels.caseStatuses[tl.from] ??
                              caseStatusLabel(tl.from)
                            } → ${
                              settings.labels.caseStatuses[tl.to] ??
                              caseStatusLabel(tl.to)
                            }`
                          : settings.labels.caseStatuses[tl.to] ??
                            caseStatusLabel(tl.to)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(tl.createdAt), "d MMM yyyy, HH:mm")}
                      </p>
                      {tl.reason && (
                        <p className="mt-0.5 text-xs text-iron-ink/80">
                          {tl.reason}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </Panel>

        {/* ── Submission to the authority ──
             The carrier, the adapter and the tracking mechanics are our
             plumbing. A client needs to know their file was sent, to where,
             and when — not which stub handled it. */}
        {c.dispatches.length > 0 && (
          <Panel ariaLabel="Submission to the authority">
            <SectionTitle>{t("clx.dispatchTracking")}</SectionTitle>
            <div className="mt-4 space-y-4">
              {c.dispatches.map((d) => (
                <div
                  key={d.id}
                  className="group space-y-2 rounded border border-border bg-muted/40 p-4 transition-all duration-200 hover:border-gold/30 hover:bg-muted/60 hover:shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-cobble-ink transition-colors group-hover:text-gold-ink">
                      {t("clx.sentToAuthority")} ·{" "}
                      <span className="font-mono text-xs tracking-wide">
                        {d.trackingId}
                      </span>
                    </p>
                    <StateBadge state={d.status} />
                  </div>
                  <p className="text-sm text-iron-ink">
                    {t("clx.sentTo")}: {d.destination}
                  </p>
                  {d.dispatchedAt && (
                    <p className="text-xs text-muted-foreground">
                      {t("clx.sentOn", {
                        date: format(new Date(d.dispatchedAt), "d MMM yyyy"),
                      })}
                    </p>
                  )}
                  {d.followUps.map((f) => (
                    <p
                      key={f.id}
                      className="flex flex-wrap items-center gap-2 text-xs text-iron-ink"
                    >
                      <span>
                        Follow-up due{" "}
                        {format(new Date(f.dueDate), "d MMM yyyy")}
                        {f.note ? ` — ${f.note}` : ""}
                      </span>
                      <StateBadge state={f.status} />
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── Push hint ── */}
        {notifRes?.prefs && !notifRes.prefs.push && (
          <Panel
            ariaLabel="Push notifications hint"
            className="border-gold/40 bg-gold/5"
          >
            <div className="flex items-start gap-3">
              <BellRing
                className="mt-0.5 h-4 w-4 text-gold-ink"
                aria-hidden="true"
              />
              <p className="text-sm leading-relaxed text-iron-ink">
                {t("clx.pushHint")}
              </p>
            </div>
          </Panel>
        )}
      </div>

      {/* ── Documents ── */}
      <div
        id="clx-panel-documents"
        role="tabpanel"
        aria-labelledby="clx-tab-documents"
        hidden={tab !== "documents"}
        className="space-y-6"
      >
        <UploadDropzone
          openRequests={openRequests}
          onUploaded={() => void refreshCase()}
        />

        {/* ── Completeness map (visual document status) ── */}
        <CompletenessMap
          documents={c.documents.map((d) => ({
            type: d.type,
            title: d.title,
            status: d.status as DocumentStatus,
            required: true,
          }))}
          overallPercentage={
            computeCaseProgress({
              status: c.status,
              programmeKey: c.programme?.key ?? null,
              documents: c.documents.map((d) => ({
                type: d.type,
                status: d.status,
              })),
              dispatches: c.dispatches,
              letters: c.letter ? [c.letter] : [],
              followUps: c.dispatches.flatMap((d) => d.followUps ?? []),
            }).percentage
          }
        />

        <Panel ariaLabel="Your documents">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle>{t("clx.yourDocuments")}</SectionTitle>
            {c.documents.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadAllDocuments()}
                disabled={downloadingAll}
                className="transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-95"
              >
                {downloadingAll ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {t("clx.downloadAll")}
              </Button>
            )}
          </div>
          <div className="mt-4">
            {c.documents.length === 0 ? (
              <EmptyBlock
                icon={<FileText className="h-5 w-5" aria-hidden="true" />}
                text={t("clx.emptyDocs")}
                action={
                  openRequests.length > 0 ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        const el = document.getElementById(
                          "clx-panel-documents"
                        );
                        el?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      }}
                      className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
                    >
                      <Upload className="h-4 w-4" aria-hidden="true" />{" "}
                      {t("clx.naUpload")}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="styled-scroll max-h-[32rem] divide-y divide-border overflow-y-auto pr-1 [contain:paint]">
                {c.documents.map((d: DocumentRow) => (
                  <div
                    key={d.id}
                    id={`doc-card-${d.type}`}
                    className="group scroll-mt-20 transition-colors hover:bg-muted/20 rounded-none px-2 -mx-2"
                  >
                    <DocumentLine
                      doc={d}
                      onUpdated={() => void refreshCase()}
                    />
                  </div>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Messages ── */}
      <div
        id="clx-panel-messages"
        role="tabpanel"
        aria-labelledby="clx-tab-messages"
        hidden={tab !== "messages"}
        className="space-y-6"
      >
        <MessagesPanel
          caseId={c.id}
          myName={session?.name}
          onCountChange={handleMsgCount}
        />
        <div id="rfi-threads" className="scroll-mt-24">
          <Panel ariaLabel="Questions from your case team">
            <SectionTitle>Questions from your case team</SectionTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              Answer here — attach evidence straight onto a question when one
              asks for a document.
            </p>
            <div className="mt-4">
              <RfiThreadPanel caseId={c.id} viewer="client" />
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Letters ── */}
      <div
        id="clx-panel-letters"
        role="tabpanel"
        aria-labelledby="clx-tab-letters"
        hidden={tab !== "letters"}
        className="space-y-6"
      >
        <OfficialLetters
          caseId={c.id}
          approvalLetterId={c.letter?.id ?? null}
          onCountChange={handleLettersCount}
        />

        {/* ── Approval letter ── */}
        {c.letter && (
          <Panel ariaLabel="Approval letter" className="border-gold/40">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="space-y-1.5">
                <Eyebrow>{t("clx.congratulations")}</Eyebrow>
                <h2 className="font-editorial text-xl text-cobble-ink">
                  {t("clx.approvalLetter")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {c.letter.fileName} · {formatBytes(c.letter.sizeBytes)} ·{" "}
                  {format(new Date(c.letter.createdAt), "d MMM yyyy")}
                </p>
              </div>
              <Button
                onClick={() => {
                  setTab("letters");
                  void downloadLetter();
                }}
                className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
              >
                <Award className="h-4 w-4" aria-hidden="true" /> Download PDF
              </Button>
            </div>
          </Panel>
        )}
      </div>

      {/* ── Evidence readiness ── */}
      <div
        id="clx-panel-evidence"
        role="tabpanel"
        aria-labelledby="clx-tab-evidence"
        hidden={tab !== "evidence"}
        className="space-y-6"
      >
        <EvidenceReadiness caseId={c.id} />
      </div>

      {/* ── Ask My Case (AI assistant) ── */}
      <div
        id="clx-panel-ask"
        role="tabpanel"
        aria-labelledby="clx-tab-ask"
        hidden={tab !== "ask"}
        className="space-y-6"
      >
        <AskMyCase
          caseId={c.id}
          caseStatus={c.status}
          programmeName={c.programme?.name}
          documentsCount={c.documents.length}
          pendingDocumentsCount={openRequests.length}
        />
      </div>
    </PageWrap>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      {/* Header skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-56" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>

      {/* Next actions skeleton */}
      <Skeleton className="h-24 w-full rounded-none" />

      {/* Progress stepper skeleton */}
      <Skeleton className="h-20 w-full rounded-none" />

      {/* Tab bar skeleton */}
      <div className="flex items-center gap-2 border-b border-border">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Overview content skeleton */}
      <Skeleton className="h-52 w-full rounded-none" />
      <Skeleton className="h-44 w-full rounded-none" />
    </div>
  );
}

/** Upload control for a single document request. */
function RequestUpload({
  request,
  onUploaded,
}: {
  request: RequestRow;
  onUploaded: () => void;
}) {
  const { t } = useI18n();
  const { settings } = usePlatformSettings();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const maxMb = clampUploadMb(settings.operations.maxUploadMb);
  const maxBytes = maxMb * 1024 * 1024;
  const extRe = extensionRegex(settings.operations.acceptedExtensions);
  const accept = acceptAttribute(settings.operations.acceptedExtensions);

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!fileAccepted(file, extRe)) {
      toast({
        title: t("clx.errUnsupportedFile"),
        description: t("clx.chooseOneOf", {
          list: settings.operations.acceptedExtensions
            .map((e) => e.toUpperCase())
            .join(", "),
        }),
        variant: "destructive",
      });
      return;
    }
    if (file.size > maxBytes) {
      toast({
        title: t("clx.errFileTooLarge"),
        description: t("clx.maxFileSize", { mb: maxMb }),
        variant: "destructive",
      });
      return;
    }
    setUploading(true);
    try {
      const prepared = await prepareUpload(file);
      await api.uploadDocument({
        type: request.docType,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        dataBase64: prepared.dataBase64,
        requestId: request.id,
      });
      toast({
        title: t("clx.documentReceived"),
        description: t("clx.documentReceivedHint", { name: file.name }),
      });
      onUploaded();
    } catch (err) {
      toast({
        title: t("clx.errUploadFailed"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  if (request.status === "FULFILLED") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-olive-ink">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Received
      </span>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={`Upload ${request.title}`}
        onChange={(e) => void onChange(e)}
      />
      {uploading ? (
        <span
          className="flex items-center gap-2 text-sm text-iron-ink"
          role="status"
        >
          <Spinner className="h-4 w-4" /> Encrypted upload…
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-95"
        >
          <Upload className="h-4 w-4" aria-hidden="true" /> Upload
        </Button>
      )}
    </>
  );
}

/** Document statuses in which the client may correct extracted fields — mirrors the PATCH /api/documents/[id] contract. */
const CORRECTABLE_DOC_STATUSES = new Set([
  "OCR_PROCESSED",
  "CLIENT_CONFIRMED",
  "CHANGES_REQUESTED",
  "RM_REJECTED",
]);

/** One row in "Your documents" with reviewer snippet + extracted data (inline-correctable by the client). */
function DocumentLine({
  doc,
  onUpdated,
}: {
  doc: DocumentRow;
  onUpdated?: () => void;
}) {
  const { t } = useI18n();
  const { settings } = usePlatformSettings();
  const latestReview = doc.reviews[0];
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const canCorrect = CORRECTABLE_DOC_STATUSES.has(doc.status);

  function startEditing() {
    setValues(
      Object.fromEntries(doc.fields.map((f) => [f.fieldKey, f.value ?? ""]))
    );
    setEditing(true);
  }

  async function saveCorrections() {
    const changed = doc.fields
      .filter((f) => (values[f.fieldKey] ?? "") !== (f.value ?? ""))
      .map((f) => ({ fieldKey: f.fieldKey, value: values[f.fieldKey] ?? "" }));
    if (changed.length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.correctFields(doc.id, changed);
      toast({ title: t("clx.correctionsSaved") });
      setEditing(false);
      onUpdated?.();
    } catch (err) {
      toast({
        title: t("clx.errSaveCorrections"),
        description: errMessage(err, t("common.tryAgain")),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-limestone bg-muted text-iron-ink"
        aria-hidden="true"
      >
        <DocIcon type={doc.type} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-cobble-ink">{doc.title}</p>
          <StateBadge
            state={doc.status}
            label={
              settings.labels.docStatuses[doc.status] ??
              docStatusLabel(doc.status)
            }
          />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {settings.labels.docTypes[doc.type] ??
            DOC_TYPE_LABELS[doc.type] ??
            doc.type}{" "}
          · {doc.fileName} · {formatBytes(doc.sizeBytes)} · v{doc.version}
        </p>
        {latestReview && (
          <p className="mt-1.5 text-xs italic text-muted-foreground">
            {latestReview.reviewer.name} {decisionLabel(latestReview.decision)}{" "}
            — {latestReview.reason}
          </p>
        )}
        {doc.fields.length > 0 && (
          <Accordion type="single" collapsible className="mt-1">
            <AccordionItem value={doc.id} className="border-0">
              <AccordionTrigger className="py-2 text-xs font-semibold uppercase tracking-[0.14em] text-gold-ink hover:no-underline">
                {t("clx.aiExtractedData")}
              </AccordionTrigger>
              <AccordionContent>
                {editing ? (
                  <div className="space-y-3">
                    {doc.fields.map((f) => (
                      <div key={f.id} className="space-y-1.5">
                        <Label
                          htmlFor={`fix-${doc.id}-${f.fieldKey}`}
                          className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
                        >
                          {settings.labels.ocrFieldLabels[f.fieldKey] ??
                            FIELD_LABELS[f.fieldKey] ??
                            f.fieldKey}
                        </Label>
                        <Input
                          id={`fix-${doc.id}-${f.fieldKey}`}
                          value={values[f.fieldKey] ?? ""}
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              [f.fieldKey]: e.target.value,
                            }))
                          }
                          className="transition-all duration-200 hover:border-gold/40 focus-visible:border-gold/60"
                        />
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="min-h-11"
                        onClick={() => void saveCorrections()}
                        disabled={saving}
                      >
                        {saving && <Spinner className="mr-2 h-3.5 w-3.5" />}{" "}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11"
                        onClick={() => setEditing(false)}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <dl className="divide-y divide-border">
                      {doc.fields.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <dt className="text-xs text-muted-foreground">
                            {settings.labels.ocrFieldLabels[f.fieldKey] ??
                              FIELD_LABELS[f.fieldKey] ??
                              f.fieldKey}
                          </dt>
                          <dd className="flex items-center gap-3">
                            <span className="text-sm text-cobble-ink">
                              {f.value || "—"}
                            </span>
                            {f.confidence < 0.55 && (
                              <ExtractionQuality value={f.confidence} />
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {canCorrect && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 min-h-11 transition-all duration-200 hover:bg-gold/10 hover:text-gold-ink hover:border-gold/40 active:scale-95"
                        onClick={startEditing}
                      >
                        <Pencil
                          className="mr-1.5 h-3.5 w-3.5"
                          aria-hidden="true"
                        />{" "}
                        Correct data
                      </Button>
                    )}
                  </>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    </li>
  );
}

function decisionLabel(decision: string): string {
  switch (decision) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "REQUEST_CHANGES":
      return "requested changes";
    default:
      return decision.toLowerCase();
  }
}

/** Realtime message thread — socket.io mini-service with REST fallback. */
function MessagesPanel({
  caseId,
  myName,
  onCountChange,
}: {
  caseId: string;
  myName?: string;
  onCountChange?: (n: number) => void;
}) {
  const { t } = useI18n();
  const {
    messages,
    historyLoading,
    connected,
    onlineUsers,
    typingUser,
    lastSendVia,
    send,
    notifyTyping,
  } = useCaseChat(caseId);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingCooldown = useRef(0);

  // Live count for the Messages tab badge.
  useEffect(() => {
    onCountChange?.(messages.length);
  }, [messages.length, onCountChange]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, historyLoading, typingUser]);

  async function sendCurrent() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    let documentId: string | undefined;
    if (attachment) {
      setUploading(true);
      try {
        const prepared = await prepareUpload(attachment);
        const uploaded = await api.uploadDocument({
          type: "OTHER",
          fileName: prepared.fileName,
          mimeType: prepared.mimeType,
          dataBase64: prepared.dataBase64,
          caseId,
        });
        documentId = uploaded.document.id;
      } catch (err) {
        toast({
          title: "Attachment upload failed",
          description: errMessage(err, "Please try again."),
          variant: "destructive",
        });
        setUploading(false);
        setSending(false);
        return;
      } finally {
        setUploading(false);
      }
    }
    const ok = await send(trimmed, documentId);
    setSending(false);
    if (ok) {
      setBody("");
      setAttachment(null);
      notifyTyping(false);
      toast({ title: connected ? t("chat.sent") : t("chat.fallbackSent") });
    } else {
      toast({ title: t("chat.sendFailed"), variant: "destructive" });
    }
  }

  function onComposerChange(v: string) {
    setBody(v);
    const now = Date.now();
    if (v.trim() && now - typingCooldown.current > 1500) {
      typingCooldown.current = now;
      notifyTyping(true);
    }
  }

  const counterpartOnline = onlineUsers.filter(
    (u) => u.userId !== undefined && u.name !== myName
  );

  return (
    <Panel ariaLabel="Messages">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>{t("chat.messagesTitle")}</SectionTitle>
        <div className="flex items-center gap-2">
          <CallLauncher caseId={caseId} mySide="CLIENT" />
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em]",
              connected
                ? "border-olive/40 bg-olive/10 text-olive-ink"
                : "border-border bg-muted text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connected ? "bg-olive" : "bg-muted-foreground/60"
              )}
              aria-hidden
            />
            {connected ? t("chat.liveBadge") : t("chat.reconnecting")}
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("chat.clientHint")}
      </p>
      {counterpartOnline.length > 0 && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-olive-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-olive" aria-hidden />
          {counterpartOnline.map((u) => u.name).join(", ")} {t("chat.online")}
        </p>
      )}

      <div
        ref={scrollRef}
        className="styled-scroll mt-4 max-h-96 space-y-3 overflow-y-auto pr-1 [contain:paint]"
        role="log"
        aria-label={t("clx.msgThreadLabel")}
        aria-live="polite"
      >
        {historyLoading ? (
          <div className="space-y-3 py-4" aria-busy="true">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <EmptyBlock
            icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
            text={t("clx.emptyMessages")}
            action={
              <div className="flex flex-col items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const input = document.querySelector<HTMLTextAreaElement>(
                      "textarea[data-testid='message-input']"
                    );
                    input?.focus();
                  }}
                  className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />{" "}
                  {t("clx.sendMessage")}
                </Button>
                <EmptyStateHelp />
              </div>
            }
          />
        ) : (
          messages.map((m) => {
            const own = m.author.name === myName;
            return (
              <div
                key={m.id}
                className={cn(
                  "max-w-[85%] rounded-none px-3.5 py-2.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
                  own
                    ? "ml-auto bg-cobble text-[#F5F1EA]"
                    : "bg-muted text-iron-ink"
                )}
              >
                <p className="whitespace-pre-wrap break-words text-sm">
                  {m.body}
                </p>
                {m.attachment && (
                  <button
                    type="button"
                    className={cn(
                      "mt-2 flex max-w-full items-center gap-2 border px-2.5 py-2 text-left text-xs",
                      own
                        ? "border-white/25 text-[#F5F1EA] hover:bg-white/10"
                        : "border-border text-iron-ink hover:bg-background"
                    )}
                    onClick={() =>
                      void api
                        .downloadDocumentById(m.attachment!.id)
                        .then((blob) => {
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = m.attachment!.fileName;
                          a.click();
                          URL.revokeObjectURL(url);
                        })
                        .catch(() =>
                          toast({
                            title: "Download failed",
                            variant: "destructive",
                          })
                        )
                    }
                  >
                    <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{m.attachment.fileName}</span>
                    <Download
                      className="ml-auto h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  </button>
                )}
                <p
                  className={cn(
                    "mt-1 text-[10px] uppercase tracking-[0.14em]",
                    own ? "text-gold-ink" : "text-muted-foreground"
                  )}
                >
                  {m.author.name} ·{" "}
                  {ROLE_LABELS[m.author.role] ?? m.author.role} ·{" "}
                  {format(new Date(m.createdAt), "d MMM yyyy, HH:mm")}
                </p>
              </div>
            );
          })
        )}
        {typingUser && (
          <p
            className="text-xs italic text-muted-foreground"
            aria-live="polite"
          >
            {t("chat.typing", { name: typingUser })}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendCurrent();
        }}
        className="mt-4 space-y-2 border-t border-gold/30 pt-4"
        aria-label={t("clx.sendMsgLabel")}
      >
        <Label htmlFor="msg">{t("chat.writeLabel")}</Label>
        <input
          ref={attachmentRef}
          type="file"
          className="sr-only"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
          aria-label="Attach a document"
        />
        <Textarea
          id="msg"
          value={body}
          onChange={(e) => onComposerChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendCurrent();
            }
          }}
          rows={3}
          placeholder={t("chat.sendPlaceholder")}
        />
        {attachment && (
          <div className="flex items-center justify-between gap-2 border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-iron-ink">
            <span className="min-w-0 truncate">
              Attached: {attachment.name}
            </span>
            <button
              type="button"
              className="shrink-0 underline underline-offset-2"
              onClick={() => setAttachment(null)}
            >
              Remove
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!connected && (
            <p className="text-[11px] text-muted-foreground">
              {t("chat.fallbackNote")}
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => attachmentRef.current?.click()}
              disabled={sending || uploading}
            >
              <Upload className="h-4 w-4" aria-hidden="true" /> Attach
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={sending || uploading || !body.trim()}
              className="min-h-11 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
            >
              {sending || uploading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}{" "}
              {t("chat.send")}
            </Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}
