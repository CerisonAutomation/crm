/**
 * Brand facts — the firm as it actually is, harvested from the live site.
 *
 * This is the single source of truth for anything a visitor could read as a
 * statement about the firm: where the offices are, whether we hold IMC
 * membership, who founded the practice. It is deliberately plain data with no
 * Prisma and no JSX so that a server route, a client component and a test can
 * all read the same values.
 *
 * ACCURACY CONTRACT — every field here is a factual claim about a real
 * business. `verifiedOn` records when it was last checked against the live
 * site; if a phone number, address or membership lapses, the public claim
 * becomes misleading. Update `verifiedOn` whenever you touch a value.
 *
 * RECONCILIATION (2026-10-06) — the firm's own pages disagreed with each other;
 * each conflict below was resolved against the strongest evidence rather than
 * picked arbitrarily:
 *   · Swiss legal form — the live site footer prints "Citizen Lane GmbH
 *     (Switzerland)" and "Copyright © 2016-2024 Citizen Lane GmbH", so the
 *     entity is a GmbH, not the AG the app previously carried.
 *   · Zurich postal code — the footer prints 8602, but the firm's own /contact
 *     and /erlebnisbahn pages print 8306, and three independent directory
 *     entries for "Fabrikweg 2, Brüttisellen" all give 8306. The footer's 8602
 *     (the postcode of neighbouring municipality Wangen-Brüttisellen) is the
 *     stale value; 8306 is used here.
 *   · Contact e-mail — the footer and every page print info@citizen-lane.com;
 *     one /job-search page prints info@citizenlane.ch (an older .ch domain).
 *     The .com address is treated as canonical.
 *   · Testimonials — reproduced VERBATIM as the clients gave them, and no
 *     client is credited with a programme the source did not state.
 */

/** Date the facts below were last reconciled with the live site. */
export const BRAND_VERIFIED_ON = "2026-10-06";

export type Office = {
  /** Stable key for keys/lookups. */
  key: string;
  city: string;
  /** Line-by-line postal address, in the order it should be printed. */
  address: readonly string[];
  phone: string;
  /** E.164 for `tel:` links. */
  phoneHref: string;
  /** A second public line, where the firm publishes one (optional). */
  phone2?: string;
  /** E.164 for the second line's `tel:` link. */
  phone2Href?: string;
  /** What this office is for — printed under the city. */
  role: string;
};

/**
 * The four practising offices. Zurich is the registered seat; Vienna, Malta
 * and Mumbai are the desks the firm publishes on its live /contact page. Malta
 * is the EU member-state desk (most relevant to Maltese citizenship/residence
 * filings); Mumbai serves the India and Gulf corridor.
 *
 * Order runs Switzerland → Austria → Malta → India. The landing band and the
 * Imprint both render this array, so adding an office here is the only edit
 * needed to add it everywhere.
 */
export const OFFICES: readonly Office[] = [
  {
    key: "zurich",
    city: "Zurich",
    address: ["Citizen Lane GmbH", "Fabrikweg 2", "8306 Brüttisellen", "Switzerland"],
    phone: "+41 55 511 54 00",
    phoneHref: "+41555115400",
    role: "Registered office",
  },
  {
    key: "vienna",
    city: "Vienna",
    address: ["Citizen Lane", "Goldenes Quartier, Tuchlauben 7a", "1010 Wien", "Austria"],
    phone: "+43 720 143 551",
    phoneHref: "+43720143551",
    role: "Austria desk",
  },
  {
    key: "malta",
    city: "Malta",
    address: ["Citizen Lane Ltd", "12 Empire Stadium Street", "Gzira GZR1301", "Malta"],
    phone: "+356 2034 1750",
    phoneHref: "+35620341750",
    role: "EU member-state desk",
  },
  {
    key: "mumbai",
    city: "Mumbai",
    address: [
      "Citizen Lane Consulting Pvt. Ltd.",
      "Unit 102, Windfall Building, Sahar Plaza",
      "JB Nagar, Andheri East",
      "Mumbai 400059, India",
    ],
    phone: "+91 98200 40187",
    phoneHref: "+919820040187",
    phone2: "+91 99 6759 6973",
    phone2Href: "+919967596973",
    role: "India & Gulf desk",
  },
];

/**
 * The registered legal entities, stated once. The public legal pages build
 * their `SWISS_ENTITY` / `MALTA_ENTITY` / `INDIA_ENTITY` constants from these
 * so an entity name or address can never disagree between the Imprint, the
 * Terms and the landing page.
 *
 * SWITZERLAND — the company number, UID and seat are taken from the official
 * Swiss commercial register (Zefix), record for Citizen Lane GmbH, which is the
 * authority of record; the register is public and free to check.
 * MALTA — the registration number is from the Malta Business Registry record
 * for Citizen Lane Ltd.
 */
export const ENTITIES = {
  switzerland: {
    name: "Citizen Lane GmbH",
    address: "Fabrikweg 2, 8306 Brüttisellen, Switzerland",
    /** Registered seat (Sitz) per the commercial register. */
    seat: "Wangen-Brüttisellen, Canton of Zurich",
    /** Commercial-register company number (CH-ID). */
    registerNumber: "CH-130-4021898-7",
    /** Swiss business identification number (UID); also the Swiss VAT (MWST) number. */
    uid: "CHE-351.138.343",
    register: "Commercial register of the Canton of Zurich (Handelsregister des Kantons Zürich)",
    /** Free-to-check cantonal register excerpt for this entity. */
    registerUrl: "https://zh.chregister.ch/cr-portal/auszug/auszug.xhtml?uid=CHE-351.138.343",
  },
  malta: {
    name: "Citizen Lane Ltd",
    address: "12 Empire Stadium Street, Gzira GZR1301, Malta",
    register: "Malta Business Registry",
    registrationNumber: "C 96305",
  },
  india: {
    name: "Citizen Lane Consulting Pvt. Ltd.",
    address: "Unit 102, Windfall Building, Sahar Plaza, JB Nagar, Andheri East, Mumbai 400059, India",
    register: "Registrar of Companies, Ministry of Corporate Affairs, India",
  },
} as const;

/**
 * Professional bodies the practice is a member of. A membership is a claim
 * that carries obligations, so it is listed only where it genuinely holds.
 *
 * A FinanceMalta membership badge appears in the research asset inventory but
 * is never stated anywhere as a textual claim, so it is deliberately NOT
 * listed until the firm confirms the membership.
 */
export const MEMBERSHIPS: readonly { key: string; name: string; abbr: string; note: string }[] = [
  {
    key: "imc",
    name: "Investment Migration Council",
    abbr: "IMC",
    note: "The worldwide association for investor migration, and the body behind the industry's professional standards. Citizen Lane follows the IMC Code of Ethics and Professional Conduct.",
  },
];

/** The founder, told plainly — used on the landing story block. */
export const FOUNDER = {
  name: "Till Neumann",
  role: "Founder",
  foundedYear: 2015,
  /** Two-to-three sentences; the landing page renders this verbatim. */
  story:
    "Citizen Lane was founded in 2015 by Till Neumann, after years spent inside one of the largest firms in the field. The practice was built on a simple observation: investor migration had become a sales business, and the people best served by it were the ones who never got a straight answer.",
  /** The prior-firm credential, stated as a credential rather than a boast. */
  background: "Formerly department head for Caribbean citizenship programmes at Henley & Partners",
} as const;

/** One client testimonial: who said it, what they said, and the route (or null). */
export type Testimonial = {
  key: string;
  /** As the client is willing to be named publicly. */
  attribution: string;
  quote: string;
  /** Programme key when known, else null. */
  programme: string | null;
};

/**
 * Client testimonials, reproduced VERBATIM as given — these are the clients'
 * own words, not our summary of them. `programme` is the route the client
 * actually took where the source states it; it is null wherever the source did
 * not say, because crediting a client with a route they never named would
 * invent a fact.
 *
 * ORDER MATTERS: the first entry is the concise one and is rendered large as
 * the landing pull-quote; the full-length accounts follow, in the practice
 * list. Keep the shortest quote first (see `landing.tsx`).
 */
export const TESTIMONIALS: readonly Testimonial[] = [
  {
    key: "fatma-a",
    attribution: "Fatma A.",
    quote:
      "The consultants understand me, the level of service is impeccable, I feel well served. Not much to add.",
    // The source published the quote; it did not say which route Fatma filed.
    programme: null,
  },
  {
    key: "edward-klorman",
    attribution: "Edward Klorman",
    quote:
      "With every step of the process, they handled the materials with efficiency, attention to detail, and expertise. I appreciated the professionalism and excellent communication from Mr. Neumann and from his team members, who helped us to prepare our file and to expedite its processing. I've heard that cases like ours can sometimes take years to be processed, but Mr. Neumann's contacts with the agency enabled him to check on my file to ensure we received our citizenships in a timely way. We are very pleased with the outcome, and I can recommend Citizen Lane's services to anyone looking for support with their citizenship needs.",
    programme: null,
  },
  {
    key: "armen-aztayan",
    attribution: "Armen Aztayan",
    quote:
      "I recently had the pleasure of working with Citizen Lane, a legal services business located in Malta, and I must say, my experience was exceptional. From the very first contact, I was impressed by their professionalism and willingness to go above and beyond to meet my needs. Despite having a very sophisticated customised request and a sense of urgency, Citizen Lane was able to perform pro-actively and deliver results that exceeded my expectations. Their attention to detail and ability to communicate effectively made the entire process smooth and stress-free. I look forward to cooperating with Citizen Lane in the future and am confident that they will continue to provide outstanding service.",
    programme: null,
  },
  {
    key: "armin-k",
    attribution: "Armin K.",
    quote:
      "Citizen Lane is amazing. They helped through my residency program, were fully responsive and professional. I am grateful to their team for helping me throughout.",
    programme: null,
  },
];

/** The regulatory position, stated once so it is not paraphrased inconsistently. */
export const REGULATORY_NOTE =
  "Citizen Lane is not a law firm and does not provide legal advice. Where a filing requires a licensed lawyer in the destination jurisdiction, we instruct one and work alongside them. Indicative investment thresholds, fees and processing times are planning figures, not quotations.";

export function officeByKey(key: string): Office | undefined {
  return OFFICES.find((o) => o.key === key);
}

/** Public-safe projection — identical to the data, but a single import site. */
export function publicBrand() {
  return {
    offices: OFFICES,
    memberships: MEMBERSHIPS,
    founder: FOUNDER,
    testimonials: TESTIMONIALS,
    regulatoryNote: REGULATORY_NOTE,
    verifiedOn: BRAND_VERIFIED_ON,
  };
}
