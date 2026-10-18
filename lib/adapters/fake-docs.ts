/**
 * Fake document generators for demo/seed data.
 *
 * Generates realistic-looking document images (PNG via SVG + sharp) with valid
 * MRZ check digits for passports, plus realistic content for bank statements,
 * proof of address, police records, birth certificates, and national IDs.
 *
 * All data is synthetic — no real personal information. Used by seed scripts to
 * populate demo profiles with viewable, OCR-scannable documents.
 */
import sharp from "sharp";
import { mrzCheckDigit } from "@/lib/domain/mrz";

// ───────────────────────────── MRZ (ICAO 9303 TD3) ─────────────────────────────

// Check digits use the canonical domain implementation (R1) — one definition,
// so seeded demo documents can never disagree with the MRZ reader.
const icaoCheckDigit = mrzCheckDigit;

/** Pad a string to a fixed length with '<' characters. */
function padMrz(str: string, len: number): string {
  return str.padEnd(len, "<").slice(0, len);
}

export type MrzInput = {
  documentCode?: string;
  issuingCountry: string;
  surname: string;
  givenNames: string;
  documentNumber: string;
  nationality: string;
  dateOfBirth: string; // YYMMDD
  sex: "M" | "F";
  dateOfExpiry: string; // YYMMDD
  personalNumber?: string;
};

/** Generate valid TD3 MRZ lines (two 44-character strings). */
function generateMrz(input: MrzInput): { line1: string; line2: string } {
  const docCode = padMrz(input.documentCode ?? "P<", 2);
  const issuing = padMrz(input.issuingCountry, 3);
  const name = padMrz(`${input.surname}<<${input.givenNames}`, 38);

  // Line 1: docCode + issuing + name + check digit
  const line1Base = docCode + issuing + name;
  const line1Check = icaoCheckDigit(line1Base);
  const line1 = line1Base + String(line1Check);

  // Line 2: docNum + check + nationality + DOB + check + sex + expiry + check + personal + check + composite
  const docNum = padMrz(input.documentNumber, 9);
  const docCheck = icaoCheckDigit(docNum);
  const nat = padMrz(input.nationality, 3);
  const dob = padMrz(input.dateOfBirth, 6);
  const dobCheck = icaoCheckDigit(dob);
  const sex = input.sex;
  const expiry = padMrz(input.dateOfExpiry, 6);
  const expCheck = icaoCheckDigit(expiry);
  const personal = padMrz(input.personalNumber ?? "", 14);
  const persCheck = icaoCheckDigit(personal);

  const compositeBase =
    docNum +
    String(docCheck) +
    dob +
    String(dobCheck) +
    expiry +
    String(expCheck) +
    personal +
    String(persCheck);
  const compositeCheck = icaoCheckDigit(compositeBase);

  const line2 =
    docNum +
    String(docCheck) +
    nat +
    dob +
    String(dobCheck) +
    sex +
    expiry +
    String(expCheck) +
    personal +
    String(persCheck) +
    String(compositeCheck);

  return { line1, line2 };
}

// ───────────────────────────── SVG document templates ─────────────────────────────

/** Convert an SVG string to a PNG buffer. */
async function svgToPng(
  svg: string,
  width: number,
  height: number
): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 300 })
    .resize(width, height)
    .png()
    .toBuffer();
}

/** Escape XML special characters in text content. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ───────────────────────────── Passport ─────────────────────────────

export type PassportData = {
  surname: string;
  givenNames: string;
  nationality: string;
  issuingCountry: string;
  documentNumber: string;
  dateOfBirth: string; // ISO YYYY-MM-DD
  dateOfExpiry: string; // ISO YYYY-MM-DD
  sex: "M" | "F";
  personalNumber?: string;
};

/** Format a date as YYMMDD for MRZ. */
function toYymmdd(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y.slice(2) + m + d;
}

/** Format a date as DD.MM.YYYY for display. */
function toDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Generate a passport bio page as a PNG buffer. */
export async function generatePassportPng(data: PassportData): Promise<Buffer> {
  const mrz = generateMrz({
    issuingCountry: data.issuingCountry,
    surname: data.surname,
    givenNames: data.givenNames,
    documentNumber: data.documentNumber,
    nationality: data.nationality,
    dateOfBirth: toYymmdd(data.dateOfBirth),
    sex: data.sex,
    dateOfExpiry: toYymmdd(data.dateOfExpiry),
    personalNumber: data.personalNumber,
  });

  const fullName = `${data.givenNames} ${data.surname}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f5f0e8"/>
      <stop offset="100%" style="stop-color:#e8e0d0"/>
    </linearGradient>
    <pattern id="guilloche" patternUnits="userSpaceOnUse" width="200" height="200">
      <circle cx="100" cy="100" r="80" fill="none" stroke="#c79d52" stroke-width="0.5" opacity="0.3"/>
      <circle cx="100" cy="100" r="60" fill="none" stroke="#c79d52" stroke-width="0.5" opacity="0.2"/>
      <circle cx="100" cy="100" r="40" fill="none" stroke="#c79d52" stroke-width="0.5" opacity="0.15"/>
    </pattern>
  </defs>
  <rect width="1240" height="1754" fill="url(#bg)"/>
  <rect width="1240" height="1754" fill="url(#guilloche)"/>
  <rect x="40" y="40" width="1160" height="1674" fill="none" stroke="#12283a" stroke-width="3"/>
  <rect x="60" y="60" width="1120" height="1634" fill="none" stroke="#c79d52" stroke-width="1"/>

  <!-- Header -->
  <text x="620" y="130" font-family="serif" font-size="36" font-weight="bold" fill="#12283a" text-anchor="middle">PASSPORT</text>
  <text x="620" y="170" font-family="serif" font-size="18" fill="#4a4a49" text-anchor="middle">${esc(
    data.issuingCountry
  )}</text>

  <!-- Photo placeholder -->
  <rect x="100" y="220" width="300" height="400" fill="#d0d0d0" stroke="#999" stroke-width="2"/>
  <text x="250" y="430" font-family="sans-serif" font-size="16" fill="#666" text-anchor="middle">PHOTO</text>

  <!-- Data fields -->
  <text x="450" y="260" font-family="sans-serif" font-size="14" fill="#666">Surname / Nom</text>
  <text x="450" y="290" font-family="sans-serif" font-size="22" font-weight="bold" fill="#12283a">${esc(
    data.surname.toUpperCase()
  )}</text>

  <text x="450" y="340" font-family="sans-serif" font-size="14" fill="#666">Given names / Prénoms</text>
  <text x="450" y="370" font-family="sans-serif" font-size="22" font-weight="bold" fill="#12283a">${esc(
    data.givenNames.toUpperCase()
  )}</text>

  <text x="450" y="420" font-family="sans-serif" font-size="14" fill="#666">Nationality / Nationalité</text>
  <text x="450" y="450" font-family="sans-serif" font-size="20" fill="#12283a">${esc(
    data.nationality
  )}</text>

  <text x="450" y="500" font-family="sans-serif" font-size="14" fill="#666">Date of birth / Date de naissance</text>
  <text x="450" y="530" font-family="sans-serif" font-size="20" fill="#12283a">${toDisplayDate(
    data.dateOfBirth
  )}</text>

  <text x="450" y="580" font-family="sans-serif" font-size="14" fill="#666">Sex / Sexe</text>
  <text x="450" y="610" font-family="sans-serif" font-size="20" fill="#12283a">${
    data.sex
  }</text>

  <text x="800" y="260" font-family="sans-serif" font-size="14" fill="#666">Passport No / N° de passeport</text>
  <text x="800" y="290" font-family="sans-serif" font-size="22" font-weight="bold" fill="#12283a">${esc(
    data.documentNumber
  )}</text>

  <text x="800" y="340" font-family="sans-serif" font-size="14" fill="#666">Date of expiry / Date d'expiration</text>
  <text x="800" y="370" font-family="sans-serif" font-size="20" fill="#12283a">${toDisplayDate(
    data.dateOfExpiry
  )}</text>

  <text x="800" y="420" font-family="sans-serif" font-size="14" fill="#666">Authority / Autorité</text>
  <text x="800" y="450" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.issuingCountry
  )} Passport Office</text>

  <!-- MRZ -->
  <rect x="60" y="1450" width="1120" height="200" fill="#fff" stroke="#ccc" stroke-width="1"/>
  <text x="80" y="1520" font-family="monospace" font-size="28" fill="#000" letter-spacing="2">${esc(
    mrz.line1
  )}</text>
  <text x="80" y="1580" font-family="monospace" font-size="28" fill="#000" letter-spacing="2">${esc(
    mrz.line2
  )}</text>
</svg>`;

  return svgToPng(svg, 1240, 1754);
}

// ───────────────────────────── Bank Statement ─────────────────────────────

export type BankStatementData = {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  iban: string;
  statementPeriod: string;
  openingBalance: number;
  closingBalance: number;
  currency: string;
  transactions: Array<{ date: string; description: string; amount: number }>;
};

/** Generate a bank statement as a PNG buffer. */
export async function generateBankStatementPng(
  data: BankStatementData
): Promise<Buffer> {
  const rows = data.transactions
    .map((t, i) => {
      const y = 520 + i * 36;
      const amountStr =
        t.amount >= 0 ? `+${t.amount.toFixed(2)}` : t.amount.toFixed(2);
      const color = t.amount >= 0 ? "#0a7a0a" : "#c00";
      return `<text x="80" y="${y}" font-family="sans-serif" font-size="14" fill="#333">${esc(
        t.date
      )}</text>
    <text x="250" y="${y}" font-family="sans-serif" font-size="14" fill="#333">${esc(
        t.description
      )}</text>
    <text x="1050" y="${y}" font-family="sans-serif" font-size="14" fill="${color}" text-anchor="end">${amountStr}</text>`;
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
  <rect width="1240" height="1754" fill="#fff"/>
  <rect x="0" y="0" width="1240" height="120" fill="#12283a"/>
  <text x="60" y="70" font-family="sans-serif" font-size="28" font-weight="bold" fill="#fff">${esc(
    data.bankName
  )}</text>
  <text x="1180" y="70" font-family="sans-serif" font-size="16" fill="#c79d52" text-anchor="end">STATEMENT</text>

  <text x="60" y="180" font-family="sans-serif" font-size="14" fill="#666">Account holder</text>
  <text x="60" y="210" font-family="sans-serif" font-size="20" font-weight="bold" fill="#12283a">${esc(
    data.accountHolder
  )}</text>

  <text x="60" y="260" font-family="sans-serif" font-size="14" fill="#666">Account number</text>
  <text x="60" y="290" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.accountNumber
  )}</text>

  <text x="500" y="260" font-family="sans-serif" font-size="14" fill="#666">IBAN</text>
  <text x="500" y="290" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.iban
  )}</text>

  <text x="900" y="260" font-family="sans-serif" font-size="14" fill="#666">Period</text>
  <text x="900" y="290" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.statementPeriod
  )}</text>

  <line x1="60" y1="340" x2="1180" y2="340" stroke="#12283a" stroke-width="2"/>

  <text x="60" y="400" font-family="sans-serif" font-size="16" font-weight="bold" fill="#12283a">Transactions</text>
  <line x1="60" y1="420" x2="1180" y2="420" stroke="#ccc" stroke-width="1"/>

  <text x="80" y="470" font-family="sans-serif" font-size="12" fill="#999">DATE</text>
  <text x="250" y="470" font-family="sans-serif" font-size="12" fill="#999">DESCRIPTION</text>
  <text x="1050" y="470" font-family="sans-serif" font-size="12" fill="#999" text-anchor="end">AMOUNT (${esc(
    data.currency
  )})</text>
  <line x1="60" y1="490" x2="1180" y2="490" stroke="#ccc" stroke-width="1"/>

  ${rows}

  <line x1="60" y1="${
    520 + data.transactions.length * 36 + 20
  }" x2="1180" y2="${
    520 + data.transactions.length * 36 + 20
  }" stroke="#12283a" stroke-width="2"/>

  <text x="80" y="${
    520 + data.transactions.length * 36 + 70
  }" font-family="sans-serif" font-size="14" fill="#666">Opening balance</text>
  <text x="1050" y="${
    520 + data.transactions.length * 36 + 70
  }" font-family="sans-serif" font-size="14" fill="#333" text-anchor="end">${data.openingBalance.toFixed(
    2
  )}</text>

  <text x="80" y="${
    520 + data.transactions.length * 36 + 110
  }" font-family="sans-serif" font-size="16" font-weight="bold" fill="#12283a">Closing balance</text>
  <text x="1050" y="${
    520 + data.transactions.length * 36 + 110
  }" font-family="sans-serif" font-size="16" font-weight="bold" fill="#12283a" text-anchor="end">${data.closingBalance.toFixed(
    2
  )}</text>
</svg>`;

  return svgToPng(svg, 1240, 1754);
}

// ───────────────────────────── Proof of Address ─────────────────────────────

export type ProofOfAddressData = {
  utilityName: string;
  accountHolder: string;
  serviceAddress: string;
  billingPeriod: string;
  issueDate: string;
};

/** Generate a proof of address (utility bill) as a PNG buffer. */
export async function generateProofOfAddressPng(
  data: ProofOfAddressData
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
  <rect width="1240" height="1754" fill="#fff"/>
  <rect x="0" y="0" width="1240" height="100" fill="#2c5f8a"/>
  <text x="60" y="60" font-family="sans-serif" font-size="26" font-weight="bold" fill="#fff">${esc(
    data.utilityName
  )}</text>

  <text x="60" y="160" font-family="sans-serif" font-size="14" fill="#666">Bill To</text>
  <text x="60" y="190" font-family="sans-serif" font-size="20" font-weight="bold" fill="#12283a">${esc(
    data.accountHolder
  )}</text>
  <text x="60" y="220" font-family="sans-serif" font-size="16" fill="#333">${esc(
    data.serviceAddress
  )}</text>

  <text x="800" y="160" font-family="sans-serif" font-size="14" fill="#666">Billing Period</text>
  <text x="800" y="190" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.billingPeriod
  )}</text>

  <text x="800" y="230" font-family="sans-serif" font-size="14" fill="#666">Issue Date</text>
  <text x="800" y="260" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.issueDate
  )}</text>

  <line x1="60" y1="320" x2="1180" y2="320" stroke="#2c5f8a" stroke-width="2"/>

  <text x="60" y="380" font-family="sans-serif" font-size="16" font-weight="bold" fill="#12283a">Service Details</text>
  <line x1="60" y1="400" x2="1180" y2="400" stroke="#ccc" stroke-width="1"/>

  <text x="80" y="450" font-family="sans-serif" font-size="14" fill="#666">Service Address</text>
  <text x="80" y="480" font-family="sans-serif" font-size="18" fill="#333">${esc(
    data.serviceAddress
  )}</text>

  <text x="80" y="540" font-family="sans-serif" font-size="14" fill="#666">Account Status</text>
  <text x="80" y="570" font-family="sans-serif" font-size="18" fill="#0a7a0a">Active — Account in good standing</text>

  <text x="80" y="630" font-family="sans-serif" font-size="14" fill="#666">Verification</text>
  <text x="80" y="660" font-family="sans-serif" font-size="14" fill="#333">This document confirms the above-named individual resides at the service address</text>
  <text x="80" y="685" font-family="sans-serif" font-size="14" fill="#333">listed and has an active account with ${esc(
    data.utilityName
  )}.</text>

  <rect x="60" y="1400" width="1120" height="200" fill="#f5f5f5" stroke="#ccc" stroke-width="1"/>
  <text x="80" y="1450" font-family="sans-serif" font-size="12" fill="#999">This is a computer-generated document and does not require a signature.</text>
  <text x="80" y="1480" font-family="sans-serif" font-size="12" fill="#999">For verification, contact ${esc(
    data.utilityName
  )} customer service.</text>
  <text x="80" y="1520" font-family="sans-serif" font-size="12" fill="#999">Document ID: POA-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}</text>
</svg>`;

  return svgToPng(svg, 1240, 1754);
}

// ───────────────────────────── Police Record ─────────────────────────────

export type PoliceRecordData = {
  authority: string;
  country: string;
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  certificateNumber: string;
  issueDate: string;
};

/** Generate a police record / criminal clearance certificate as a PNG buffer. */
export async function generatePoliceRecordPng(
  data: PoliceRecordData
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
  <rect width="1240" height="1754" fill="#fff"/>
  <rect x="40" y="40" width="1160" height="1674" fill="none" stroke="#12283a" stroke-width="3"/>
  <rect x="60" y="60" width="1120" height="1634" fill="none" stroke="#c79d52" stroke-width="1"/>

  <text x="620" y="140" font-family="serif" font-size="32" font-weight="bold" fill="#12283a" text-anchor="middle">${esc(
    data.authority
  )}</text>
  <text x="620" y="180" font-family="serif" font-size="18" fill="#4a4a49" text-anchor="middle">${esc(
    data.country
  )}</text>

  <line x1="200" y1="220" x2="1040" y2="220" stroke="#c79d52" stroke-width="1"/>

  <text x="620" y="280" font-family="serif" font-size="24" font-weight="bold" fill="#12283a" text-anchor="middle">CERTIFICATE OF CRIMINAL RECORD</text>
  <text x="620" y="320" font-family="serif" font-size="16" fill="#4a4a49" text-anchor="middle">Extrait du casier judiciaire</text>

  <text x="200" y="400" font-family="sans-serif" font-size="14" fill="#666">Full name</text>
  <text x="200" y="430" font-family="sans-serif" font-size="20" font-weight="bold" fill="#12283a">${esc(
    data.fullName
  )}</text>

  <text x="200" y="480" font-family="sans-serif" font-size="14" fill="#666">Date of birth</text>
  <text x="200" y="510" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.dateOfBirth
  )}</text>

  <text x="200" y="560" font-family="sans-serif" font-size="14" fill="#666">Nationality</text>
  <text x="200" y="590" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.nationality
  )}</text>

  <text x="700" y="400" font-family="sans-serif" font-size="14" fill="#666">Certificate No.</text>
  <text x="700" y="430" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.certificateNumber
  )}</text>

  <text x="700" y="480" font-family="sans-serif" font-size="14" fill="#666">Date of issue</text>
  <text x="700" y="510" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.issueDate
  )}</text>

  <line x1="200" y1="650" x2="1040" y2="650" stroke="#ccc" stroke-width="1"/>

  <text x="200" y="720" font-family="sans-serif" font-size="16" fill="#333">This is to certify that the above-named individual has no criminal record</text>
  <text x="200" y="750" font-family="sans-serif" font-size="16" fill="#333">on file with the ${esc(
    data.authority
  )} as of the date of issue.</text>

  <text x="200" y="820" font-family="sans-serif" font-size="14" fill="#666">This certificate is valid for 6 months from the date of issue.</text>

  <circle cx="900" cy="900" r="80" fill="none" stroke="#c79d52" stroke-width="2" opacity="0.5"/>
  <text x="900" y="890" font-family="serif" font-size="14" fill="#c79d52" text-anchor="middle" opacity="0.7">OFFICIAL</text>
  <text x="900" y="915" font-family="serif" font-size="14" fill="#c79d52" text-anchor="middle" opacity="0.7">SEAL</text>

  <text x="200" y="1500" font-family="sans-serif" font-size="12" fill="#999">Document ID: PCR-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}</text>
</svg>`;

  return svgToPng(svg, 1240, 1754);
}

// ───────────────────────────── Birth Certificate ─────────────────────────────

export type BirthCertificateData = {
  registry: string;
  country: string;
  fullName: string;
  dateOfBirth: string;
  placeOfBirth: string;
  sex: "M" | "F";
  fatherName: string;
  motherName: string;
  registrationDate: string;
  certificateNumber: string;
};

/** Generate a birth certificate as a PNG buffer. */
export async function generateBirthCertificatePng(
  data: BirthCertificateData
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
  <rect width="1240" height="1754" fill="#fff"/>
  <rect x="40" y="40" width="1160" height="1674" fill="none" stroke="#12283a" stroke-width="3"/>
  <rect x="60" y="60" width="1120" height="1634" fill="none" stroke="#c79d52" stroke-width="1"/>

  <text x="620" y="140" font-family="serif" font-size="32" font-weight="bold" fill="#12283a" text-anchor="middle">${esc(
    data.registry
  )}</text>
  <text x="620" y="180" font-family="serif" font-size="18" fill="#4a4a49" text-anchor="middle">${esc(
    data.country
  )}</text>

  <line x1="200" y1="220" x2="1040" y2="220" stroke="#c79d52" stroke-width="1"/>

  <text x="620" y="280" font-family="serif" font-size="24" font-weight="bold" fill="#12283a" text-anchor="middle">CERTIFICATE OF BIRTH</text>
  <text x="620" y="320" font-family="serif" font-size="16" fill="#4a4a49" text-anchor="middle">Acte de naissance</text>

  <text x="200" y="400" font-family="sans-serif" font-size="14" fill="#666">Full name</text>
  <text x="200" y="430" font-family="sans-serif" font-size="20" font-weight="bold" fill="#12283a">${esc(
    data.fullName
  )}</text>

  <text x="200" y="480" font-family="sans-serif" font-size="14" fill="#666">Date of birth</text>
  <text x="200" y="510" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.dateOfBirth
  )}</text>

  <text x="200" y="560" font-family="sans-serif" font-size="14" fill="#666">Place of birth</text>
  <text x="200" y="590" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.placeOfBirth
  )}</text>

  <text x="200" y="640" font-family="sans-serif" font-size="14" fill="#666">Sex</text>
  <text x="200" y="670" font-family="sans-serif" font-size="18" fill="#12283a">${
    data.sex === "M" ? "Male" : "Female"
  }</text>

  <text x="700" y="400" font-family="sans-serif" font-size="14" fill="#666">Father's name</text>
  <text x="700" y="430" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.fatherName
  )}</text>

  <text x="700" y="480" font-family="sans-serif" font-size="14" fill="#666">Mother's name</text>
  <text x="700" y="510" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.motherName
  )}</text>

  <text x="700" y="560" font-family="sans-serif" font-size="14" fill="#666">Registration date</text>
  <text x="700" y="590" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.registrationDate
  )}</text>

  <text x="700" y="640" font-family="sans-serif" font-size="14" fill="#666">Certificate No.</text>
  <text x="700" y="670" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.certificateNumber
  )}</text>

  <line x1="200" y1="730" x2="1040" y2="730" stroke="#ccc" stroke-width="1"/>

  <text x="200" y="800" font-family="sans-serif" font-size="16" fill="#333">This is to certify that the above-named individual was born on the date</text>
  <text x="200" y="830" font-family="sans-serif" font-size="16" fill="#333">and at the place stated, and that this birth has been duly registered</text>
  <text x="200" y="860" font-family="sans-serif" font-size="16" fill="#333">with the ${esc(
    data.registry
  )}.</text>

  <circle cx="900" cy="950" r="80" fill="none" stroke="#c79d52" stroke-width="2" opacity="0.5"/>
  <text x="900" y="940" font-family="serif" font-size="14" fill="#c79d52" text-anchor="middle" opacity="0.7">REGISTRY</text>
  <text x="900" y="965" font-family="serif" font-size="14" fill="#c79d52" text-anchor="middle" opacity="0.7">SEAL</text>

  <text x="200" y="1500" font-family="sans-serif" font-size="12" fill="#999">Document ID: BC-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}</text>
</svg>`;

  return svgToPng(svg, 1240, 1754);
}

// ───────────────────────────── National ID ─────────────────────────────

export type NationalIdData = {
  country: string;
  idNumber: string;
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  issueDate: string;
  expiryDate: string;
  sex: "M" | "F";
};

/** Generate a national ID card as a PNG buffer. */
export async function generateNationalIdPng(
  data: NationalIdData
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="800" viewBox="0 0 1240 800">
  <defs>
    <linearGradient id="idbg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#e8e0d0"/>
      <stop offset="100%" style="stop-color:#d0c8b8"/>
    </linearGradient>
  </defs>
  <rect width="1240" height="800" fill="url(#idbg)"/>
  <rect x="20" y="20" width="1200" height="760" fill="none" stroke="#12283a" stroke-width="3" rx="12"/>

  <text x="620" y="80" font-family="sans-serif" font-size="28" font-weight="bold" fill="#12283a" text-anchor="middle">${esc(
    data.country
  )}</text>
  <text x="620" y="120" font-family="sans-serif" font-size="18" fill="#4a4a49" text-anchor="middle">NATIONAL IDENTITY CARD</text>

  <rect x="60" y="160" width="200" height="260" fill="#d0d0d0" stroke="#999" stroke-width="2" rx="4"/>
  <text x="160" y="300" font-family="sans-serif" font-size="14" fill="#666" text-anchor="middle">PHOTO</text>

  <text x="320" y="200" font-family="sans-serif" font-size="12" fill="#666">Full name</text>
  <text x="320" y="230" font-family="sans-serif" font-size="20" font-weight="bold" fill="#12283a">${esc(
    data.fullName
  )}</text>

  <text x="320" y="280" font-family="sans-serif" font-size="12" fill="#666">ID Number</text>
  <text x="320" y="310" font-family="sans-serif" font-size="20" font-weight="bold" fill="#12283a">${esc(
    data.idNumber
  )}</text>

  <text x="320" y="360" font-family="sans-serif" font-size="12" fill="#666">Date of birth</text>
  <text x="320" y="390" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.dateOfBirth
  )}</text>

  <text x="320" y="440" font-family="sans-serif" font-size="12" fill="#666">Nationality</text>
  <text x="320" y="470" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.nationality
  )}</text>

  <text x="700" y="200" font-family="sans-serif" font-size="12" fill="#666">Sex</text>
  <text x="700" y="230" font-family="sans-serif" font-size="18" fill="#12283a">${
    data.sex
  }</text>

  <text x="700" y="280" font-family="sans-serif" font-size="12" fill="#666">Issue date</text>
  <text x="700" y="310" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.issueDate
  )}</text>

  <text x="700" y="360" font-family="sans-serif" font-size="12" fill="#666">Expiry date</text>
  <text x="700" y="390" font-family="sans-serif" font-size="18" fill="#12283a">${esc(
    data.expiryDate
  )}</text>

  <text x="60" y="720" font-family="monospace" font-size="14" fill="#333">${esc(
    data.idNumber
  )}&lt;&lt;${esc(data.fullName.replace(/ /g, "&lt;&lt;"))}</text>
</svg>`;

  return svgToPng(svg, 1240, 800);
}

// ───────────────────────────── Demo profile data ─────────────────────────────

/** Demo profile definitions with realistic synthetic data. */
export const DEMO_PROFILES = {
  amelia: {
    surname: "HARTMANN",
    givenNames: "AMELIA",
    nationality: "ZAF",
    issuingCountry: "South Africa",
    documentNumber: "M9042173",
    dateOfBirth: "1987-04-12",
    dateOfExpiry: "2031-04-11",
    sex: "F" as const,
    personalNumber: "1987041242",
  },
  kenji: {
    surname: "TANAKA",
    givenNames: "KENJI",
    nationality: "JPN",
    issuingCountry: "Japan",
    documentNumber: "TR8345219",
    dateOfBirth: "1979-11-02",
    dateOfExpiry: "2029-11-01",
    sex: "M" as const,
    personalNumber: "1979110238",
  },
  isabelle: {
    surname: "MOREAU",
    givenNames: "ISABELLE",
    nationality: "FRA",
    issuingCountry: "France",
    documentNumber: "12XU48291",
    dateOfBirth: "1990-07-21",
    dateOfExpiry: "2030-07-20",
    sex: "F" as const,
    personalNumber: "1990072145",
  },
  michael: {
    surname: "OKAFOR",
    givenNames: "MICHAEL",
    nationality: "NGA",
    issuingCountry: "Nigeria",
    documentNumber: "A00938475",
    dateOfBirth: "1985-03-15",
    dateOfExpiry: "2030-03-14",
    sex: "M" as const,
    personalNumber: "1985031567",
  },
  sara: {
    surname: "AL-RASHID",
    givenNames: "SARA",
    nationality: "ARE",
    issuingCountry: "United Arab Emirates",
    documentNumber: "78419850315",
    dateOfBirth: "1992-09-08",
    dateOfExpiry: "2032-09-07",
    sex: "F" as const,
    personalNumber: "1992090834",
  },
  daniel: {
    surname: "KOVACS",
    givenNames: "DANIEL",
    nationality: "HUN",
    issuingCountry: "Hungary",
    documentNumber: "HU4829103",
    dateOfBirth: "1988-12-03",
    dateOfExpiry: "2028-12-02",
    sex: "M" as const,
    personalNumber: "1988120345",
  },
} as const;

export type DemoProfileKey = keyof typeof DEMO_PROFILES;
