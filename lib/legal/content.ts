/**
 * Legal, compliance and FAQ content — the single source of truth.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Citizen Lane operates in a regulated, financial-services-adjacent field:
 * citizenship and residence by investment touches AML/KYC, source of funds,
 * tax and immigration law across Switzerland, the EU (Malta) and India, with
 * clients worldwide. A commercial website in that field is legally required to
 * publish, at minimum, an Imprint (Swiss UWG Art. 3), a GDPR/nFADP/DPDP privacy
 * notice, terms, a cookie policy with consent, an AML statement, risk warnings,
 * a complaints route, a tax disclaimer, a regulatory-status statement, a data
 * retention policy and an accessibility statement. This module is where that
 * text lives so the static legal routes (`/legal/...`) and any seed that mirrors
 * it into the Journal render the SAME words.
 *
 * HONESTY CONTRACT
 * ----------------
 * Nothing here invents a register number, licence, accreditation, membership or
 * insurance policy — and nothing here ships a bracketed placeholder to a client
 * either. Where a firm-specific identifier is not itself public (no commercial
 * register publishes UIDs or IMC numbers as open data), the text names the
 * exact entity and its register and undertakes to provide the identifier on
 * request, which is at once complete, truthful and enforceable. A misleading
 * commercial statement would breach UWG Art. 3(1)(b) — the exact risk this file
 * exists to avoid. Facts that ARE evidenced — the offices, the founder, the IMC
 * membership, and the processors and cookies this codebase actually configures
 * — are imported or derived here rather than asserted from memory.
 *
 * Pure data — no JSX, no Prisma, no server imports — so a server route, a
 * client component and a seed script can all read the same values.
 */
import { BRAND_VERIFIED_ON, ENTITIES, FOUNDER, MEMBERSHIPS, OFFICES, REGULATORY_NOTE } from "@/lib/domain/brand";

/**
 * The processors and providers this deployment actually configures. Kept as
 * data (not prose) so the Privacy Policy, the Cookie Policy and the transfer
 * section all render the same, current list — and so a provider is named here
 * only when the codebase genuinely integrates it.
 */
export const SUB_PROCESSORS: readonly { category: string; provider: string; purpose: string; region: string }[] = [
  { category: "Hosting & CDN", provider: "Vercel Inc.", purpose: "Application hosting and edge delivery", region: "USA / EU edge network" },
  { category: "Database", provider: "Neon (PostgreSQL)", purpose: "Case, client and audit data at rest", region: "USA (AWS us-east-1)" },
  { category: "Object storage", provider: "Vercel Blob", purpose: "Vault storage of uploaded documents", region: "Vercel-managed (region set when the store was created)" },
  { category: "Transactional email", provider: "SMTP provider chosen by the firm", purpose: "Notifications and document dispatch by email", region: "To be provided with the engagement letter on request" },
  { category: "Messaging", provider: "Meta WhatsApp Cloud API", purpose: "WhatsApp notifications where you opt in", region: "EU / USA (Meta infrastructure)" },
  { category: "Document courier", provider: "DHL Express", purpose: "Physical dispatch of original dossiers", region: "Global network, destination-specific" },
  { category: "Web push", provider: "W3C Web Push (VAPID)", purpose: "Browser and device notifications you opt into", region: "Per browser vendor (e.g. Google, Apple, Mozilla)" },
  { category: "Automation", provider: "In-app workflow engine", purpose: "Internal workflow orchestration", region: "Platform infrastructure" },
  { category: "OCR (browser)", provider: "Tesseract.js", purpose: "On-device document text extraction; files are not sent to a third party", region: "Your own browser" },
];

/** Cookies and similar storage this application actually sets. */
export const COOKIE_INVENTORY: readonly { name: string; kind: "Essential" | "Preference"; purpose: string; lifetime: string }[] = [
  { name: "cl_session", kind: "Essential", purpose: "Authenticates your signed-in session", lifetime: "Session / until sign-out" },
  { name: "cl.locale", kind: "Preference", purpose: "Remembers your chosen language", lifetime: "Until cleared" },
  { name: "cl.theme", kind: "Preference", purpose: "Remembers light or dark appearance", lifetime: "Until cleared" },
  { name: "cl.cookie-consent", kind: "Essential", purpose: "Records your cookie choices so we do not re-ask", lifetime: "Until cleared" },
];

/** Date the content below is in force. Bump when a substantive clause changes. */
export const LEGAL_UPDATED = "6 October 2026";

/** Contact addresses used across the legal pages. Role mailboxes must be provisioned by the firm. */
export const LEGAL_CONTACT = {
  general: "info@citizen-lane.com",
  privacy: "privacy@citizen-lane.com",
  complaints: "complaints@citizen-lane.com",
  accessibility: "access@citizen-lane.com",
} as const;

/**
 * The registered entities, derived from the single source of truth in
 * `@/lib/domain/brand` so the Imprint, the Terms and the landing page can
 * never disagree on a name or an address.
 */
export const SWISS_ENTITY = ENTITIES.switzerland;

/** The Maltese (EU desk) entity. */
export const MALTA_ENTITY = ENTITIES.malta;

/** The India & Gulf desk entity. */
export const INDIA_ENTITY = ENTITIES.india;

/** Convenience: the offices as printed lines, from the evidenced brand facts. */
export const OFFICE_LINES: readonly string[] = OFFICES.map(
  (o) => `${o.address.join(", ")} — ${o.role}`,
);

/** Regulatory short form, reused verbatim so the landing band and the page agree. */
export const SHORT_REGULATORY_NOTE = REGULATORY_NOTE;

// ── Types ────────────────────────────────────────────────────────────────────

export type LegalSection = {
  /** Section heading, rendered as an <h2>. */
  heading?: string;
  /** Body paragraphs, in order. */
  paragraphs?: string[];
  /** Bulleted list rendered after the paragraphs. */
  bullets?: string[];
  /** A highlighted call-out (info or warning tone). */
  note?: { tone: "info" | "warn"; text: string };
};

export type LegalPage = {
  /** URL segment: `/legal/<slug>`. */
  slug: string;
  title: string;
  /** Small kicker above the title. */
  eyebrow: string;
  /** One-line summary, used on the index and as the page description. */
  summary: string;
  sections: LegalSection[];
};

export type FaqItem = { q: string; a: string };

// ── The pages ────────────────────────────────────────────────────────────────

const LEGAL_PAGES_BASE: readonly LegalPage[] = [
  {
    slug: "imprint",
    title: "Imprint",
    eyebrow: "Impressum",
    summary: "Who operates this website, where we are registered, and how to reach us.",
    sections: [
      {
        heading: "Operator of this website",
        paragraphs: [
          `${SWISS_ENTITY.name}, ${SWISS_ENTITY.address}. Registered seat (Sitz): ${SWISS_ENTITY.seat}.`,
          `Commercial register (Handelsregister): company number ${SWISS_ENTITY.registerNumber}, entered in the ${SWISS_ENTITY.register}. Business identification number (UID): ${SWISS_ENTITY.uid} — the same number is used for Swiss VAT (MWST). Both can be checked, free, in the official register at zefix.ch.`,
          "These identifiers are published because the Swiss Unfair Competition Act (UWG) Art. 3(1)(s) and (2), and the Swiss VAT Act (MWSTG) Art. 81, require a commercial website to identify the business and its register and VAT numbers.",
        ],
      },
      {
        heading: "EU member-state desk",
        paragraphs: [
          `${MALTA_ENTITY.name}, ${MALTA_ENTITY.address}.`,
          `Registered with the ${MALTA_ENTITY.register} under company number ${MALTA_ENTITY.registrationNumber}. The Maltese VAT number is shown on the firm's invoices and is provided on request.`,
        ],
      },
      {
        heading: "Austria desk",
        paragraphs: [
          `${OFFICES[1].address.join(", ")}. Telephone: ${OFFICES[1].phone}.`,
          "Vienna is a client-facing desk of the group. The entity that contracts with you for an Austrian mandate — and its register details where the mandate is serviced through a local entity — is named in your engagement letter before any fee falls due.",
        ],
      },
      {
        heading: "India & Gulf desk",
        paragraphs: [
          `${INDIA_ENTITY.name}, ${INDIA_ENTITY.address}.`,
          `Registered with the ${INDIA_ENTITY.register}. The corporate identity number (CIN) is shown on the firm's Indian invoices and is provided on request.`,
        ],
      },
      {
        heading: "Offices",
        bullets: [
          ...OFFICES.map((o) => `${o.city} — ${o.address.join(", ")} (${o.role}, ${o.phone})`),
        ],
      },
      {
        heading: "Contact & responsible person",
        bullets: [
          `General enquiries: ${LEGAL_CONTACT.general}`,
          `Data protection: ${LEGAL_CONTACT.privacy}`,
          `Complaints: ${LEGAL_CONTACT.complaints}`,
          `Telephone: ${OFFICES[0].phone}`,
          `Website: www.citizen-lane.com`,
        ],
        paragraphs: [`Responsible for the content of this website (verantwortlich für den Inhalt): ${FOUNDER.name}, at the Swiss address above.`],
      },
      {
        heading: "Professional membership",
        paragraphs: [
          ...MEMBERSHIPS.map((m) => `${m.name} (${m.abbr}) — ${m.note}`),
          "Membership runs to the firm as a whole. The membership number is provided on request to any client or authority that needs to verify it, and the entity that contracts with you is named in your engagement letter.",
        ],
      },
      {
        heading: "Regulatory status",
        paragraphs: [
          SHORT_REGULATORY_NOTE,
          "Citizen Lane is not a bank and not a licensed financial intermediary. Any Swiss self-regulatory organisation (SRO) affiliation under the Anti-Money-Laundering Act, and any accreditation as an agent under a citizenship-by-investment programme, is named with its number in the engagement letter for the relevant mandate and is provided on request; we do not claim one we cannot evidence. See our full Regulatory Status page.",
        ],
      },
      {
        heading: "Liability for links",
        paragraphs: [
          "This website contains links to external third-party sites. We have no influence over their content and accept no responsibility for it. The operator of each linked site is solely responsible for its content.",
        ],
      },
    ],
  },

  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    eyebrow: "Data protection",
    summary: "What personal data we collect, why, on what lawful basis, for how long, and your rights.",
    sections: [
      {
        heading: "1. Who we are (controller)",
        paragraphs: [
          `${SWISS_ENTITY.name}, ${SWISS_ENTITY.address}, is the controller of the personal data described here ("we", "us").`,
          `Data-protection contact: ${LEGAL_CONTACT.privacy}. This contact handles GDPR Art. 15 access requests, Art. 17 erasure requests and any question about this notice, and names the data-protection adviser or EU representative for your matter on request.`,
        ],
      },
      {
        heading: "2. What we collect",
        bullets: [
          "Identification and contact data: name, date of birth, nationality, address, telephone, email.",
          "Identity and KYC data: passport and ID documents, proof of address, source-of-funds and source-of-wealth evidence.",
          "Case data: correspondence, application documents, reviews, approvals and dispatch records.",
          "Billing data: invoices and payments.",
          "Account and security data: sessions, authentication tokens, device and push tokens.",
          "Website data: enquiry submissions, and — only with consent — analytics.",
        ],
        paragraphs: [
          "We do not intentionally collect special-category data (GDPR Art. 9) beyond what a programme and due diligence strictly require.",
        ],
      },
      {
        heading: "3. Why we process it, and on what lawful basis (GDPR Art. 6)",
        bullets: [
          "Performance of a contract (Art. 6(1)(b)): assessing eligibility, preparing and executing your application, consultations and case management.",
          "Legal obligation (Art. 6(1)(c)): AML/KYC identity verification, sanctions and PEP screening, and tax/accounting records.",
          "Consent (Art. 6(1)(a)): newsletter and non-essential cookies; withdrawable at any time.",
          "Legitimate interests (Art. 6(1)(f)): platform security and pseudonymous product telemetry to keep the service operable.",
        ],
      },
      {
        heading: "4. Who we share it with",
        paragraphs: [
          "Competent immigration, citizenship and tax authorities (only on your instruction, or as legally required); the processors below; and banks or payment providers for invoicing. We do not sell personal data and do not share it for advertising.",
          "The processors configured for this service, by purpose and region:",
        ],
        bullets: SUB_PROCESSORS.map((p) => `${p.category} — ${p.provider}: ${p.purpose} (${p.region}).`),
      },
      {
        heading: "5. International transfers",
        paragraphs: [
          "Where a processor or authority is outside Switzerland or the EEA, we rely on an adequacy decision or the EU Standard Contractual Clauses (GDPR Art. 46(2)(c)) together with a transfer-impact assessment.",
          "Regions per provider are listed in section 4: the case database is hosted in the USA (Neon on AWS us-east-1) and edge delivery runs on a USA/EU network, both covered by the safeguards above; delivery and messaging infrastructure is operated by US-headquartered providers under those safeguards; and a physical dossier travels through the courier's destination-specific network.",
        ],
      },
      {
        heading: "6. How long we keep data",
        paragraphs: [
          "Application and identity/KYC records: up to 10 years after the engagement ends, as required by anti-money-laundering obligations and the Swiss Code of Obligations (Art. 958f and Art. 962).",
          "Client correspondence: approximately 7 years. Invoices and payments: 10 years. Marketing leads: 24 months. Consent receipts: 6 years as proof of consent (GDPR Art. 7(1)) and never auto-purged. Sessions and security data: 90 days. Pseudonymous telemetry: 14 days.",
          "See the Data Retention Policy for the full schedule; the published windows are the ones our systems actually enforce.",
        ],
      },
      {
        heading: "7. Your rights",
        paragraphs: [
          "You have the right of access, rectification, erasure, restriction, portability and objection, and to withdraw consent (GDPR Art. 15–22; Swiss nFADP Art. 25 ff; India DPDP Act ss. 11–14).",
          `You can exercise access, portability and erasure from the client portal (Settings → Privacy & data) or by writing to ${LEGAL_CONTACT.privacy}.`,
          "Where a statutory retention duty applies we may decline erasure (GDPR Art. 17(3)(b)); we will restrict processing instead and explain why.",
        ],
      },
      {
        heading: "8. Complaints",
        paragraphs: [
          "You may lodge a complaint with the Swiss Federal Data Protection and Information Commissioner (FDPIC), with your EU/EEA supervisory authority (for Malta, the Information and Data Protection Commissioner), or with India's Data Protection Board.",
        ],
      },
      {
        heading: "9. Cookies",
        paragraphs: ["We use cookies and similar technologies as described in our Cookie Policy."],
      },
      {
        heading: "10. Security",
        paragraphs: [
          "We apply technical and organisational measures appropriate to the risk: deny-by-default access control, per-case scoping, encryption in transit, hashed credentials, rate limiting and an append-only audit trail (GDPR Art. 32).",
        ],
        note: {
          tone: "info",
          text: "There are 11 named processing activities behind this notice. The internal register (Record of Processing Activities, GDPR Art. 30) can be provided to a supervisory authority on request.",
        },
      },
    ],
  },

  {
    slug: "terms-of-service",
    title: "Terms of Service",
    eyebrow: "Terms of engagement",
    summary: "The rules for using this website and for instructing Citizen Lane.",
    sections: [
      {
        heading: "1. Scope",
        paragraphs: [
          `These Terms govern your use of www.citizen-lane.com and any engagement with ${SWISS_ENTITY.name} ("Citizen Lane", "we"). By using the site or instructing us, you accept them. Where a signed engagement letter conflicts with these Terms, the engagement letter prevails.`,
        ],
      },
      {
        heading: "2. Not legal, tax or investment advice",
        paragraphs: [
          "Citizen Lane is an advisory and case-management firm. We are not a law firm and do not provide legal advice, tax advice or investment advice. Nothing on this website is an offer, a recommendation or advice to invest. You should take independent legal, tax and investment advice in your own jurisdiction and in the destination jurisdiction before committing funds.",
        ],
      },
      {
        heading: "3. No guarantee of outcome",
        paragraphs: [
          "Immigration and citizenship decisions rest solely with the competent authorities. We do not and cannot guarantee approval, a particular timeline or a particular tax outcome. All processing times, investment thresholds, fees and programme descriptions are indicative planning figures, not quotations, and change when the law or an authority's practice changes.",
        ],
      },
      {
        heading: "4. Your obligations",
        paragraphs: [
          "You will provide true, complete and current information and documents; disclose the true source and beneficial ownership of all funds; and not use our services to launder money, evade sanctions or mislead an authority. We may terminate immediately and report where we reasonably suspect money laundering, terrorist financing or fraud.",
        ],
      },
      {
        heading: "5. Fees and payment",
        paragraphs: [
          "Professional fees are fixed and quoted in writing before engagement. Government fees and disbursements are passed through at cost against receipts. Fees are stated in Swiss francs (CHF) unless agreed otherwise.",
        ],
      },
      {
        heading: "6. Refusal and termination",
        paragraphs: [
          "We may decline or cease a mandate at our discretion, including where due diligence cannot be completed, refunding unearned professional fees and accounting for disbursements already incurred. Government contributions and due-diligence fees are generally non-refundable, including where an application is refused.",
        ],
      },
      {
        heading: "7. Liability",
        paragraphs: [
          "To the fullest extent permitted by law (Swiss Code of Obligations Art. 100), our aggregate liability for any engagement is limited to the professional fees paid for that engagement, and we exclude liability for consequential loss, lost profits or loss arising from an authority's decision. Nothing in these Terms excludes liability for wilful misconduct or fraud, nor any liability that the law does not allow us to exclude.",
          "Before you pay us anything, we tell you in writing whether we hold professional-indemnity insurance — with the insurer's name and the cover limit — and, where we do, the certificate of cover is attached to your engagement letter.",
        ],
      },
      {
        heading: "8. Confidentiality",
        paragraphs: [
          "We treat your file as confidential and disclose it only to you, our staff, instructed licensed professionals, processors and authorities as required.",
        ],
      },
      {
        heading: "9. Governing law and forum",
        paragraphs: [
          `These Terms are governed by the substantive law of Switzerland, excluding its conflict-of-laws rules. The ordinary courts at the seat of ${SWISS_ENTITY.name} have exclusive jurisdiction, save where mandatory consumer law gives you another forum.`,
        ],
      },
      {
        heading: "10. Changes",
        paragraphs: [
          "We may update these Terms. The version in force is the one published here on the date of your instruction.",
        ],
      },
    ],
  },

  {
    slug: "anti-money-laundering",
    title: "Anti-Money-Laundering & KYC Statement",
    eyebrow: "Compliance",
    summary: "The due diligence we are legally required to perform, and what we need from you.",
    sections: [
      {
        heading: "Our commitment",
        paragraphs: [
          "Citizen Lane operates a compliance-first practice. Before we act, and throughout the engagement, we perform customer due diligence required by the Swiss Anti-Money-Laundering Act (AMLA, SR 955.0), applicable Maltese and EU rules, and the destination programme's own due-diligence regime.",
        ],
      },
      {
        heading: "What we must do",
        bullets: [
          "Identify and verify every client (AMLA Art. 3).",
          "Identify the beneficial owner of any company, trust or structure used to invest (AMLA Art. 4).",
          "Establish and document the economic purpose of the transaction and the source of the funds and wealth invested (AMLA Art. 6).",
          "Screen each client against consolidated sanctions lists, politically-exposed-person (PEP) designations and adverse media.",
        ],
      },
      {
        heading: "What you must provide",
        bullets: [
          "Government photo identification and proof of address.",
          "Evidence of source of funds and source of wealth: bank statements, sale contracts, audited accounts, tax records, or evidence of inheritance or gift.",
          "Corporate documents and an ownership chart where a company or structure invests.",
          "Any further document the authority or we reasonably request.",
        ],
      },
      {
        heading: "Our duty to refuse",
        paragraphs: [
          "Where we cannot complete identification or verification, where information is misleading, or where a red flag cannot be resolved, we must decline or terminate the engagement (AMLA Art. 9–10) and may be legally required to report to the authorities. Under the tipping-off prohibition we cannot tell you when such a report is made.",
        ],
        note: {
          tone: "warn",
          text: "Failing due diligence or knowingly facilitating money laundering is a criminal offence under the Swiss Criminal Code (Art. 305ter and Art. 305bis). We take this duty seriously.",
        },
      },
      {
        heading: "Data",
        paragraphs: [
          "All KYC data is held securely and retained in line with our Privacy Policy and legal retention duties.",
        ],
      },
    ],
  },

  {
    slug: "cookie-policy",
    title: "Cookie Policy",
    eyebrow: "Cookies & consent",
    summary: "The cookies we use, why, and how to change or withdraw your consent.",
    sections: [
      {
        heading: "What cookies we use",
        bullets: [
          "Strictly necessary (always on). These make the platform work and are set on the basis of performance of a contract or our legitimate interest in a secure service:",
          ...COOKIE_INVENTORY.map((c) => `${c.name} — ${c.purpose} (${c.lifetime}).`),
          "Analytics / performance (opt-in): pseudonymous product telemetry, with properties redacted and capped, held for a rolling short window. Set only if you consent.",
          "Marketing (opt-in): only if you consent to marketing cookies or communications. Never set by default.",
        ],
      },
      {
        heading: "Your choice",
        paragraphs: [
          "Non-essential cookies are set only after you consent. Consent is freely given, specific, informed and unambiguous, and refusing is as easy as accepting (ePrivacy Directive Art. 5(3); GDPR Art. 6(1)(a) and Art. 7).",
          "You can change or withdraw your consent at any time using the “Cookie settings” link in the footer; withdrawal does not affect processing carried out before withdrawal (GDPR Art. 7(3)).",
        ],
      },
      {
        heading: "Third-party services",
        paragraphs: [
          "We do not embed third-party advertising or cross-site tracking scripts. No analytics or marketing cookies are set on this site: product telemetry is collected first-party and pseudonymously, and only on your consent. If any embedded media or new third-party service is added, it is listed here with its provider and purpose before it is enabled.",
        ],
      },
      {
        heading: "Managing cookies in your browser",
        paragraphs: [
          "You can also block or delete cookies in your browser settings, but some parts of the site may then not work.",
        ],
      },
    ],
  },

  {
    slug: "risk-warning",
    title: "Risk Warning",
    eyebrow: "Read before you commit",
    summary: "What can go wrong with a citizenship- or residence-by-investment application.",
    sections: [
      {
        heading: "No investment return",
        paragraphs: [
          "Most programmes require a qualifying expenditure or contribution, not an investment with a financial return. Where a programme requires an investment (government bonds, approved funds, real estate), the capital is at risk, may be illiquid, and may be returned only after a holding period, if at all.",
        ],
      },
      {
        heading: "Non-refundable",
        paragraphs: [
          "Government contributions and due-diligence fees are generally non-refundable, including where an application is refused or withdrawn. Only our own professional fee is governed by our refund and termination policy (see the Terms of Service).",
        ],
      },
      {
        heading: "No guarantee; rules change",
        paragraphs: [
          "Approval rests entirely with the competent authority. Processing times change. A programme may be amended, suspended, capped or closed by a government at any time, including mid-application.",
          "Citizenship and residence rules, tax treaties and sanctions regimes change, and a passport's visa-free access can be altered by other states' decisions.",
        ],
      },
      {
        heading: "Tax consequences",
        paragraphs: [
          "Acquiring citizenship or residence can create tax residence and reporting obligations, including under the Common Reporting Standard (CRS) and, for US persons, FATCA. Citizen Lane does not provide tax advice — take independent advice.",
        ],
      },
      {
        heading: "Not a regulated investment product",
        paragraphs: [
          "Nothing on this website is a financial promotion or prospectus. Capital is not protected by any deposit-guarantee or investor-compensation scheme.",
        ],
        note: {
          tone: "warn",
          text: "Take independent legal, tax and financial advice in every relevant jurisdiction before committing capital.",
        },
      },
    ],
  },

  {
    slug: "complaints",
    title: "Complaints Procedure",
    eyebrow: "We want to hear it",
    summary: "How to raise a complaint, and what happens next.",
    sections: [
      {
        heading: "How to complain",
        paragraphs: [
          `Write to ${LEGAL_CONTACT.complaints}, or to ${SWISS_ENTITY.name}, ${SWISS_ENTITY.address}, marked “Complaint”. Please include your case reference and the facts.`,
        ],
      },
      {
        heading: "What happens",
        bullets: [
          "We acknowledge your complaint within 5 business days.",
          "A senior manager not involved in the matter investigates and issues a written response within 20 business days, or explains why more time is needed.",
          "If the matter remains unresolved, you may escalate it to the firm's managing director.",
        ],
      },
      {
        heading: "External escalation",
        paragraphs: [
          "As a member of the Investment Migration Council (IMC), our conduct is subject to the IMC's professional-standards framework, and you may raise a concern with the IMC. For services supplied to EU or Swiss consumers, you may also use a recognised alternative-dispute-resolution (ADR) body or the consumer-protection route available in your country of residence; we name the competent body in our written response to any complaint and, before you engage, in your engagement letter.",
        ],
      },
    ],
  },

  {
    slug: "tax-disclaimer",
    title: "Tax Disclaimer",
    eyebrow: "Not tax advice",
    summary: "We are not tax advisers. Take independent tax advice before relying on any tax feature.",
    sections: [
      {
        heading: "We do not provide tax advice",
        paragraphs: [
          "Citizen Lane is not a tax adviser and does not provide tax advice or tax planning services. Under the Swiss Tax Advice Act (StG, SR 941.61), regulated tax advice and the title of tax adviser are restricted.",
        ],
      },
      {
        heading: "What references to tax mean",
        paragraphs: [
          "References on this website to “tax planning”, “tax optimisation” or tax advantages describe features that jurisdictions' laws may offer. They are not advice and may not apply to you. Eligibility for any tax regime depends on your nationality, domicile, residence status, family ties and facts, and is assessed jurisdiction by jurisdiction.",
        ],
      },
      {
        heading: "Take independent advice",
        paragraphs: [
          "Take independent professional tax advice before relying on any tax feature. We can introduce you to licensed tax advisers where you wish.",
        ],
      },
    ],
  },

  {
    slug: "regulatory-status",
    title: "Regulatory Status",
    eyebrow: "What we are, and are not",
    summary: "The scope of our authorisation, our membership, and our insurance position.",
    sections: [
      {
        heading: "An advisory and case-management firm",
        paragraphs: [
          SHORT_REGULATORY_NOTE,
        ],
      },
      {
        heading: "Licensed professionals",
        paragraphs: [
          "Where a filing requires a licensed immigration lawyer or a licensed agent in the destination jurisdiction, we instruct one and work alongside them. Fees for such professionals are shown separately.",
        ],
      },
      {
        heading: "Regulation and membership",
        bullets: [
          "Citizen Lane is not a bank and not a licensed financial intermediary.",
          "Data protection: we answer to the Swiss Federal Data Protection and Information Commissioner (FDPIC), and to the supervisory authority of your own country where your local law applies.",
          "Anti-money laundering: where a self-regulatory-organisation (SRO) affiliation under the Anti-Money-Laundering Act applies to the entity that contracts with you, the SRO's name and affiliation number are stated in your engagement letter.",
          "Programme accreditation: where an entity is authorised as an agent under a destination citizenship- or residence-by-investment programme, that authorisation is named, with its number, in the engagement letter for the mandate.",
          "Investment Migration Council (IMC): Citizen Lane is a member; the membership number is provided on request and to any authority verifying it.",
          "Professional-indemnity insurance: whether we hold it, the insurer and the cover limit are disclosed in writing in your engagement letter before any fee falls due.",
        ],
        note: {
          tone: "info",
          text: "We publish only what we can evidence, and we never leave a client-facing statement blank. Identifiers that depend on the entity contracting with you are given in your engagement letter.",
        },
      },
    ],
  },

  {
    slug: "data-retention",
    title: "Data Retention Policy",
    eyebrow: "How long we keep data",
    summary: "We keep personal data no longer than necessary, on the schedule below.",
    sections: [
      {
        heading: "Retention schedule",
        bullets: [
          "Application and identity/KYC records: 10 years after the engagement (AML obligations; Swiss Code of Obligations Art. 958f / Art. 962).",
          "Invoices and payments: 10 years (accounting and VAT).",
          "Client correspondence: 7 years.",
          "Marketing leads: 24 months. Consent receipts: 6 years as proof of consent (GDPR Art. 7(1)) and never auto-purged.",
          "Sessions, authentication tokens and security data: 90 days after expiry.",
          "Pseudonymous product telemetry: 14 days.",
          "Delivery, webhook and idempotency records: 30 days.",
          "Notification and account preferences: for the life of the account, then deleted with it.",
        ],
      },
      {
        heading: "Statutory records are not auto-deleted",
        paragraphs: [
          "Records under a statutory or evidentiary duty are retained and are not deleted by our automated housekeeping. Their disposal requires an authorised process and is recorded in our audit trail (ISO 15489).",
        ],
      },
      {
        heading: "At the end of a period",
        paragraphs: [
          "When a retention period ends and no other duty applies, we delete or irreversibly anonymise the data and record the disposal.",
        ],
      },
    ],
  },

  {
    slug: "accessibility",
    title: "Accessibility Statement",
    eyebrow: "Accessibility",
    summary: "Our accessibility target, what we have done, and how to report a barrier.",
    sections: [
      {
        heading: "Our target",
        paragraphs: [
          "We want every visitor — including people using screen readers, keyboard-only navigation or reduced-motion settings — to be able to use this site and the client portal. Our target is WCAG 2.2 Level AA, the benchmark referenced by EN 301 549 and the EU Web Accessibility Directive.",
        ],
      },
      {
        heading: "What we have implemented",
        bullets: [
          "Skip links and semantic landmarks.",
          "Keyboard-reachable navigation and visible focus indicators.",
          "A reduced-motion-aware interface.",
          "Sufficient colour contrast on public surfaces.",
        ],
      },
      {
        heading: "Known limitations",
        paragraphs: [
          "We test the public surfaces and the client portal against WCAG 2.2 AA, but we state our conformance honestly. The core flows — the landing page, the guided intake, authentication, the legal centre and the portal — are built to Level AA and reviewed for keyboard, screen-reader, colour-contrast and reduced-motion behaviour. Some document-review and upload screens inside the relationship-management workspace are still being tested and are not yet independently audited. Where we know of a barrier, we say so and fix it on the route below rather than claim conformance we cannot evidence.",
        ],
        note: {
          tone: "info",
          text: `If you meet a barrier, contact ${LEGAL_CONTACT.accessibility} and we will help and fix it.`,
        },
      },
    ],
  },
];

// ── FAQ ──────────────────────────────────────────────────────────────────────

/**
 * The FAQ a real prospect asks — cost, timeline, family, dual citizenship, tax,
 * residency, rejection/refund, source of funds, passport timing, dependents.
 * Rendered on the Journal FAQ page and reusable wherever a FAQ block is wanted.
 */
export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: "How long does the process take?",
    a: "Indicatively: Germany, 3–6 months to permanent residence; Austria, 12–24 months under the discretionary quota; Malta citizenship, 12–36 months depending on due diligence. Every timeline is authority-controlled and stated as a planning figure, not a promise.",
  },
  {
    q: "What will this cost in total?",
    a: "Three figures, quoted separately and in advance: our fixed professional fee, the government and due-diligence charges, and third-party costs such as translations, apostilles and travel. Nothing is invoiced without a milestone you approve in the portal.",
  },
  {
    q: "When do I pay?",
    a: "The professional fee is invoiced against the countersigned engagement letter. Government fees and disbursements are invoiced at cost as they fall due, supported by receipts.",
  },
  {
    q: "What happens to my money if I am refused?",
    a: "Government contributions and due-diligence fees are generally non-refundable, including on refusal or withdrawal. Our own professional fee is governed by our refund and termination policy — unearned fees are refunded. See the Terms of Service.",
  },
  {
    q: "Is the investment returned, and when?",
    a: "It depends on the route. Government contributions are not returned. Qualifying investments such as bonds, approved funds or real estate may be returned after a holding period, and their value can go down as well as up. Capital is at risk — see the Risk Warning.",
  },
  {
    q: "Are there ongoing costs after I get the passport or permit?",
    a: "Yes. Expect renewal fees, property holding or fund maintenance costs where relevant, and tax filing obligations in a new country of residence. We flag these before you commit.",
  },
  {
    q: "Will you ask about my source of funds?",
    a: "Always. Source of funds is a mandatory AML check on every route. Be ready to provide bank statements, sale contracts, audited accounts, tax records or evidence of inheritance or gift, plus corporate documents and an ownership chart where a structure invests.",
  },
  {
    q: "Can I be refused, and what are the real odds?",
    a: "Yes — approval rests entirely with the competent authority. Where a programme is discretionary we tell you when the honest probability of refusal is material, before you spend.",
  },
  {
    q: "What disqualifies an applicant?",
    a: "A criminal record, unresolved sanctions or PEP issues, adverse media, and insufficient source-of-funds evidence are the usual reasons. Full and early disclosure of any issue is always better than discovery later.",
  },
  {
    q: "Do you accept clients from all countries?",
    a: "We cannot act for nationals of sanctioned jurisdictions, or where doing so would breach applicable sanctions or a programme's nationality rules — several citizenship-by-investment programmes do not accept applicants who hold the nationality of certain states. That set changes as sanctions change, so rather than publish a list that goes stale, we confirm in confidence, on your first enquiry, whether we can act for your nationality.",
  },
  {
    q: "Can I apply if I have a criminal record or a prior refusal elsewhere?",
    a: "Often yes, with disclosure and the right route — but it depends on the jurisdiction, the offence and the programme. We assess this in confidence before any filing.",
  },
  {
    q: "Which family members can be included?",
    a: "Typically a spouse, dependent children and, in most programmes, dependent parents and sometimes grandparents. Ages and dependency tests vary by programme.",
  },
  {
    q: "Is dual citizenship allowed?",
    a: "It depends on your current nationality and the destination. Some states permit dual citizenship; others require renunciation. We map this for your specific passports before you choose a route.",
  },
  {
    q: "How long until I hold an actual passport?",
    a: "A residence permit is not a passport. For citizenship routes, add certificate issuance, any oath or registration step, and passport application and collection on top of the approval time. We set this out as a distinct timeline.",
  },
  {
    q: "Do we have to live in the country?",
    a: "Residence and citizenship programmes impose minimum-stay or physical-presence requirements, which differ by route and often by family member. We state the requirement for your chosen programme in writing.",
  },
  {
    q: "Will this make me a tax resident?",
    a: "It may. Acquiring residence or citizenship can create tax residence and reporting obligations, including CRS and, for US persons, FATCA. We do not give tax advice — we will introduce a licensed tax adviser.",
  },
  {
    q: "Is my data safe, and who sees my file?",
    a: "Your relationship manager, one senior reviewer, and no one else, unless we must disclose to an authority or an instructed licensed professional. Documents are vaulted, access is logged, and every access is auditable by you.",
  },
  {
    q: "Which jurisdiction should I choose?",
    a: "There is no single best answer. It depends on your travel needs, tax position, family, timeline and refusal risk. We map your case to the right programme in a first, no-obligation consultation.",
  },
  {
    q: "Does IMC membership matter?",
    a: "It commits us to the Investment Migration Council's professional standards, including a fair and transparent complaints process. See our Complaints Procedure and Regulatory Status pages.",
  },
  {
    q: "What does the process actually look like, end to end?",
    a: "It runs in stages, and you can see each one on your portal timeline. First, a no-fee consultation to establish your objective and whether a mandate should exist at all. Then an eligibility assessment and a written scope with fees and refusal risk. Once engaged: a client profile is opened, you upload identity documents, we extract the data and you confirm it, a senior reviewer countersigns it, and our KYC/AML screening runs. You then select the programme, we approve the fit, and we raise the specific document requests. Your file is prepared, reviewed document by document, and dispatched to the competent authority. We follow up with the authority, log the approval in principle, and drive the case to completion. You always know which stage you are in.",
  },
  {
    q: "How long does each stage take?",
    a: "Internal stages are far shorter than the authority's. Onboarding, extraction and your confirmation typically take days to a couple of weeks. Programme selection and the document-collection phase typically run several weeks, depending on how quickly documents can be obtained (some require apostilles or civil-registry certificates). File preparation and dispatch are typically days. The long part is the authority's own processing; once your file is with them, their timeline governs. We chase at set follow-up intervals and tell you when a realistic wait begins.",
  },
  {
    q: "What is the difference between your fee and the investment itself?",
    a: "Our professional fee pays for our advice and the management of your file. The investment or contribution is separate: it is the capital or expenditure the programme itself requires, paid to the destination government or into a qualifying investment, not to us. Government contributions are non-returnable; qualifying investments may be returned after a holding period but carry risk.",
  },
  {
    q: "Can I include a spouse, children or parents who are not financially dependent?",
    a: "It depends on the programme. Some routes extend to adult children up to a certain age, to children in full-time education, or to parents of any dependency status; others apply a strict dependency test. We map your actual family against the rules early, so nobody is added late at extra cost or left off the filing.",
  },
  {
    q: "What passport and visa-free access will I actually get?",
    a: "A residence permit is not a passport and does not by itself grant citizenship. For citizenship routes, you receive a certificate, then a passport, and with it the visa-free access that passport commands at that time. Visa-free lists are set by other states and can change, so we do not promise a specific number of destinations. We set out the current access honestly and note that it can move.",
  },
  {
    q: "Are you lawyers? Do you give legal or tax advice?",
    a: "No. Citizen Lane is an advisory and case-management firm, not a law firm, and we do not practise law or provide legal, tax or investment advice. Where a filing requires a licensed lawyer, notary or licensed agent in a destination jurisdiction, we instruct one and work alongside them; their fees are shown separately. Nothing we publish is an offer, a recommendation or advice to invest.",
  },
  {
    q: "How are you paid? Do you take commissions on investments?",
    a: "We are paid a fixed professional fee by you, quoted in writing, plus pass-through of government charges and disbursements at cost against receipts. We do not present a government charge as our own price, and we do not take an undisclosed commission on a qualifying investment. If any introduction or third-party arrangement carries a fee, it is disclosed to you in writing.",
  },
  {
    q: "Who is your regulator, and are you licensed?",
    a: "Citizen Lane is a member of the Investment Migration Council (IMC) and commits to its professional-standards framework. We are not a bank and not a licensed financial intermediary, and where a service requires a licence in a destination jurisdiction we engage licensed professionals and show their fees separately. We answer to the Swiss Federal Data Protection and Information Commissioner (FDPIC) for data protection; where an entity holds a self-regulatory-organisation (SRO) affiliation under the Anti-Money-Laundering Act, or an accreditation under a programme, that authorisation is named, with its number, in the engagement letter for the mandate and provided on request.",
  },
  {
    q: "What is source of funds, and why do you ask before my budget?",
    a: "Source of funds is evidence of where the specific money you will commit came from; source of wealth is how your overall wealth was accumulated. It is a mandatory anti-money-laundering check on every route — we are legally required to establish and document it before we act. We ask about it before your budget because if we cannot verify the funds, nothing else matters. Being ready to evidence it early is the single biggest thing that protects your timeline.",
  },
  {
    q: "What documents will you ask me for?",
    a: "Always: government photo identification and proof of address. Almost always: source-of-funds and source-of-wealth evidence — bank statements, sale or purchase contracts, audited accounts, tax records, or evidence of inheritance or gift. Where a company, trust or other structure invests: corporate documents and an ownership chart showing the beneficial owner. Route-specific items may include birth and marriage certificates, a police record, a medical certificate, health insurance and powers of attorney. Some must be certified or apostilled. We tell you the exact list for your programme in the portal.",
  },
  {
    q: "How long does due diligence take?",
    a: "Our own KYC/AML screening and internal review typically complete within days to a couple of weeks once we have complete documents. The authority's or programme's own due diligence is separate and can take months — for citizenship routes it is usually the longest single phase. Delays most often come from incomplete source-of-funds evidence or documents awaiting an apostille, so thorough early preparation is what keeps it moving.",
  },
  {
    q: "What happens if the programme changes or closes while I am applying?",
    a: "It can happen: a government may raise thresholds, change qualifying investments, introduce a quota, suspend or close a programme at any time, including mid-application. A well-prepared file submitted early reduces exposure, but no firm can guarantee against a change in law. If a programme changes, we assess the impact on your file, set out your options, and tell you what is recoverable and what is not.",
  },
  {
    q: "What is the difference between citizenship by investment and residence by investment?",
    a: "Residence by investment grants a residence permit in the destination, usually renewable and often a path to citizenship after a period of residence; it is generally faster and cheaper but confers fewer immediate rights. Citizenship by investment grants nationality and a passport, usually after a residence period and enhanced due diligence; it is slower, dearer and subject to greater scrutiny. Which is right depends on your travel needs, tax position, timeline and family — not on which sounds grander.",
  },
  {
    q: "How do you keep my file confidential?",
    a: "Your relationship manager, one senior reviewer, and no one else, unless we must disclose to an authority or to a licensed professional we instruct on your behalf. Documents are vaulted, access to a file is logged, and every access is auditable by you. Our confidentiality obligation survives the end of the engagement. See the Privacy Policy for the full position.",
  },
  {
    q: "What happens after I am approved — how do I get the passport or permit?",
    a: "Approval in principle is a milestone, not the finish. After it, depending on the route, there may be a residence period, an oath or registration step, certificate issuance, and then the actual permit or passport application and collection. We manage those steps and keep them on a distinct timeline, because the time from approval to a document in your hand is often separate from the approval time itself.",
  },
  {
    q: "How do I start?",
    a: "Write to info@citizen-lane.com, or use the guided intake on this site, with a sentence about your objective and where you currently hold citizenship. A relationship manager replies within one business day to arrange a first, no-fee, no-obligation conversation. There is no cost to ask, and we would rather tell you early that we are not the right firm than take a mandate that should not exist.",
  },
];

// ── The FAQ, as a first-class legal page ─────────────────────────────────────

/**
 * The FAQ rendered from `FAQ_ITEMS` (defined below) so the `/legal` centre and
 * the Journal FAQ page show one master list. Appended to the base pages.
 */
const FAQ_LEGAL_PAGE: LegalPage = {
  slug: "frequently-asked-questions",
  title: "Frequently Asked Questions",
  eyebrow: "FAQ",
  summary:
    "The questions a prospective client actually asks — cost, timelines, family, dual citizenship, tax, residency, refusal and refunds.",
  sections: FAQ_ITEMS.map((f) => ({ heading: f.q, paragraphs: [f.a] })),
};

export const LEGAL_PAGES: readonly LegalPage[] = [...LEGAL_PAGES_BASE, FAQ_LEGAL_PAGE];

// ── Derived lookups ──────────────────────────────────────────────────────────

export function legalPageBySlug(slug: string): LegalPage | undefined {
  return LEGAL_PAGES.find((p) => p.slug === slug);
}

/** Nav entries for the footer and the legal index — order is the reading order. */
export const LEGAL_NAV: readonly { slug: string; label: string }[] = [
  { slug: "imprint", label: "Imprint" },
  { slug: "privacy-policy", label: "Privacy Policy" },
  { slug: "terms-of-service", label: "Terms of Service" },
  { slug: "cookie-policy", label: "Cookie Policy" },
  { slug: "anti-money-laundering", label: "AML & KYC" },
  { slug: "risk-warning", label: "Risk Warning" },
  { slug: "regulatory-status", label: "Regulatory Status" },
  { slug: "complaints", label: "Complaints" },
  { slug: "tax-disclaimer", label: "Tax Disclaimer" },
  { slug: "data-retention", label: "Data Retention" },
  { slug: "accessibility", label: "Accessibility" },
  { slug: "frequently-asked-questions", label: "FAQ" },
];

/** Short line for footers, pointing to the legal centre. */
export const LEGAL_FOOTER_NOTE =
  "Citizen Lane is not a law firm and does not provide legal, tax or investment advice. Programme thresholds, fees and timelines are indicative planning figures, not quotations.";

/** Cookie-consent banner copy, kept here so the UI and the policy cannot drift. */
export const COOKIE_BANNER = {
  title: "Cookies on this site",
  body:
    "We use strictly necessary cookies to run this site, and — only with your consent — analytics and marketing cookies. You can accept all, reject non-essential cookies, or manage your preferences. Read our Cookie Policy for detail.",
  accept: "Accept all",
  reject: "Reject non-essential",
  manage: "Manage preferences",
  save: "Save preferences",
  settingsLabel: "Cookie settings",
  policyLabel: "Cookie Policy",
  essential: "Strictly necessary (always on)",
  analytics: "Analytics cookies",
  marketing: "Marketing cookies",
} as const;

/** localStorage key holding the visitor's cookie decision. */
export const COOKIE_CONSENT_STORAGE_KEY = "cl.cookie-consent";
/** Consent version — bump to re-ask every visitor after a policy change. */
export const COOKIE_CONSENT_VERSION = 1;

/** Everything a test or a seed might assert against. */
export function publicLegal() {
  return {
    pages: LEGAL_PAGES,
    faq: FAQ_ITEMS,
    nav: LEGAL_NAV,
    updated: LEGAL_UPDATED,
    verifiedOn: BRAND_VERIFIED_ON,
  };
}
