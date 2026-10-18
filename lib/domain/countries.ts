/**
 * Country codes for document extraction.
 *
 * An MRZ prints ISO 3166-1 **alpha-3** (e.g. `CHE`), while `Intl.DisplayNames`
 * — the platform's own, correctly-localised country names — only accepts
 * **alpha-2** (`CH`). This module is the bridge: a hand-checked alpha-3 →
 * alpha-2 table, with the human-readable label coming from `Intl` rather than a
 * second list of 250 names that would have to be translated three more times.
 *
 * COVERAGE IS DELIBERATE, NOT EXHAUSTIVE. The table carries the EU/EFTA members
 * (which decide the EU/non-EU eligibility question), the programme
 * jurisdictions, and the countries that realistically appear on this desk. A
 * code we do not carry returns `null` so the caller shows the visitor what the
 * document actually printed and leaves the field for them to complete — a
 * guessed country on a filing intake is worse than an empty one.
 *
 * `EU_EFTA` is the roster the routes reference (`nationality_zone` rules in
 * `@/lib/domain/guided-intake`): the 27 EU members plus the 4 EFTA states.
 */

/** ISO 3166-1 alpha-3 → alpha-2 for the countries this practice sees. */
const A3_TO_A2: Readonly<Record<string, string>> = {
  // ── EU members ────────────────────────────────────────────────────────────
  AUT: "AT", BEL: "BE", BGR: "BG", HRV: "HR", CYP: "CY", CZE: "CZ", DNK: "DK",
  EST: "EE", FIN: "FI", FRA: "FR", DEU: "DE", GRC: "GR", HUN: "HU", IRL: "IE",
  ITA: "IT", LVA: "LV", LTU: "LT", LUX: "LU", MLT: "MT", NLD: "NL", POL: "PL",
  PRT: "PT", ROU: "RO", SVK: "SK", SVN: "SI", ESP: "ES", SWE: "SE",
  // ── EFTA ──────────────────────────────────────────────────────────────────
  ISL: "IS", LIE: "LI", NOR: "NO", CHE: "CH",
  // ── Rest of Europe ────────────────────────────────────────────────────────
  GBR: "GB", AND: "AD", MCO: "MC", SMR: "SM", VAT: "VA", UKR: "UA", BLR: "BY",
  RUS: "RU", MDA: "MD", SRB: "RS", ALB: "AL", MKD: "MK", BIH: "BA", MNE: "ME",
  TUR: "TR", XKX: "XK",
  // ── Middle East & Central Asia ────────────────────────────────────────────
  ARE: "AE", SAU: "SA", QAT: "QA", KWT: "KW", BHR: "BH", OMN: "OM", JOR: "JO",
  LBN: "LB", SYR: "SY", IRQ: "IQ", IRN: "IR", ISR: "IL", PSE: "PS", YEM: "YE",
  KAZ: "KZ", UZB: "UZ", KGZ: "KG", TJK: "TJ", TKM: "TM", AZE: "AZ", ARM: "AM",
  GEO: "GE", AFG: "AF",
  // ── South & East Asia ─────────────────────────────────────────────────────
  IND: "IN", PAK: "PK", BGD: "BD", LKA: "LK", NPL: "NP", BTN: "BT", MDV: "MV",
  CHN: "CN", HKG: "HK", MAC: "MO", TWN: "TW", JPN: "JP", KOR: "KR", PRK: "KP",
  MNG: "MN", SGP: "SG", MYS: "MY", IDN: "ID", THA: "TH", VNM: "VN", PHL: "PH",
  KHM: "KH", LAO: "LA", MMR: "MM", BRN: "BN",
  // ── Africa ────────────────────────────────────────────────────────────────
  ZAF: "ZA", NGA: "NG", GHA: "GH", KEN: "KE", TZA: "TZ", UGA: "UG", RWA: "RW",
  ETH: "ET", ERI: "ER", SOM: "SO", SDN: "SD", SSD: "SS", EGY: "EG", LBY: "LY",
  TUN: "TN", DZA: "DZ", MAR: "MA", MRT: "MR", SEN: "SN", CIV: "CI", CMR: "CM",
  COD: "CD", COG: "CG", AGO: "AO", MOZ: "MZ", ZMB: "ZM", ZWE: "ZW", MWI: "MW",
  BWA: "BW", NAM: "NA", MUS: "MU", SYC: "SC", MDG: "MG", GAB: "GA", TGO: "TG",
  BEN: "BJ", BFA: "BF", MLI: "ML", NER: "NE", TCD: "TD", GIN: "GN", SLE: "SL",
  LBR: "LR", GMB: "GM", CPV: "CV", GNB: "GW",
  // ── Americas ──────────────────────────────────────────────────────────────
  USA: "US", CAN: "CA", MEX: "MX", BRA: "BR", ARG: "AR", CHL: "CL", COL: "CO",
  PER: "PE", VEN: "VE", ECU: "EC", URY: "UY", PRY: "PY", BOL: "BO", GUY: "GY",
  SUR: "SR", CRI: "CR", PAN: "PA", GTM: "GT", HND: "HN", SLV: "SV", NIC: "NI",
  BLZ: "BZ", CUB: "CU", DOM: "DO", HTI: "HT", JAM: "JM", TTO: "TT", BRB: "BB",
  BHS: "BS", GRD: "GD", DMA: "DM", LCA: "LC", VCT: "VC", KNA: "KN", ATG: "AG",
  // ── Oceania ───────────────────────────────────────────────────────────────
  AUS: "AU", NZL: "NZ", FJI: "FJ", PNG: "PG", WSM: "WS", TON: "TO", VUT: "VU",
  SLB: "SB", KIR: "KI", NRU: "NR", PLW: "PW", MHL: "MH", FSM: "FM", TUV: "TV",
};

/** The 27 EU members + 4 EFTA states, in alpha-3 — the `nationality_zone` roster. */
const EU_EFTA: ReadonlySet<string> = new Set([
  "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "DEU",
  "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL", "PRT",
  "ROU", "SVK", "SVN", "ESP", "SWE",
  "ISL", "LIE", "NOR", "CHE",
]);

/** Alpha-3 (as printed in an MRZ) → alpha-2, or null when we do not carry it. */
export function alpha2For(alpha3: string | null | undefined): string | null {
  if (!alpha3) return null;
  return A3_TO_A2[alpha3.trim().toUpperCase()] ?? null;
}

/**
 * The country's name in English, or null when the code is outside the table.
 * `Intl.DisplayNames` supplies the label so the wording is the platform's, not
 * a hand-maintained list; a runtime without it falls back to the alpha-2 code
 * rather than dropping the value.
 */
export function countryName(alpha3: string | null | undefined): string | null {
  const a2 = alpha2For(alpha3);
  if (!a2) return null;
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(a2) ?? a2;
  } catch {
    return a2;
  }
}

/** Whether a nationality falls inside the EU/EFTA zone the routes discriminate on. */
export function isEuEfta(alpha3: string | null | undefined): boolean {
  if (!alpha3) return false;
  return EU_EFTA.has(alpha3.trim().toUpperCase());
}
