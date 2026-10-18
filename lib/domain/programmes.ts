/**
 * Programme research — the real residence/citizenship-by-investment market.
 *
 * The desk's dropdown, the client-facing requirements list and the document
 * request generator all read from here. Adding a jurisdiction is a DATA edit.
 *
 * ACCURACY CONTRACT — read this before changing a number:
 *   • `minInvestment` and `processingWeeks` are INDICATIVE planning figures for
 *     internal scoping, not legal advice and not a quotation. Investment
 *     thresholds for these programmes change by regulation and are frequently
 *     revised; `reviewedOn` records when the figure was last checked.
 *   • `requirements` names the documents and checks a programme normally
 *     demands. The authority's actual checklist governs — the point of the
 *     model is that a case cannot be opened without resolving every item, not
 *     that this file replaces the authority's own list.
 *   • Anything a client could rely on must be confirmed in the engagement
 *     letter against the current official source.
 *
 * Prisma-free and side-effect-free, so it is importable from server and client
 * modules and unit-testable.
 */
import { DOCUMENT_CATALOG, SCREENING_CHECKS, canonicalDocumentKey, type DocumentSpec } from "@/lib/domain/lifecycle";

/** Programme families, used for grouping in the picker and reporting. */
export const PROGRAMME_FAMILIES = [
  "EU_RESIDENCE",
  "EU_CITIZENSHIP",
  "CARIBBEAN_CBI",
  "OTHER_CBI",
  "MIDDLE_EAST",
  "ASIA_PACIFIC",
  /** Ancillary services (SVC_*) and investment lines (INV_*) — engagements that
   *  are neither a residence nor a citizenship route. */
  "SERVICES",
] as const;
export type ProgrammeFamily = (typeof PROGRAMME_FAMILIES)[number];

export type Programme = {
  key: string;
  label: string;
  /** ISO 3166-1 alpha-2, or "EU" for a bloc-level route. */
  country: string;
  family: ProgrammeFamily;
  kind: "RESIDENCE" | "CITIZENSHIP";
  summary: string;
  /** Indicative investment in `currency`; 0 when not investment-based. */
  minInvestment: number;
  currency: string;
  /** Indicative authority processing time in weeks. */
  processingWeeks: number;
  /** Minimum physical-presence expectation, in days per cycle (0 = none). */
  minimumStayDaysPerYear: number;
  /** Family members normally includable in one application. */
  familyInclusion: "NONE" | "SPOUSE" | "SPOUSE_CHILDREN" | "SPOUSE_CHILDREN_PARENTS";
  /** Does the route lead to citizenship, and on what footing? */
  citizenshipPath: "NONE" | "AFTER_RESIDENCE_PERIOD" | "DIRECT";
  /** Document keys (from DOCUMENT_CATALOG) this programme requires. */
  requirements: readonly string[];
  /** Screening keys (from SCREENING_CHECKS) this programme adds. */
  screening: readonly string[];
  /** Who decides — drives the dispatch address and the follow-up target. */
  authority: string;
  /** Date the figures above were last checked (ISO). */
  reviewedOn: string;
  /**
   * Indicative professional fee in CHF, whole units. 0 = quoted per engagement.
   * Distinct from `minInvestment`, which is the CLIENT's capital.
   */
  feeChf: number;
  /** 1 (routine) .. 5 (highly bespoke). Drives triage complexity weighting. */
  complexity: 1 | 2 | 3 | 4 | 5;
  /** Statutory basis, stated plainly — shown on the public catalogue. */
  legalBasis: string;
  /**
   * Machine-evaluable eligibility rules. INDICATIVE SCREENING ONLY: a verdict
   * routes a file to a human, it never decides an application. Every programme
   * that is not advisory carries at least one rule.
   */
  eligibility: readonly EligibilityRule[];
  /** Points an RM must weigh that no rule can decide. */
  watchFactors: readonly string[];
};

/**
 * A single machine-checkable eligibility condition. Deliberately coarse: the
 * pre-scan answers "is this worth a human's time now?", not "will it succeed?".
 */
export type EligibilityRule =
  | { rule: "nationality_zone"; zone: "EU_EFTA" | "NON_EU" | "ANY" }
  | { rule: "funds_min"; chf: number }
  | { rule: "age_min"; years: number }
  | { rule: "age_max"; years: number }
  | { rule: "permit_required"; permit: "C" | "B_OR_C" | "NONE" }
  | { rule: "residence_years_min"; years: number }
  | { rule: "employment_months_min"; months: number }
  | { rule: "must_not_work"; value: boolean }
  | { rule: "residence_abroad_border"; value: boolean };

/**
 * Starter requirement sets, composed into each programme so a common core is
 * not retyped per jurisdiction.
 */
const CORE_IDENTITY: readonly string[] = ["PASSPORT", "NATIONAL_ID", "BIRTH_CERTIFICATE", "POLICE_RECORD", "PROOF_OF_ADDRESS"];
const CORE_FINANCIAL: readonly string[] = ["BANK_STATEMENT", "SOURCE_OF_FUNDS_EVIDENCE"];
const CORPORATE_SET: readonly string[] = ["CERTIFICATE_OF_REGISTRATION", "ARTICLES_OF_ASSOCIATION", "SHAREHOLDER_REGISTER"];

/**
 * The researched catalogue. Thresholds and timelines are indicative planning
 * figures (see the ACCURACY CONTRACT above).
 */
export const PROGRAMMES: readonly Programme[] = [
  // ── EU residence ──────────────────────────────────────────────────────────
  {
    key: "PT_GOLDEN", label: "Portugal — Residence by Investment", country: "PT", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Residence through a qualifying investment fund; the headline route to an EU passport on a long horizon.",
    minInvestment: 500_000, currency: "EUR", processingWeeks: 24, minimumStayDaysPerYear: 7,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "TAX_RECORD", "HEALTH_INSURANCE"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "AIMA (Agência para a Integração, Migrações e Asilo)", reviewedOn: "2026-10-06",
    feeChf: 30000,
    complexity: 4,
    legalBasis: "Lei n.º 23/2007, Art. 90-A — residence by investment (Golden Visa)",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 400000 },
    ],
    watchFactors: [
      "The real-estate route was withdrawn — funds, business and cultural routes remain.",
      "Minimal stay satisfies the requirement, but the funds must stay invested for the permit's life.",
    ],
  },
  {
    key: "DE_RESIDENCE_BUSINESS", label: "Germany — Residence by Business Investment", country: "DE", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Residence tied to a viable German operating entity; the business plan is the decisive document.",
    minInvestment: 250_000, currency: "EUR", processingWeeks: 16, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, ...CORPORATE_SET, "CURRICULUM_VITAE", "HEALTH_INSURANCE"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Ausländerbehörde (local foreigners authority)", reviewedOn: "2026-10-06",
    feeChf: 32000,
    complexity: 4,
    legalBasis: "Aufenthaltsgesetz §21 — residence permit for self-employment",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 250000 },
      { rule: "nationality_zone", zone: "ANY" },
    ],
    watchFactors: [
      "The economic viability of the plan is judged, not the investment size alone.",
      "The permit is initially temporary — permanence follows sustained operation of the entity.",
    ],
  },
  {
    key: "DE_BLUE_CARD", label: "Germany — EU Blue Card", country: "DE", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Employer-sponsored route for recognised qualifications; the fastest German residence path when eligible.",
    minInvestment: 0, currency: "EUR", processingWeeks: 10, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, "CURRICULUM_VITAE", "HEALTH_INSURANCE", "TAX_RECORD"], screening: [],
    authority: "Bundesagentur für Arbeit / Ausländerbehörde", reviewedOn: "2026-10-06",
    feeChf: 14000,
    complexity: 2,
    legalBasis: "Aufenthaltsgesetz §18b / EU Directive 2021/1883 — EU Blue Card",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "employment_months_min", months: 12 },
    ],
    watchFactors: [
      "A recognised qualification and a salary above the annual threshold are both required.",
      "It is employer-tied: the permit follows the job, not the applicant.",
    ],
  },
  {
    key: "AT_RESIDENCE", label: "Austria — Residence Permit", country: "AT", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Red-white-red card and settlement routes; strict points-based assessment for the skilled route.",
    minInvestment: 100_000, currency: "EUR", processingWeeks: 14, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "HEALTH_INSURANCE", "CURRICULUM_VITAE"], screening: ["AML_SOW"],
    authority: "Österreichische Aufenthaltsbehörde (MA 35 in Vienna)", reviewedOn: "2026-10-06",
    feeChf: 26000,
    complexity: 4,
    legalBasis: "Settlement and Residence Act (NAG) — settlement permit for financially independent persons",
    eligibility: [
      { rule: "nationality_zone", zone: "NON_EU" },
      { rule: "funds_min", chf: 250000 },
      { rule: "age_min", years: 18 },
      { rule: "must_not_work", value: true },
    ],
    watchFactors: [
      "Provincial quotas, not eligibility, are the usual bottleneck.",
      "Employment is not permitted under this specific route.",
    ],
  },
  {
    key: "CH_LUMP_SUM", label: "Switzerland — Lump-sum Taxation", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Cantonal negotiated tax arrangement bundled with a residence permit; not available in every canton.",
    minInvestment: 0, currency: "CHF", processingWeeks: 20, minimumStayDaysPerYear: 90,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "TAX_RECORD", "HEALTH_INSURANCE"], screening: ["AML_SOW", "TAX_COMPLIANCE", "BANK_VERIFY"],
    authority: "Kantonales Migrationsamt", reviewedOn: "2026-10-06",
    feeChf: 45000,
    complexity: 5,
    legalBasis: "Federal and cantonal tax law — lump-sum (forfait) taxation for foreign nationals not gainfully employed in Switzerland",
    eligibility: [
      { rule: "nationality_zone", zone: "NON_EU" },
      { rule: "funds_min", chf: 2000000 },
      { rule: "age_min", years: 18 },
      { rule: "must_not_work", value: true },
    ],
    watchFactors: [
      "Not permitted to work in Switzerland — this is the defining condition of the route.",
      "The canton negotiates a minimum tax base; the ruling, not the headline, governs the outcome.",
    ],
  },
  {
    key: "ES_GOLDEN", label: "Spain — Residence by Investment", country: "ES", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Residence via qualifying real estate or capital investment in a Spanish business.",
    minInvestment: 500_000, currency: "EUR", processingWeeks: 20, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "PROOF_OF_ADDRESS", "HEALTH_INSURANCE", "TAX_RECORD"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Unidad de Grandes Empresas y Colectivos Estratégicos (UGE)", reviewedOn: "2026-10-06",
    feeChf: 30000,
    complexity: 3,
    legalBasis: "Ley 14/2013 — residence for investors (Golden Visa)",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 500000 },
    ],
    watchFactors: [
      "Minimal stay is required, but the investment must be maintained for the permit's life.",
      "Programme terms have been subject to legislative debate — confirm the current position before filing.",
    ],
  },
  {
    key: "AM_RESIDENCE", label: "Armenia — Residence by Investment", country: "AM", family: "OTHER_CBI", kind: "RESIDENCE",
    summary: "Residence through business formation and real local substance — a fast, low-threshold foothold with a route to permanence.",
    minInvestment: 0, currency: "CHF", processingWeeks: 8, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, ...CORPORATE_SET, "CURRICULUM_VITAE", "HEALTH_INSURANCE"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Armenian Migration and Citizenship Service", reviewedOn: "2026-10-06",
    feeChf: 18000,
    complexity: 3,
    legalBasis: "Law of the Republic of Armenia on the Legal Status of Foreign Citizens — temporary and permanent residence",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 50000 },
    ],
    watchFactors: [
      "No fixed statutory investment sum: qualifying turns on a viable registered entity and demonstrable operational substance, which the desk documents rather than assumes.",
      "The route leads to permanent residence, not citizenship — naturalisation is a separate, longer track with its own language and residence tests.",
      "Correspondent-banking and sanctions exposure make the source-of-funds file the decisive document; banks here scrutinise it closely.",
    ],
  },
  {
    key: "SK_RESIDENCE", label: "Slovakia — Residence by Business", country: "SK", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Business-formation residence in the heart of Central Europe — substance-first files the desk prepares end to end.",
    minInvestment: 0, currency: "EUR", processingWeeks: 12, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, ...CORPORATE_SET, "CURRICULUM_VITAE", "HEALTH_INSURANCE", "TAX_RECORD"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Slovak Foreign Police (Cudzinecká polícia)", reviewedOn: "2026-10-06",
    feeChf: 22000,
    complexity: 3,
    legalBasis: "Act No. 404/2011 Coll. on the Residence of Foreigners — temporary residence for business purposes",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 40000 },
      { rule: "nationality_zone", zone: "ANY" },
    ],
    watchFactors: [
      "Approval is discretionary and turns on genuine economic substance — a shell company without local activity is routinely refused.",
      "Slovak files are document-heavy and appointment-gated; the Foreign Police calendar, not our preparation, usually sets the timeline.",
      "Schengen residence is granted in renewable increments before any permanent status — plan for the renewal cycle, not a single filing.",
    ],
  },
  {
    key: "SI_RESIDENCE", label: "Slovenia — Residence by Business", country: "SI", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Business residence with real local substance — Alpine base, Schengen access, family reunification.",
    minInvestment: 0, currency: "EUR", processingWeeks: 12, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, ...CORPORATE_SET, "CURRICULUM_VITAE", "HEALTH_INSURANCE", "TAX_RECORD"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Upravna enota (Slovenian Administrative Unit)", reviewedOn: "2026-10-06",
    feeChf: 22000,
    complexity: 3,
    legalBasis: "Aliens Act (Zakon o tujcih, ZTuj-2) — temporary residence for business and employment purposes",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 40000 },
      { rule: "nationality_zone", zone: "ANY" },
    ],
    watchFactors: [
      "Registration of the entity and the residence application are sequential — the company must exist and trade before the permit is assessed.",
      "Non-EU/EFTA applicants can face a labour-market test, which adds months without warning.",
      "Slovenian language and integration conditions attach to permanent residence and citizenship, not to the first permit.",
    ],
  },
  {
    key: "US_EB5", label: "USA — EB-5 Immigrant Investor Residence", country: "US", family: "OTHER_CBI", kind: "RESIDENCE",
    summary: "Conditional green card through qualifying job-creating investment via vetted regional centres — family included.",
    minInvestment: 800_000, currency: "USD", processingWeeks: 96, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "CURRICULUM_VITAE", "TAX_RECORD", "MEDICAL_CERTIFICATE"], screening: ["AML_SOW", "AML_SOF", "BANK_VERIFY", "PEP", "SANCTIONS", "ADVERSE_MEDIA"],
    authority: "USCIS — Immigrant Investor Program Office", reviewedOn: "2026-10-06",
    feeChf: 90000,
    complexity: 5,
    legalBasis: "Immigration and Nationality Act §203(b)(5), as amended by the EB-5 Reform and Integrity Act of 2022",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 700000 },
      { rule: "nationality_zone", zone: "ANY" },
    ],
    watchFactors: [
      "The investment must create ten full-time jobs for qualifying US workers — a condition on the business, not the investor, and the usual reason files fail at removal of conditions.",
      "The reduced threshold applies only to targeted employment areas or infrastructure projects; the standard minimum is materially higher.",
      "Status is conditional for two years, after which a separate I-829 petition must be approved before permanent residence vests.",
      "Source-of-funds scrutiny is the most forensic in this catalogue — every link in the capital chain must be lawfully traceable and documented.",
      "Visa-bulletin retrogression can delay issuance for years after petition approval, independently of the merits of the filing.",
    ],
  },
  {
    key: "GR_GOLDEN", label: "Greece — Residence by Investment", country: "GR", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Residence through qualifying real estate; tiered thresholds apply by location and property type.",
    minInvestment: 250_000, currency: "EUR", processingWeeks: 22, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "PROOF_OF_ADDRESS", "HEALTH_INSURANCE"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Greek Ministry of Migration and Asylum", reviewedOn: "2026-10-06",
    feeChf: 30000,
    complexity: 3,
    legalBasis: "Law 5038/2023 (formerly 4251/2014) — permanent residence by investment",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 250000 },
    ],
    watchFactors: [
      "Thresholds are tiered by location and property type — the location drives the qualifying sum.",
      "Minimal stay required, but the property must be maintained and declared.",
    ],
  },
  {
    key: "IT_INVESTOR", label: "Italy — Investor Visa", country: "IT", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Investor visa for a qualifying injection into an Italian company, fund, or philanthropic venture.",
    minInvestment: 250_000, currency: "EUR", processingWeeks: 18, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "SOURCE_OF_FUNDS_EVIDENCE", "TAX_RECORD", "HEALTH_INSURANCE"], screening: ["AML_SOW", "AML_SOF", "BANK_VERIFY"],
    authority: "Ministero degli Affari Esteri — Investor Visa Committee", reviewedOn: "2026-10-06",
    feeChf: 36000,
    complexity: 4,
    legalBasis: "Article 26-bis, Consolidated Immigration Act — investor visa and residence",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 250000 },
    ],
    watchFactors: [
      "The investment must be genuinely maintained — the route depends on it, not on presence.",
      "The nulla osta from the investor visa committee precedes the visa, and is the usual source of delay.",
    ],
  },

  // ── EU citizenship ────────────────────────────────────────────────────────
  {
    key: "MT_CITIZENSHIP_MEIN", label: "Malta — Citizenship by Naturalisation (MEIN)", country: "MT", family: "EU_CITIZENSHIP", kind: "CITIZENSHIP",
    summary: "Citizenship by exceptional investment, gated by a residency period and a strict due-diligence file.",
    minInvestment: 600_000, currency: "EUR", processingWeeks: 36, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "BIRTH_CERTIFICATE", "MARRIAGE_CERTIFICATE", "TAX_RECORD", "MEDICAL_CERTIFICATE", "HEALTH_INSURANCE", "POWER_OF_ATTORNEY"],
    screening: ["AML_SOW", "AML_SOF", "TAX_COMPLIANCE", "BANK_VERIFY", "ADVERSE_MEDIA", "PEP"],
    authority: "Community Malta Agency (formerly ORiip)", reviewedOn: "2026-10-06",
    feeChf: 1150000,
    complexity: 5,
    legalBasis: "Maltese Citizenship Act, Regulation 10 — exceptional services by direct investment",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 1500000 },
      { rule: "residence_years_min", years: 1 },
    ],
    watchFactors: [
      "Subject to the current regulatory framework — quotas and thresholds move by amendment.",
      "Physical-presence and source-of-wealth evidence are the usual failure points, not the investment.",
    ],
  },
  {
    key: "CY_PERMANENT", label: "Cyprus — Permanent Residence", country: "CY", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Permanent residence through qualifying investment plus a secure annual income requirement.",
    minInvestment: 300_000, currency: "EUR", processingWeeks: 26, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "TAX_RECORD", "PROOF_OF_ADDRESS", "HEALTH_INSURANCE"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Civil Registry and Migration Department", reviewedOn: "2026-10-06",
    feeChf: 34000,
    complexity: 3,
    legalBasis: "Regulation 6(2) — permanent residence by investment (Category F)",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 300000 },
    ],
    watchFactors: [
      "The secure annual income must be demonstrably sourced outside Cyprus.",
      "Permanent residence does not by itself confer Schengen mobility.",
    ],
  },

  // ── Caribbean CBI ─────────────────────────────────────────────────────────
  {
    key: "KN_CBI", label: "St Kitts & Nevis — Citizenship by Investment", country: "KN", family: "CARIBBEAN_CBI", kind: "CITIZENSHIP",
    summary: "The longest-established CBI programme; contribution or approved real-estate route.",
    minInvestment: 250_000, currency: "USD", processingWeeks: 16, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MARRIAGE_CERTIFICATE", "MEDICAL_CERTIFICATE", "POWER_OF_ATTORNEY"],
    screening: ["AML_SOF", "AML_SOW", "ADVERSE_MEDIA", "PEP"], authority: "St Kitts & Nevis CIU", reviewedOn: "2026-10-06",
    feeChf: 32000,
    complexity: 3,
    legalBasis: "Saint Christopher and Nevis Citizenship Act 1984, Part II",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 230000 },
    ],
    watchFactors: [
      "The longest-established programme — enhanced due diligence is standard, not exceptional.",
      "Contribution and real-estate routes carry different holding periods and resale restrictions.",
    ],
  },
  {
    key: "DM_CBI", label: "Dominica — Citizenship by Investment", country: "DM", family: "CARIBBEAN_CBI", kind: "CITIZENSHIP",
    summary: "Economic Diversification Fund contribution or approved real estate; long-standing programme.",
    minInvestment: 200_000, currency: "USD", processingWeeks: 18, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MARRIAGE_CERTIFICATE", "MEDICAL_CERTIFICATE", "POWER_OF_ATTORNEY"],
    screening: ["AML_SOF", "AML_SOW", "ADVERSE_MEDIA", "PEP"], authority: "Dominica Citizenship by Investment Unit", reviewedOn: "2026-10-06",
    feeChf: 28000,
    complexity: 3,
    legalBasis: "Dominica Citizenship by Investment Act 1991 (as amended)",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 190000 },
    ],
    watchFactors: [
      "One of the lowest contribution thresholds — diligence is correspondingly thorough.",
      "Dependants over the standard age bands require a higher contribution.",
    ],
  },
  {
    key: "GD_CBI", label: "Grenada — Citizenship by Investment", country: "GD", family: "CARIBBEAN_CBI", kind: "CITIZENSHIP",
    summary: "CBI with a US E-2 treaty route, which makes it the usual choice where US business access matters.",
    minInvestment: 235_000, currency: "USD", processingWeeks: 18, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MARRIAGE_CERTIFICATE", "MEDICAL_CERTIFICATE", "POWER_OF_ATTORNEY"],
    screening: ["AML_SOF", "AML_SOW", "ADVERSE_MEDIA", "PEP"], authority: "Grenada Citizenship by Investment Committee", reviewedOn: "2026-10-06",
    feeChf: 30000,
    complexity: 3,
    legalBasis: "Grenada Citizenship by Investment Act 2013",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 220000 },
    ],
    watchFactors: [
      "Grenada's E-2 treaty access is the usual reason it is chosen where US business access matters.",
      "The E-2 itself is a separate US filing with its own conditions.",
    ],
  },
  {
    key: "AG_CBI", label: "Antigua & Barbuda — Citizenship by Investment", country: "AG", family: "CARIBBEAN_CBI", kind: "CITIZENSHIP",
    summary: "Contribution or real-estate route carrying a minimum physical-presence expectation.",
    minInvestment: 230_000, currency: "USD", processingWeeks: 20, minimumStayDaysPerYear: 5,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MARRIAGE_CERTIFICATE", "MEDICAL_CERTIFICATE", "POWER_OF_ATTORNEY", "CURRICULUM_VITAE"],
    screening: ["AML_SOF", "AML_SOW", "ADVERSE_MEDIA", "PEP"], authority: "Antigua & Barbuda CIU", reviewedOn: "2026-10-06",
    feeChf: 28000,
    complexity: 3,
    legalBasis: "Citizenship by Investment Act 2013 (Antigua & Barbuda)",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 200000 },
    ],
    watchFactors: [
      "Carries a minimum physical-presence expectation of five days in the first five years.",
      "Visa-free access is subject to change and is never promised as permanent.",
    ],
  },
  {
    key: "LC_CBI", label: "St Lucia — Citizenship by Investment", country: "LC", family: "CARIBBEAN_CBI", kind: "CITIZENSHIP",
    summary: "Contribution, real estate, enterprise, or government-bond route.",
    minInvestment: 240_000, currency: "USD", processingWeeks: 18, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MARRIAGE_CERTIFICATE", "MEDICAL_CERTIFICATE", "POWER_OF_ATTORNEY"],
    screening: ["AML_SOF", "AML_SOW", "ADVERSE_MEDIA", "PEP"], authority: "St Lucia Citizenship by Investment Unit", reviewedOn: "2026-10-06",
    feeChf: 28000,
    complexity: 3,
    legalBasis: "Saint Lucia Citizenship by Investment Act 2015",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 210000 },
    ],
    watchFactors: [
      "Four distinct routes (contribution, real estate, enterprise, bonds) with different economics.",
      "Real-estate resale is restricted until the holding period elapses.",
    ],
  },

  // ── Other CBI ─────────────────────────────────────────────────────────────
  {
    key: "TR_CBI", label: "Türkiye — Citizenship by Investment", country: "TR", family: "OTHER_CBI", kind: "CITIZENSHIP",
    summary: "Citizenship through qualifying real estate or capital investment; a fast, high-volume programme.",
    minInvestment: 400_000, currency: "USD", processingWeeks: 20, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MARRIAGE_CERTIFICATE", "MEDICAL_CERTIFICATE", "POWER_OF_ATTORNEY"],
    screening: ["AML_SOF", "ADVERSE_MEDIA"], authority: "Göç İdaresi / Directorate of Citizenship", reviewedOn: "2026-10-06",
    feeChf: 22000,
    complexity: 3,
    legalBasis: "Turkish Citizenship Law No. 5901, Art. 12 — exceptional acquisition",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 400000 },
    ],
    watchFactors: [
      "A high-volume programme: thresholds and hold periods are revised periodically.",
      "The three-year hold is enforced against the title deed or the capital placement.",
    ],
  },
  {
    key: "VU_CBI", label: "Vanuatu — Citizenship by Investment", country: "VU", family: "OTHER_CBI", kind: "CITIZENSHIP",
    summary: "One of the fastest citizenship routes by contribution; note the varying visa-free access profile.",
    minInvestment: 130_000, currency: "USD", processingWeeks: 8, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MARRIAGE_CERTIFICATE", "MEDICAL_CERTIFICATE", "POWER_OF_ATTORNEY"],
    screening: ["AML_SOF", "ADVERSE_MEDIA"], authority: "Vanuatu Citizenship Commission", reviewedOn: "2026-10-06",
    feeChf: 130000,
    complexity: 2,
    legalBasis: "Vanuatu Citizenship Act [CAP 112] — Development Support Programme",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 150000 },
    ],
    watchFactors: [
      "Among the fastest routes — speed is the headline.",
      "Visa-free access has been reduced and varies; durable travel access is not guaranteed.",
    ],
  },
  {
    key: "EG_CBI", label: "Egypt — Citizenship by Investment", country: "EG", family: "OTHER_CBI", kind: "CITIZENSHIP",
    summary: "Citizenship through a qualifying deposit, real estate, or business investment.",
    minInvestment: 250_000, currency: "USD", processingWeeks: 24, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MARRIAGE_CERTIFICATE", "MEDICAL_CERTIFICATE", "POWER_OF_ATTORNEY"],
    screening: ["AML_SOF", "ADVERSE_MEDIA"], authority: "Egyptian Cabinet / Ministry of Interior", reviewedOn: "2026-10-06",
    feeChf: 26000,
    complexity: 3,
    legalBasis: "Egyptian Nationality Law — exceptional grant by the Cabinet",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 250000 },
    ],
    watchFactors: [
      "Granted by Cabinet decision, so timing is administrative rather than fixed.",
      "Deposit, real estate and business routes are priced separately.",
    ],
  },
  {
    key: "JO_CBI", label: "Jordan — Citizenship by Investment", country: "JO", family: "OTHER_CBI", kind: "CITIZENSHIP",
    summary: "Citizenship through qualifying investment, deposit, or government bond purchase.",
    minInvestment: 1_000_000, currency: "USD", processingWeeks: 26, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MARRIAGE_CERTIFICATE", "MEDICAL_CERTIFICATE", "POWER_OF_ATTORNEY"],
    screening: ["AML_SOF", "AML_SOW", "ADVERSE_MEDIA"], authority: "Jordanian Ministry of Interior", reviewedOn: "2026-10-06",
    feeChf: 60000,
    complexity: 4,
    legalBasis: "Jordanian Nationality Law — investment-based grant",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 900000 },
    ],
    watchFactors: [
      "The highest headline threshold of the investment-citizenship market.",
      "Bond and deposit routes have long lock-in periods.",
    ],
  },

  // ── Middle East ───────────────────────────────────────────────────────────
  {
    key: "AE_GOLDEN", label: "United Arab Emirates — Golden Visa", country: "AE", family: "MIDDLE_EAST", kind: "RESIDENCE",
    summary: "Long-term renewable residence for investors, entrepreneurs, and specialised talent.",
    minInvestment: 2_000_000, currency: "AED", processingWeeks: 6, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "NONE",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MEDICAL_CERTIFICATE", "PROOF_OF_ADDRESS", "CURRICULUM_VITAE"], screening: ["AML_SOF", "BANK_VERIFY"],
    authority: "Federal Authority for Identity, Citizenship, Customs & Port Security (ICP)", reviewedOn: "2026-10-06",
    feeChf: 20000,
    complexity: 2,
    legalBasis: "UAE Cabinet Resolutions on Golden Residence; free-zone company regulations",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 450000 },
    ],
    watchFactors: [
      "Long-term renewable residence for investors and founders — not a route to citizenship.",
      "Free-zone licensing rules and eligibility categories evolve; verify before filing.",
    ],
  },

  // ── Asia-Pacific ──────────────────────────────────────────────────────────
  {
    key: "MY_MM2H", label: "Malaysia — Malaysia My Second Home", country: "MY", family: "ASIA_PACIFIC", kind: "RESIDENCE",
    summary: "Long-stay residence for retirees and families meeting fixed-deposit and income criteria.",
    minInvestment: 150_000, currency: "USD", processingWeeks: 18, minimumStayDaysPerYear: 90,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "NONE",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "MEDICAL_CERTIFICATE", "HEALTH_INSURANCE", "POLICE_RECORD"], screening: ["AML_SOF", "BANK_VERIFY"],
    authority: "Ministry of Tourism, Arts and Culture (MM2H Secretariat)", reviewedOn: "2026-10-06",
    feeChf: 12000,
    complexity: 3,
    legalBasis: "Malaysia My Second Home Programme — Ministry of Tourism, Arts and Culture",
    eligibility: [
      { rule: "age_min", years: 35 },
      { rule: "funds_min", chf: 130000 },
      { rule: "residence_abroad_border", value: false },
    ],
    watchFactors: [
      "Fixed-deposit and income criteria are tiered by applicant age band.",
      "A minimum physical-presence expectation applies to maintain the pass.",
    ],
  },
  {
    key: "TH_LTR", label: "Thailand — Long-Term Resident Visa", country: "TH", family: "ASIA_PACIFIC", kind: "RESIDENCE",
    summary: "Ten-year residence for wealthy residents, pensioners, and remote professionals.",
    minInvestment: 1_000_000, currency: "USD", processingWeeks: 12, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "NONE",
    requirements: [...CORE_IDENTITY, ...CORE_FINANCIAL, "HEALTH_INSURANCE", "TAX_RECORD"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Board of Investment (BOI)", reviewedOn: "2026-10-06",
    feeChf: 16000,
    complexity: 4,
    legalBasis: "Thailand Long-Term Resident Visa — Board of Investment (BOI)",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 800000 },
    ],
    watchFactors: [
      "Wealthy-resident, pensioner and remote-professional categories each carry their own tests.",
      "Income and insurance thresholds are re-set periodically by BOI announcement.",
    ],
  },
  // ── Switzerland — the private-office practice ─────────────────────────────
  // Source: SEM (Staatssekretariat für Migration) official pages + Fedlex
  // (SR 142.20 ANAG/VZAE, SR 141.0 BüG, SR 211.412.41 BewG), verified Oct 2025.
  // These routes are procedural rather than investment-priced, so `minInvestment`
  // is 0 and the constraint is residence years, permit class or employment.
  {
    key: "CH_PERMIT_B_EU", label: "Switzerland — Residence Permit B (EU/EFTA)", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Residence permit B for EU/EFTA nationals under the Free Movement Agreement, on an employment contract or proven financial independence.",
    minInvestment: 0, currency: "CHF", processingWeeks: 8, minimumStayDaysPerYear: 183,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, "PROOF_OF_ADDRESS", "HEALTH_INSURANCE", "TAX_RECORD"], screening: ["AML_SOF"],
    authority: "Kantonales Migrationsamt with SEM (Bundesamt für Migration)", reviewedOn: "2026-10-06",
    feeChf: 9000,
    complexity: 2,
    legalBasis: "ANAG / VZAE — Free Movement Agreement (FZA); residence permit B for EU/EFTA nationals",
    eligibility: [
      { rule: "nationality_zone", zone: "EU_EFTA" },
      { rule: "age_min", years: 18 },
    ],
    watchFactors: [
      "Anmeldung at the Kreisbüro is required within 14 days of arrival.",
      "Health insurance under the KVG must be arranged within 3 months.",
    ],
  },
  {
    key: "CH_PERMIT_B_NON_EU", label: "Switzerland — Residence Permit B (Non-EU/EFTA)", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Residence permit B for qualified non-EU/EFTA workers, admitted within the annual federal quota and requiring a cantonal authorisation.",
    minInvestment: 0, currency: "CHF", processingWeeks: 20, minimumStayDaysPerYear: 183,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, "CURRICULUM_VITAE", "PROOF_OF_ADDRESS", "HEALTH_INSURANCE", "TAX_RECORD"], screening: ["AML_SOF", "AML_SOW"],
    authority: "Kantonales Migrationsamt with SEM federal approval", reviewedOn: "2026-10-06",
    feeChf: 16000,
    complexity: 4,
    legalBasis: "ANAG Art. 21 / VZAE — admission of qualified non-EU/EFTA workers within the annual federal quota",
    eligibility: [
      { rule: "nationality_zone", zone: "NON_EU" },
      { rule: "age_min", years: 18 },
      { rule: "employment_months_min", months: 12 },
    ],
    watchFactors: [
      "Quotas are annual and limited — timing, not merit, is the binding constraint.",
      "Only senior or genuinely specialised roles qualify for a quota slot.",
    ],
  },
  {
    key: "CH_PERMIT_C", label: "Switzerland — Settlement Permit C", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Settlement permit C after continuous residence, subject to integration, language and independence from social assistance.",
    minInvestment: 0, currency: "CHF", processingWeeks: 12, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, "PROOF_OF_ADDRESS", "TAX_RECORD", "POLICE_RECORD"], screening: ["AML_SOF", "TAX_COMPLIANCE", "CRIMINAL_RECORD"],
    authority: "Kantonales Migrationsamt with SEM confirmation", reviewedOn: "2026-10-06",
    feeChf: 6000,
    complexity: 3,
    legalBasis: "ANAG Art. 34 — settlement permit (Niederlassungsbewilligung) after continuous residence",
    eligibility: [
      { rule: "residence_years_min", years: 10 },
      { rule: "permit_required", permit: "B_OR_C" },
    ],
    watchFactors: [
      "EU/EFTA nationals may qualify after 5 years under the free-movement rules instead.",
      "Integration, language and no-welfare-dependency are all assessed, not just the years.",
    ],
  },
  {
    key: "CH_PERMIT_L", label: "Switzerland — Short-Stay Permit L", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Short-stay permit L for a determined, finite purpose such as an assignment, training or project posting.",
    minInvestment: 0, currency: "CHF", processingWeeks: 4, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: [...CORE_IDENTITY, "PROOF_OF_ADDRESS", "HEALTH_INSURANCE"], screening: [],
    authority: "Kantonales Migrationsamt", reviewedOn: "2026-10-06",
    feeChf: 5000,
    complexity: 1,
    legalBasis: "ANAG Art. 32 — short-stay permit for a determined purpose and limited period",
    eligibility: [
      { rule: "age_min", years: 18 },
    ],
    watchFactors: [
      "Strictly time-limited: it does not itself build toward settlement.",
      "The purpose must be evidenced and finite at the time of application.",
    ],
  },
  {
    key: "CH_PERMIT_G", label: "Switzerland — Cross-Border Commuter Permit G", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Border-crossing commuter permit G for EU/EFTA nationals resident in a neighbouring state's border zone who work in Switzerland.",
    minInvestment: 0, currency: "CHF", processingWeeks: 6, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: [...CORE_IDENTITY, "PROOF_OF_ADDRESS", "TAX_RECORD"], screening: [],
    authority: "Kantonales Migrationsamt (border-zone authority)", reviewedOn: "2026-10-06",
    feeChf: 4000,
    complexity: 2,
    legalBasis: "ANAG Art. 30 / VZAE — border-crossing commuter permit (Grenzgängerbewilligung)",
    eligibility: [
      { rule: "nationality_zone", zone: "EU_EFTA" },
      { rule: "residence_abroad_border", value: true },
      { rule: "employment_months_min", months: 3 },
    ],
    watchFactors: [
      "The applicant must actually live abroad within the recognised border zone.",
      "It grants commuting access to work, not Swiss residence.",
    ],
  },
  {
    key: "CH_FAMILY_REUNIFICATION", label: "Switzerland — Family Reunification", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Residence for the spouse and children of a Swiss resident or citizen, gated by the sponsor's status, income and adequate housing.",
    minInvestment: 0, currency: "CHF", processingWeeks: 14, minimumStayDaysPerYear: 183,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, "MARRIAGE_CERTIFICATE", "BIRTH_CERTIFICATE", "PROOF_OF_ADDRESS", "TAX_RECORD", "HEALTH_INSURANCE"], screening: ["AML_SOF", "CRIMINAL_RECORD"],
    authority: "Kantonales Migrationsamt with SEM approval", reviewedOn: "2026-10-06",
    feeChf: 8000,
    complexity: 3,
    legalBasis: "ANAG Art. 42–51 — family reunification (Familiennachzug)",
    eligibility: [
      { rule: "age_min", years: 18 },
    ],
    watchFactors: [
      "The sponsor's status (permit B vs C vs citizenship) determines which tests apply.",
      "Adequate housing and no-welfare criteria are assessed per canton.",
    ],
  },
  {
    key: "CH_NATURALISATION", label: "Switzerland — Ordinary Naturalisation", country: "CH", family: "EU_CITIZENSHIP", kind: "CITIZENSHIP",
    summary: "Ordinary naturalisation across municipal, cantonal and federal stages, requiring a settlement permit and a minimum decade of residence.",
    minInvestment: 0, currency: "CHF", processingWeeks: 78, minimumStayDaysPerYear: 183,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, "PROOF_OF_ADDRESS", "POLICE_RECORD", "TAX_RECORD", "CURRICULUM_VITAE"], screening: ["AML_SOF", "TAX_COMPLIANCE", "CRIMINAL_RECORD", "ADVERSE_MEDIA"],
    authority: "Cantonal naturalisation authority with SEM and federal approval", reviewedOn: "2026-10-06",
    feeChf: 11000,
    complexity: 4,
    legalBasis: "Bürgerrechtsgesetz (BüG) SR 141.0 — ordinary naturalisation",
    eligibility: [
      { rule: "residence_years_min", years: 10 },
      { rule: "permit_required", permit: "C" },
      { rule: "age_min", years: 18 },
    ],
    watchFactors: [
      "Commune-specific criteria vary and frequently exceed the federal minimum.",
      "Language and integration evidence is verified at each of the three stages.",
    ],
  },
  {
    key: "CH_NATURALISATION_SPOUSE", label: "Switzerland — Facilitated Naturalisation (Spouse)", country: "CH", family: "EU_CITIZENSHIP", kind: "CITIZENSHIP",
    summary: "Facilitated naturalisation for the spouse of a Swiss citizen after five years' residence including three years of marriage.",
    minInvestment: 0, currency: "CHF", processingWeeks: 60, minimumStayDaysPerYear: 183,
    familyInclusion: "NONE", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, "MARRIAGE_CERTIFICATE", "PROOF_OF_ADDRESS", "POLICE_RECORD", "TAX_RECORD"], screening: ["AML_SOF", "TAX_COMPLIANCE", "CRIMINAL_RECORD"],
    authority: "Cantonal naturalisation authority with SEM and federal approval", reviewedOn: "2026-10-06",
    feeChf: 8000,
    complexity: 3,
    legalBasis: "BüG Art. 15 — facilitated naturalisation (erleichterte Einbürgerung)",
    eligibility: [
      { rule: "residence_years_min", years: 5 },
      { rule: "permit_required", permit: "B_OR_C" },
      { rule: "age_min", years: 18 },
    ],
    watchFactors: [
      "Requires 5 years' residence including 1 year on a Swiss permit, plus 3 years married.",
      "Cohabitation is genuinely assessed — it cannot simply be asserted.",
    ],
  },
  {
    key: "AT_CITIZENSHIP_DESCENDANTS", label: "Austria — Citizenship for Descendants of Holocaust Victims", country: "AT", family: "EU_CITIZENSHIP", kind: "CITIZENSHIP",
    summary: "Restoration of Austrian citizenship for the descendants of people persecuted and forced to flee by the National Socialist regime between 1933 and 1955.",
    minInvestment: 0, currency: "EUR", processingWeeks: 52, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN_PARENTS", citizenshipPath: "DIRECT",
    requirements: [...CORE_IDENTITY, "MARRIAGE_CERTIFICATE", "PROOF_OF_ADDRESS", "OTHER"], screening: ["IDENTITY", "SANCTIONS", "PEP", "ADVERSE_MEDIA", "CRIMINAL_RECORD"],
    authority: "Austrian Federal Ministry of the Interior (BMI) — citizenship authority", reviewedOn: "2026-10-06",
    feeChf: 3000,
    complexity: 5,
    legalBasis: "Staatsbürgerschaftsgesetz (StbG) §58c/§58d — restoration of citizenship to victims of National Socialism and their descendants",
    eligibility: [
      { rule: "nationality_zone", zone: "ANY" },
    ],
    watchFactors: [
      "The case turns on proving the ancestor's persecution and the unbroken family line — documents, not assertions.",
      "Descendants and further family members may be included; each is assessed individually.",
      "The authority decides; the pre-assessment only routes the file to a relationship manager.",
    ],
  },
  {
    key: "CH_LEX_KOLLER", label: "Switzerland — Property Purchase Authorisation (Lex Koller)", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Cantonal authorisation to acquire Swiss real estate where a statutory exception to the Lex Koller prohibition applies.",
    minInvestment: 1_000_000, currency: "CHF", processingWeeks: 16, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: [...CORE_IDENTITY, "PROOF_OF_ADDRESS", "BANK_REFERENCE_LETTER", "SOURCE_OF_FUNDS_EVIDENCE", "OTHER"], screening: ["AML_SOF", "AML_SOW", "BANK_VERIFY"],
    authority: "Kantonale Bewilligungsbehörde (Lex-Koller-Bewilligungsbehörde)", reviewedOn: "2026-10-06",
    feeChf: 18000,
    complexity: 4,
    legalBasis: "Bundesgesetz über den Erwerb von Grundstücken durch Personen im Ausland (BewG, SR 211.412.41 — Lex Koller)",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 1000000 },
    ],
    watchFactors: [
      "Foreign purchases are prohibited unless a statutory exception applies.",
      "Holiday apartments and main-residence permits follow materially different tests.",
    ],
  },
  {
    key: "CH_COMPANY_RELOCATION", label: "Switzerland — Company Relocation & Permits", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Formation of a Swiss entity with residence permits for the transferring directors and key staff, on proven economic benefit.",
    minInvestment: 300_000, currency: "CHF", processingWeeks: 22, minimumStayDaysPerYear: 183,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, "CERTIFICATE_OF_REGISTRATION", "ARTICLES_OF_ASSOCIATION", "SHAREHOLDER_REGISTER", "CURRICULUM_VITAE", "HEALTH_INSURANCE", "TAX_RECORD"], screening: ["AML_SOF", "AML_SOW", "CRIMINAL_RECORD"],
    authority: "Kantonales Migrationsamt with SEM approval; Handelsregister for the entity", reviewedOn: "2026-10-06",
    feeChf: 28000,
    complexity: 4,
    legalBasis: "ANAG Art. 21 combined with the Swiss Code of Obligations (OR) on company formation",
    eligibility: [
      { rule: "age_min", years: 18 },
      { rule: "employment_months_min", months: 12 },
      { rule: "funds_min", chf: 300000 },
    ],
    watchFactors: [
      "Seniority of the transferring staff and the economic benefit to Switzerland are decisive.",
      "Quota availability applies to any non-EU/EFTA hires.",
    ],
  },
  {
    key: "CH_STUDENT_PERMIT", label: "Switzerland — Student Residence Permit", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Residence for study or training at a recognised Swiss institution, on confirmed admission and proven financial means.",
    minInvestment: 0, currency: "CHF", processingWeeks: 8, minimumStayDaysPerYear: 183,
    familyInclusion: "NONE", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, "PROOF_OF_ADDRESS", "BANK_STATEMENT", "HEALTH_INSURANCE"], screening: ["AML_SOF"],
    authority: "Kantonales Migrationsamt with SEM approval", reviewedOn: "2026-10-06",
    feeChf: 4000,
    complexity: 2,
    legalBasis: "ANAG Art. 27 — residence for education and training (Ausbildungsbewilligung)",
    eligibility: [
      { rule: "nationality_zone", zone: "NON_EU" },
      { rule: "age_min", years: 18 },
      { rule: "funds_min", chf: 25000 },
    ],
    watchFactors: [
      "Work rights are limited and largely non-renewable alongside study.",
      "Financial means must cover the whole intended course, not just the first year.",
    ],
  },
  {
    key: "CH_RETIREMENT", label: "Switzerland — Retirement Residence", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Residence for financially independent persons of retirement age who will not work in Switzerland and meet the means test.",
    minInvestment: 1_200_000, currency: "CHF", processingWeeks: 22, minimumStayDaysPerYear: 183,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "AFTER_RESIDENCE_PERIOD",
    requirements: [...CORE_IDENTITY, "PROOF_OF_ADDRESS", "BANK_REFERENCE_LETTER", "SOURCE_OF_FUNDS_EVIDENCE", "TAX_RECORD", "HEALTH_INSURANCE"], screening: ["AML_SOF", "AML_SOW", "BANK_VERIFY", "TAX_COMPLIANCE"],
    authority: "Kantonales Migrationsamt with SEM approval", reviewedOn: "2026-10-06",
    feeChf: 24000,
    complexity: 4,
    legalBasis: "ANAG Art. 28 — residence for financially independent persons without gainful employment",
    eligibility: [
      { rule: "nationality_zone", zone: "NON_EU" },
      { rule: "age_min", years: 55 },
      { rule: "must_not_work", value: true },
      { rule: "funds_min", chf: 1200000 },
    ],
    watchFactors: [
      "An applicant may not work in Switzerland and must not rely on Swiss welfare.",
      "A demonstrable connection to Switzerland materially strengthens the application.",
    ],
  },
  {
    key: "CH_D_VISA", label: "Switzerland — National D Visa (Long Stay)", country: "CH", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "National long-stay visa D, the entry authorisation that precedes a Swiss residence permit for third-country nationals.",
    minInvestment: 0, currency: "CHF", processingWeeks: 8, minimumStayDaysPerYear: 0,
    familyInclusion: "SPOUSE_CHILDREN", citizenshipPath: "NONE",
    requirements: [...CORE_IDENTITY, "PROOF_OF_ADDRESS", "BANK_STATEMENT", "HEALTH_INSURANCE"], screening: ["AML_SOF"],
    authority: "Swiss representation abroad (Embassy / Consulate) with cantonal and SEM approval", reviewedOn: "2026-10-06",
    feeChf: 3000,
    complexity: 2,
    legalBasis: "ANAG Art. 6 / VZAE — national visa D for a long stay exceeding 90 days",
    eligibility: [
      { rule: "nationality_zone", zone: "NON_EU" },
      { rule: "age_min", years: 18 },
    ],
    watchFactors: [
      "The visa authorises entry only — the permit is issued after arrival by the canton.",
      "It is granted in support of an already-approved permit application, not independently.",
    ],
  },

  {
    key: "ADVISORY_ONLY", label: "Advisory / Eligibility Assessment", country: "EU", family: "EU_RESIDENCE", kind: "RESIDENCE",
    summary: "Structured eligibility assessment and route comparison without a filing — the usual first engagement.",
    minInvestment: 0, currency: "EUR", processingWeeks: 2, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "CURRICULUM_VITAE"], screening: [],
    authority: "Internal — Citizen Lane private office", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 1,
    legalBasis: "Internal engagement — no filing is made against this route",
    eligibility: [],
    watchFactors: [
      "This is the usual first engagement: a structured assessment before any filing decision.",
      "No eligibility rule applies because no application is submitted.",
    ],
  },

  // ── Ancillary services (SVC_*) ──────────────────────────────────────────
  {
    key: "SVC_PASSPORT_RENEWAL_KN", label: "Passport Renewal — St. Kitts & Nevis", country: "KN", family: "SERVICES", kind: "RESIDENCE",
    summary: "Renewal of a St. Kitts & Nevis passport, including dependent and consular follow-through.",
    minInvestment: 0, currency: "USD", processingWeeks: 6, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "BIRTH_CERTIFICATE"], screening: ["IDENTITY", "AML_SOF"],
    authority: "St. Kitts & Nevis Citizenship by Investment Unit", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 1,
    legalBasis: "Citizenship by Investment Act — passport renewal provisions",
    eligibility: [],
    watchFactors: [
      "Dependent renewals require separate filings per family member.",
      "Consular follow-through may extend the timeline beyond the standard window.",
    ],
  },
  {
    key: "SVC_COMPANY_MALTA", label: "Company Set Up — Malta", country: "MT", family: "SERVICES", kind: "RESIDENCE",
    summary: "Maltese company formation and structuring, with the bank account and tax registration that follow it.",
    minInvestment: 0, currency: "EUR", processingWeeks: 6, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "PROOF_OF_ADDRESS", "SOURCE_OF_FUNDS_EVIDENCE"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Malta Financial Services Authority (MFSA)", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 2,
    legalBasis: "Companies Act (Cap. 386) — Malta Financial Services Authority Act",
    eligibility: [],
    watchFactors: [
      "Bank account opening is a separate engagement and may take additional weeks.",
      "Substance requirements must be met for tax residency purposes.",
    ],
  },
  {
    key: "SVC_COMPANY_UAE_MEYDAN", label: "Company Set Up — UAE (Meydan Free Zone)", country: "AE", family: "SERVICES", kind: "RESIDENCE",
    summary: "Establishment in the Meydan Free Zone — licence, residency visa sponsor and corporate account.",
    minInvestment: 0, currency: "AED", processingWeeks: 4, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "PROOF_OF_ADDRESS", "CURRICULUM_VITAE"], screening: ["AML_SOW", "BANK_VERIFY"],
    authority: "Meydan Free Zone Authority", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 2,
    legalBasis: "UAE Commercial Companies Law — Meydan Free Zone regulations",
    eligibility: [],
    watchFactors: [
      "Residency visa sponsorship is tied to the company licence.",
      "Corporate bank account opening requires physical presence for KYC.",
    ],
  },
  {
    key: "SVC_BANK_ACCOUNT", label: "Bank Account Opening", country: "EU", family: "SERVICES", kind: "RESIDENCE",
    summary: "Introduction and file preparation for a personal or corporate account with a private bank.",
    minInvestment: 0, currency: "EUR", processingWeeks: 8, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "PROOF_OF_ADDRESS", "SOURCE_OF_FUNDS_EVIDENCE", "BANK_STATEMENT"], screening: ["AML_SOF", "AML_SOW", "BANK_VERIFY", "TAX_COMPLIANCE"],
    authority: "Private bank — relationship manager discretion", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 2,
    legalBasis: "Banking secrecy and AML regulations — bank's internal KYC policy",
    eligibility: [],
    watchFactors: [
      "Bank discretion is absolute — no application is guaranteed.",
      "Source-of-wealth documentation must be comprehensive and auditable.",
    ],
  },
  {
    key: "SVC_JOB_SEARCH", label: "Job Search Support", country: "EU", family: "SERVICES", kind: "RESIDENCE",
    summary: "Employer introductions and permit-linked job placement support.",
    minInvestment: 0, currency: "EUR", processingWeeks: 12, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "CURRICULUM_VITAE"], screening: ["IDENTITY"],
    authority: "Employer and immigration authority", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 1,
    legalBasis: "Employment and immigration law — employer sponsorship",
    eligibility: [],
    watchFactors: [
      "Job market conditions vary by sector and jurisdiction.",
      "Permit approval depends on employer and salary thresholds.",
    ],
  },

  // ── Investment lines (INV_*) ───────────────────────────────────────────
  {
    key: "INV_REAL_ESTATE", label: "Real Estate Portfolio", country: "EU", family: "SERVICES", kind: "RESIDENCE",
    summary: "Curated qualifying property across European and Caribbean markets, matched to a programme's threshold.",
    minInvestment: 200_000, currency: "EUR", processingWeeks: 10, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "SOURCE_OF_FUNDS_EVIDENCE", "BANK_STATEMENT"], screening: ["AML_SOF", "AML_SOW"],
    authority: "Varies by jurisdiction — notary and land registry", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 2,
    legalBasis: "Property and investment law — varies by jurisdiction",
    eligibility: [],
    watchFactors: [
      "Property market conditions vary significantly by location.",
      "Due diligence on title and encumbrances is essential.",
    ],
  },
  {
    key: "INV_FUNDS_BUSINESS", label: "Investment Funds & Businesses", country: "EU", family: "SERVICES", kind: "RESIDENCE",
    summary: "Approved fund subscriptions and direct business investments that qualify under Golden Visa regimes.",
    minInvestment: 250_000, currency: "EUR", processingWeeks: 12, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "SOURCE_OF_FUNDS_EVIDENCE", "BANK_STATEMENT"], screening: ["AML_SOF", "AML_SOW", "BANK_VERIFY"],
    authority: "Fund manager and regulator", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 3,
    legalBasis: "Investment fund regulations — varies by jurisdiction",
    eligibility: [],
    watchFactors: [
      "Fund performance and manager track record must be assessed.",
      "Lock-up periods and liquidity terms vary by fund.",
    ],
  },
  {
    key: "INV_PORTUGAL_GOLDEN", label: "Portugal Golden Visa Investments", country: "PT", family: "SERVICES", kind: "RESIDENCE",
    summary: "Qualifying Portuguese fund and business opportunities structured for the Golden Visa.",
    minInvestment: 500_000, currency: "EUR", processingWeeks: 20, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "SOURCE_OF_FUNDS_EVIDENCE", "BANK_STATEMENT"], screening: ["AML_SOF", "AML_SOW", "BANK_VERIFY"],
    authority: "Portuguese Immigration and Borders Service (SEF)", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 3,
    legalBasis: "Portuguese Immigration Law — Golden Visa provisions",
    eligibility: [],
    watchFactors: [
      "Golden Visa regulations have changed frequently — verify current rules.",
      "Fund investments must meet minimum holding period requirements.",
    ],
  },
  {
    key: "INV_ITALY_VENICE_HOTEL", label: "Hotel Investment — Italian Golden Visa (Venice)", country: "IT", family: "SERVICES", kind: "RESIDENCE",
    summary: "Venice hospitality development qualifying under the Italian investor residence programme.",
    minInvestment: 250_000, currency: "EUR", processingWeeks: 24, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "SOURCE_OF_FUNDS_EVIDENCE", "BANK_STATEMENT"], screening: ["AML_SOF", "AML_SOW"],
    authority: "Italian Ministry of Interior — Immigration", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 4,
    legalBasis: "Italian Immigration Decree — investor visa provisions",
    eligibility: [],
    watchFactors: [
      "Hospitality development carries operational and market risk.",
      "Venice-specific regulations may apply to heritage properties.",
    ],
  },
  {
    key: "INV_ERLEBNISBAHN", label: "Erlebnisbahn", country: "EU", family: "SERVICES", kind: "RESIDENCE",
    summary: "Sustainable leisure-infrastructure investment alongside the firm's green-energy projects.",
    minInvestment: 100_000, currency: "EUR", processingWeeks: 16, minimumStayDaysPerYear: 0,
    familyInclusion: "NONE", citizenshipPath: "NONE",
    requirements: ["PASSPORT", "SOURCE_OF_FUNDS_EVIDENCE"], screening: ["AML_SOF", "AML_SOW"],
    authority: "Project developer and local authority", reviewedOn: "2026-10-06",
    feeChf: 0,
    complexity: 3,
    legalBasis: "Commercial and planning law — varies by project location",
    eligibility: [],
    watchFactors: [
      "Infrastructure projects carry construction and operational risk.",
      "Revenue projections depend on tourism and local demand.",
    ],
  },
];

export const PROGRAMME_KEYS: readonly string[] = PROGRAMMES.map((p) => p.key);

export function programmeByKey(key: string): Programme | undefined {
  return PROGRAMMES.find((p) => p.key === key);
}

/** Citizenship vs residence family, derived from the key — never hand-listed. */
export function programmeFamily(key: string): ProgrammeFamily {
  // Services, investment lines and the standalone advisory engagement are
  // engagements in their own right. Classing a bank account — or an eligibility
  // assessment with no filing — as a residence route would inflate the landing
  // page's residence count and mis-describe the offer.
  if (/^(SVC_|INV_)/.test(key) || key === "ADVISORY_ONLY") return "SERVICES";
  return /_CITIZENSHIP/.test(key) ? "EU_CITIZENSHIP" : "EU_RESIDENCE";
}

export function programmesByFamily(family: ProgrammeFamily): Programme[] {
  return PROGRAMMES.filter((p) => p.family === family);
}

export function programmesByKind(kind: Programme["kind"]): Programme[] {
  return PROGRAMMES.filter((p) => p.kind === kind);
}

/** Programmes whose indicative minimum is at or below a budget — for triage. */
export function programmesWithin(budget: number, currency: string): Programme[] {
  if (!Number.isFinite(budget) || budget <= 0) return [];
  return PROGRAMMES.filter((p) => p.currency === currency && p.minInvestment > 0 && p.minInvestment <= budget);
}

/** Resolve a programme's required documents to full specs (drives the request). */
export function requiredDocuments(key: string): DocumentSpec[] {
  const p = programmeByKey(key);
  if (!p) return [];
  return p.requirements.map((k) => DOCUMENT_CATALOG.find((d) => d.key === k)).filter((d): d is DocumentSpec => Boolean(d));
}

/** Per-category default turnaround for a generated document request. */
const DUE_DAYS_BY_CATEGORY: Record<DocumentSpec["category"], number> = {
  IDENTITY: 14,
  LEGAL: 21,
  FINANCIAL: 14,
  CORPORATE: 14,
  MEDICAL: 14,
  OTHER: 14,
};

/** Client-facing instruction text built from the catalogue spec — never hand-typed. */
function instructionFor(d: DocumentSpec): string {
  const parts = [`Issued by ${d.issuedBy}.`];
  if (d.certified) parts.push("A certified copy or wet/e-signed original is required.");
  if (d.validityMonths !== null) parts.push(`Must be valid and issued within the last ${d.validityMonths} month${d.validityMonths === 1 ? "" : "s"}.`);
  return parts.join(" ");
}

/** A generated document request — the persisted fields plus the scheduling hint. */
export type DocumentRequestSpec = { docType: string; title: string; instructions: string; dueInDays: number };

/**
 * The document requests a programme implies, ready to persist. This is the
 * PROGRAMME-DRIVEN replacement for a hardcoded "standard set": every programme
 * gets exactly the checklist its `requirements` names, with instructions and a
 * due window derived from the catalogue rather than retyped per jurisdiction.
 */
export function requiredDocumentRequests(key: string): DocumentRequestSpec[] {
  return requiredDocuments(key).map((d) => ({
    docType: d.key,
    title: d.label,
    instructions: instructionFor(d),
    dueInDays: DUE_DAYS_BY_CATEGORY[d.category] ?? 14,
  }));
}

export type RequirementReconciliation = {
  /** Canonical programme requirement keys, in checklist order. */
  required: string[];
  /** Of `required`, the ones the caller provided (after alias normalisation). */
  present: string[];
  /** Of `required`, the ones still outstanding. */
  missing: string[];
  /** Provided keys that match no programme requirement — extra/off-checklist. */
  extras: string[];
  complete: boolean;
};

/**
 * Reconcile a set of provided document keys against a programme's checklist.
 *
 * Provided keys are normalised through `canonicalDocumentKey` first, so a
 * legacy/coarse stored `type` (e.g. "POLICE_CLEARANCE", "ID_CARD") still counts
 * against the canonical requirement ("POLICE_RECORD", "NATIONAL_ID"). An
 * unknown programme key reconciles to an EMPTY, NOT-complete result rather than
 * silently passing — a missing programme must never read as "nothing required".
 */
export function reconcileRequirements(
  programmeKey: string | null | undefined,
  providedKeys: ReadonlyArray<string | null | undefined>
): RequirementReconciliation {
  const p = programmeKey ? programmeByKey(programmeKey) : undefined;
  if (!p) {
    return { required: [], present: [], missing: [], extras: [], complete: false };
  }
  const required = [...p.requirements];
  const requiredSet = new Set(required);
  const provided = new Set(providedKeys.filter((k): k is string => Boolean(k)).map((k) => canonicalDocumentKey(k)));
  const present = required.filter((k) => provided.has(k));
  const missing = required.filter((k) => !provided.has(k));
  const extras = [...provided].filter((k) => !requiredSet.has(k));
  return { required, present, missing, extras, complete: required.length > 0 && missing.length === 0 };
}

/** True when every requirement key resolves to a real catalogued document. */
export function hasUnresolvedRequirements(key: string): boolean {
  const p = programmeByKey(key);
  if (!p) return true;
  const known = new Set(DOCUMENT_CATALOG.map((d) => d.key));
  return p.requirements.some((r) => !known.has(r));
}

/** True when every screening key resolves to a real catalogued check. */
export function hasUnresolvedScreening(key: string): boolean {
  const p = programmeByKey(key);
  if (!p) return true;
  const known = new Set(SCREENING_CHECKS.map((c) => c.key));
  return p.screening.some((s) => !known.has(s));
}

/** The screening set a programme implies: its own, plus every mandatory check. */
export function effectiveScreening(key: string): string[] {
  const p = programmeByKey(key);
  const required = SCREENING_CHECKS.filter((c) => c.required).map((c) => c.key);
  return [...new Set([...required, ...(p?.screening ?? [])])];
}

/**
 * Programmes the eligibility pre-scan can actually produce a verdict for.
 * Advisory-only routes carry no rules, so they are never screened.
 */
export function screenableProgrammes(): Programme[] {
  return PROGRAMMES.filter((p) => p.eligibility.length > 0);
}

export const SCREENABLE_KEYS: readonly string[] = PROGRAMMES
  .filter((p) => p.eligibility.length > 0)
  .map((p) => p.key);

/** True when the authority expects an actual filing — everything but advisory. */
export function isFilingRoute(key: string): boolean {
  return key !== "ADVISORY_ONLY";
}

/**
 * Public-catalogue projection: the marketing-safe slice of one programme.
 * Deliberately excludes anything a client could mistake for a quotation —
 * `minInvestment` is indicative and is returned only with that framing.
 */
export function publicProgrammeCard(p: Programme): {
  key: string; label: string; country: string; family: ProgrammeFamily;
  kind: Programme["kind"]; summary: string; authority: string; feeChf: number;
  processingWeeks: number; minInvestment: number; currency: string;
  minimumStayDaysPerYear: number; familyInclusion: Programme["familyInclusion"];
  citizenshipPath: Programme["citizenshipPath"]; reviewedOn: string;
} {
  return {
    key: p.key, label: p.label, country: p.country, family: p.family, kind: p.kind,
    summary: p.summary, authority: p.authority, feeChf: p.feeChf,
    processingWeeks: p.processingWeeks, minInvestment: p.minInvestment,
    currency: p.currency, minimumStayDaysPerYear: p.minimumStayDaysPerYear,
    familyInclusion: p.familyInclusion, citizenshipPath: p.citizenshipPath,
    reviewedOn: p.reviewedOn,
  };
}

/**
 * Resolve a programme's requirement keys to their catalogued specs, so the
 * public checklist carries HUMAN LABELS rather than internal keys. An unknown
 * key is dropped rather than rendered raw — the cross-file test asserts every
 * key resolves, so a drop here means a real defect, not a normal case.
 */
export function publicChecklist(key: string): Array<{
  label: string; issuedBy: string; certified: boolean; validityMonths: number | null;
}> {
  const p = programmeByKey(key);
  if (!p) return [];
  const byKey = new Map(DOCUMENT_CATALOG.map((d) => [d.key, d]));
  return p.requirements
    .map((k) => byKey.get(k))
    .filter((d): d is DocumentSpec => Boolean(d))
    .map((d) => ({
      label: d.label,
      issuedBy: d.issuedBy,
      certified: d.certified,
      validityMonths: d.validityMonths,
    }));
}
