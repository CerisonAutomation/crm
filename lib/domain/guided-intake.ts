/**
 * Guided intake — the questionnaire a visitor answers before they are a client.
 *
 * The point of this module is that NOTHING here is invented per-screen. Every
 * question is derived from the researched catalogue in `programmes.ts` and the
 * document/screening catalogues in `lifecycle.ts`, so the guided flow asks
 * exactly what the selected route actually requires and nothing else. Adding a
 * programme to the catalogue changes this flow automatically.
 *
 * Prisma-free and side-effect-free: importable from a server route, a client
 * component and a unit test alike.
 */
import { SCREENING_CHECKS } from "@/lib/domain/lifecycle";
import {
  PROGRAMMES,
  programmeByKey,
  requiredDocuments,
  type Programme,
  type ProgrammeFamily,
} from "@/lib/domain/programmes";

// ───────────────────────────── steps ─────────────────────────────

/**
 * The guided path, in order. `PROGRAMME` and `QUESTIONNAIRE` are the two steps
 * that depend on what came before; the rest are fixed.
 */
export const GUIDED_STEPS = [
  { key: "INTENT", label: "What you are looking for", help: "Purpose and horizon — this narrows the catalogue." },
  { key: "PROGRAMME", label: "Choose your route", help: "Only routes that match your intent are shown." },
  { key: "QUESTIONNAIRE", label: "Eligibility & source of funds", help: "The questions the selected route actually triggers." },
  { key: "ACCOUNT", label: "Create your account", help: "So the desk can pick the file up and you can track it." },
] as const;

export type GuidedStepKey = (typeof GUIDED_STEPS)[number]["key"];

// ───────────────────────────── intent ─────────────────────────────

/** The outcome a visitor says they want. Drives which families are shown. */
export const INTENTS = [
  {
    key: "CITIZENSHIP",
    label: "A second citizenship",
    help: "A passport, on a defined legal basis, usually over one to four years.",
    families: ["EU_CITIZENSHIP", "CARIBBEAN_CBI", "OTHER_CBI"] as ProgrammeFamily[],
  },
  {
    key: "RESIDENCE",
    label: "Residence in another country",
    help: "The right to live there, with citizenship as a later question.",
    families: ["EU_RESIDENCE", "MIDDLE_EAST", "NORTH_AMERICA"] as ProgrammeFamily[],
  },
  {
    key: "BUSINESS",
    label: "A business or banking base",
    help: "A company, an operating presence, or a bank relationship.",
    families: ["EU_RESIDENCE", "MIDDLE_EAST"] as ProgrammeFamily[],
  },
  {
    key: "ADVICE",
    label: "Advice before I commit",
    help: "An assessment of what I would actually qualify for.",
    families: [] as ProgrammeFamily[], // empty = the whole catalogue
  },
] as const;

export type IntentKey = (typeof INTENTS)[number]["key"];

export function intentByKey(key: string) {
  return INTENTS.find((i) => i.key === key);
}

/**
 * The routes a stated intent should surface. An empty `families` (the ADVICE
 * intent) means "no filter" — the visitor is explicitly undecided, so hiding
 * routes from them would be the wrong call.
 */
export function programmesForIntent(intent: string): Programme[] {
  const found = intentByKey(intent);
  if (!found || found.families.length === 0) return [...PROGRAMMES];
  const wanted = new Set<string>(found.families);
  return PROGRAMMES.filter((p) => wanted.has(p.family));
}

// ───────────────────────────── questions ─────────────────────────────

export type QuestionKind = "TEXT" | "NUMBER" | "CHOICE" | "COUNTRY" | "YES_NO";

export type Question = {
  key: string;
  label: string;
  help?: string;
  kind: QuestionKind;
  /** For CHOICE: the permitted values. */
  options?: readonly { value: string; label: string }[];
  required: boolean;
  /** Why this question is being asked — shown to the client, not just staff. */
  rationale: string;
};

/** Asked of everyone, before any programme-specific question. */
const CORE_QUESTIONS: readonly Question[] = [
  {
    key: "fullName", label: "Full name (as printed in your passport)", kind: "TEXT", required: true,
    rationale: "The name on your passport governs every document the authority will see.",
  },
  {
    key: "nationality", label: "Country of citizenship", kind: "COUNTRY", required: true,
    rationale: "Some routes are open only to non-EU nationals, and some only to EU/EFTA nationals.",
  },
  {
    key: "dateOfBirth", label: "Date of birth", kind: "TEXT", required: true,
    rationale: "Age thresholds apply to several routes, and children are counted separately.",
  },
  {
    key: "residenceCountry", label: "Country you currently live in", kind: "COUNTRY", required: true,
    rationale: "Where you live determines which authority processes the application and which documents must be certified where.",
  },
  {
    key: "familyMembers", label: "Family members applying with you", kind: "NUMBER", required: true,
    help: "Enter 0 if you are applying alone.",
    rationale: "Family inclusion changes the document set and the fee, and must be fixed before the file is opened.",
  },
];

/** Programme-specific questions, keyed to the rule that makes them necessary. */
const RULE_QUESTIONS: Record<string, Question> = {
  funds_min: {
    key: "availableFunds", label: "Capital you can evidence for this investment", kind: "NUMBER", required: true,
    help: "A planning figure in your currency's major unit. Not a commitment.",
    rationale: "This route has a minimum investment; the desk needs to know the gap before advising.",
  },
  nationality_zone: {
    key: "nationalityZone", label: "Are you an EU/EFTA national?", kind: "YES_NO", required: true,
    rationale: "This route treats EU/EFTA nationals differently from non-EU nationals.",
  },
  permit_required: {
    key: "currentPermit", label: "Your current residence permit in that country", kind: "CHOICE", required: true,
    options: [
      { value: "C", label: "Permanent (C permit)" },
      { value: "B_OR_C", label: "Temporary or permanent (B or C)" },
      { value: "NONE", label: "None" },
    ],
    rationale: "The permit you hold now changes whether a filing is even admissible.",
  },
  residence_years_min: {
    key: "yearsResident", label: "Years you have been resident there", kind: "NUMBER", required: true,
    rationale: "Naturalisation routes require a minimum period of prior residence.",
  },
  employment_months_min: {
    key: "employmentMonths", label: "Months of employment on the contract", kind: "NUMBER", required: true,
    rationale: "This route requires an existing employment relationship of a minimum length.",
  },
  must_not_work: {
    key: "willWorkLocally", label: "Do you intend to take local employment?", kind: "YES_NO", required: true,
    rationale: "Several residence permits prohibit local employment for the holder.",
  },
  residence_abroad_border: {
    key: "bordersResidence", label: "Do you hold residence in a bordering country?", kind: "YES_NO", required: true,
    rationale: "A licence for a border zone may substitute for residence in the destination.",
  },
};

/** Source-of-funds questions. Every filing route asks these. */
const SOF_QUESTIONS: readonly Question[] = [
  {
    key: "sourceOfFunds", label: "Where does the invested capital come from?", kind: "CHOICE", required: true,
    options: [
      { value: "SALE_OF_BUSINESS", label: "Sale of a business" },
      { value: "EMPLOYMENT_INCOME", label: "Employment or director income" },
      { value: "INVESTMENTS", label: "Investment gains" },
      { value: "INHERITANCE", label: "Inheritance or gift" },
      { value: "PROPERTY", label: "Sale of property" },
      { value: "OTHER", label: "Other — I will explain to the desk" },
    ],
    rationale: "Source of funds is a mandatory check on every filing route, not a question of our choosing.",
  },
  {
    key: "sourceOfWealth", label: "How was that wealth accumulated?", kind: "TEXT", required: false,
    help: "Two or three sentences is enough to start.",
    rationale: "Where the sum is large, the authority asks how the wealth was built, not only where the cash sits now.",
  },
];

/**
 * Every question the selected programme triggers, in the order a person should
 * answer them: who they are, whether they qualify, then where the money is.
 */
export function questionsForProgramme(key: string): Question[] {
  const p = programmeByKey(key);
  const out: Question[] = [...CORE_QUESTIONS];
  if (!p) return out;

  // One question per distinct rule kind the programme carries.
  const seen = new Set<string>();
  for (const rule of p.eligibility) {
    if (seen.has(rule.rule)) continue;
    seen.add(rule.rule);
    const q = RULE_QUESTIONS[rule.rule];
    if (q) out.push(q);
  }

  // Source of funds/wealth are triggered by the screening the programme pulls
  // in, so a route that does not trigger them is not asked about them.
  if (p.screening.includes("AML_SOF")) out.push(SOF_QUESTIONS[0]);
  if (p.screening.includes("AML_SOW")) out.push(SOF_QUESTIONS[1]);

  return out;
}

/** The screening checks a programme will actually run, for the client summary. */
export function screeningSummary(key: string): { key: string; label: string; purpose: string }[] {
  const p = programmeByKey(key);
  const required = SCREENING_CHECKS.filter((c) => c.required).map((c) => c.key);
  const all = [...new Set([...required, ...(p?.screening ?? [])])];
  return all
    .map((k) => SCREENING_CHECKS.find((c) => c.key === k))
    .filter((c): c is (typeof SCREENING_CHECKS)[number] => Boolean(c))
    .map((c) => ({ key: c.key, label: c.label, purpose: c.purpose }));
}

/** The documents a programme will require — so the client knows the burden. */
export function documentSummary(key: string): { key: string; label: string }[] {
  return requiredDocuments(key).map((d) => ({ key: d.key, label: d.label }));
}

// ───────────────────────────── scoring ─────────────────────────────

export type AnswerMap = Record<string, string>;

export type EligibilityVerdict = {
  /** "LIKELY" | "REVIEW" | "UNLIKELY" — never APPROVED/DECLINED. */
  verdict: "LIKELY" | "REVIEW" | "UNLIKELY";
  /** Plain-language reasons, each tied to a rule that produced it. */
  reasons: string[];
};

/**
 * A first-pass read on the answers. INDICATIVE ONLY — this routes a file to a
 * human and never decides an application. A "LIKELY" here is not an approval
 * and must never be presented as one.
 */
export function assessEligibility(key: string, answers: AnswerMap): EligibilityVerdict {
  const p = programmeByKey(key);
  if (!p) return { verdict: "REVIEW", reasons: ["That route is no longer in the catalogue."] };
  if (p.eligibility.length === 0) {
    return { verdict: "REVIEW", reasons: ["This is an advisory route with no fixed threshold — the desk will assess it."] };
  }

  const reasons: string[] = [];
  let unmet = 0;
  // Rules that could not be evaluated because their input was not answered.
  // Without this a visitor who has answered nothing would be told "LIKELY" —
  // the exact opposite of the module's "never an approval" contract.
  let unknown = 0;
  const has = (v: unknown) => String(v ?? "").trim() !== "";

  for (const rule of p.eligibility) {
    switch (rule.rule) {
      case "funds_min": {
        const stated = Number(answers.availableFunds);
        if (!has(answers.availableFunds) || !Number.isFinite(stated) || stated <= 0) {
          unknown += 1;
          reasons.push("Capital was not stated — the desk will confirm it.");
        } else if (stated < rule.chf) {
          unmet += 1;
          reasons.push(`The stated capital is below the indicative CHF ${rule.chf.toLocaleString("en-CH")} threshold for this route.`);
        } else {
          reasons.push("Stated capital meets the indicative threshold.");
        }
        break;
      }
      case "nationality_zone": {
        if (rule.zone === "ANY") break;
        if (!has(answers.nationalityZone)) {
          unknown += 1;
          break;
        }
        const isEu = answers.nationalityZone === "YES";
        if (rule.zone === "EU_EFTA" && !isEu) {
          unmet += 1;
          reasons.push("This route is restricted to EU/EFTA nationals.");
        } else if (rule.zone === "NON_EU" && isEu) {
          unmet += 1;
          reasons.push("This route is for non-EU nationals.");
        }
        break;
      }
      case "permit_required": {
        const held = answers.currentPermit;
        if (!has(held)) {
          unknown += 1;
          break;
        }
        if (rule.permit === "C" && held !== "C") {
          unmet += 1;
          reasons.push("A permanent (C) permit is expected first.");
        } else if (rule.permit === "B_OR_C" && held !== "C" && held !== "B_OR_C") {
          unmet += 1;
          reasons.push("A current residence permit is expected first.");
        }
        break;
      }
      case "residence_years_min": {
        if (!has(answers.yearsResident)) {
          unknown += 1;
          break;
        }
        const years = Number(answers.yearsResident);
        if (Number.isFinite(years) && years < rule.years) {
          unmet += 1;
          reasons.push(`${rule.years} years of prior residence are expected; ${years} stated.`);
        }
        break;
      }
      case "employment_months_min": {
        if (!has(answers.employmentMonths)) {
          unknown += 1;
          break;
        }
        const months = Number(answers.employmentMonths);
        if (Number.isFinite(months) && months < rule.months) {
          unmet += 1;
          reasons.push(`At least ${rule.months} months of employment are expected; ${months} stated.`);
        }
        break;
      }
      case "age_min": {
        const age = ageFrom(answers.dateOfBirth);
        if (age === null) {
          unknown += 1;
        } else if (age < rule.years) {
          unmet += 1;
          reasons.push(`Applicants must be at least ${rule.years}.`);
        }
        break;
      }
      case "age_max": {
        const age = ageFrom(answers.dateOfBirth);
        if (age === null) {
          unknown += 1;
        } else if (age > rule.years) {
          unmet += 1;
          reasons.push(`Applicants must be ${rule.years} or younger for this route.`);
        }
        break;
      }
      // Informational rules: they shape the desk's advice, not eligibility.
      case "must_not_work":
      case "residence_abroad_border":
        break;
    }
  }

  if (unmet > 0) return { verdict: "UNLIKELY", reasons };
  // A rule we could not evaluate is a question for the desk, not a "likely" —
  // an affirmative read requires every threshold rule to have been satisfied
  // against a stated answer.
  if (unknown > 0) {
    reasons.push("Some questions are still unanswered — the desk will assess the file.");
    return { verdict: "REVIEW", reasons };
  }
  return { verdict: "LIKELY", reasons };
}

/** Whole years from an ISO date, or null when unparseable. */
function ageFrom(iso: string | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - then.getFullYear();
  const m = now.getMonth() - then.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < then.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Which required questions are still unanswered — the "can I continue?" gate. */
export function missingRequired(key: string, answers: AnswerMap): string[] {
  return questionsForProgramme(key)
    .filter((q) => q.required && !String(answers[q.key] ?? "").trim())
    .map((q) => q.label);
}
