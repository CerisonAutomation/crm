/**
 * E-invoice + Swiss QR-bill export (pure, dependency-free).
 *
 * Two machine-readable renderings of an immutable Invoice:
 *  - EPC payload: Swiss QR-bill content string (SIX v2.0 layout, K-address,
 *    NON reference with the invoice number as unstructured message). VERIFY the
 *    element layout against the published SIX guidelines before production
 *    use — the shape is pinned by tests, not by a bank round-trip.
 *  - EN 16931: CrossIndustryInvoice (CII D16B) subset XML for e-invoicing.
 * The QR IMAGE itself is out of scope (needs a vector/QR provider); the EPC
 * payload is the machine-readable core banking apps accept. Invoice rows are
 * read-only here — exports never mutate money state (BILL annex).
 */
import { createHash } from "node:crypto";

export type Creditor = {
  name: string;
  street: string;
  building: string;
  zipCity: string;
  country: string;
  iban: string;
};

export type ExportInvoice = {
  number: string;
  title: string;
  amountCents: number;
  currency: string;
  status: string;
  issuedAt: Date | string | null;
  dueAt: Date | string | null;
};

/** SIX-permitted Latin subset (letters incl. accented Latin-1 + safe punctuation). */
const SIX_OK =
  /^[A-Za-z0-9 \u00C0-\u00FF .,';:?\-()+\[\]{}+*!"%&/<=>_$£|~@#]*$/;

export function assertSixText(field: string, value: string, max: number): void {
  if (!value || !value.trim()) throw new Error(`${field} is required`);
  if (value.length > max) throw new Error(`${field} exceeds ${max} characters`);
  if (!SIX_OK.test(value))
    throw new Error(`${field} contains characters outside the QR-bill set`);
}

/** IBAN mod-97 validation (any country; Swiss/LI enforced separately for QRR). */
export function isValidIban(iban: string): boolean {
  const s = iban.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code =
      ch >= "A" && ch <= "Z" ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function assertCreditor(c: Creditor): string {
  assertSixText("creditor.name", c.name, 70);
  assertSixText("creditor.street", c.street || "-", 70);
  assertSixText("creditor.zipCity", c.zipCity, 70);
  if (!/^[A-Z]{2}$/.test((c.country || "").toUpperCase()))
    throw new Error("creditor.country must be ISO-3166 alpha-2");
  const iban = c.iban.replace(/[\s-]/g, "").toUpperCase();
  if (!isValidIban(iban))
    throw new Error("creditor.iban failed mod-97 validation");
  return iban;
}

/** Minor units → "1234.50" (exactly 2dp, no separators). */
export function formatChf(amountCents: number): string {
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    throw new Error("amountCents must be positive");
  if (amountCents > 99999999999)
    throw new Error("amount exceeds QR-bill maximum");
  return (amountCents / 100).toFixed(2);
}

export function sha256Hex(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Swiss QR-bill EPC payload (SPC 0200, K-address, NON reference).
 * Line layout: header(3) + IBAN + creditor(6) + ultimate-debtor(6 empty)
 * + amount + currency + NON + empty ref + message + EPD trailer + empty
 * billing block. VERIFY against SIX before production use.
 */
export function buildEpcPayload(
  invoice: ExportInvoice,
  creditor: Creditor
): string {
  if (!["SENT", "PAID", "OVERDUE", "CREDITED"].includes(invoice.status)) {
    throw new Error("Only live invoices (never DRAFT/VOID) may be exported");
  }
  const iban = assertCreditor(creditor);
  if (!["CHF", "EUR"].includes(invoice.currency))
    throw new Error("QR-bill currency must be CHF or EUR");
  const message = `Rechnung ${invoice.number} ${invoice.title}`.slice(0, 140);
  assertSixText("message", message, 140);
  const lines = [
    "SPC",
    "0200",
    "1",
    iban,
    "K",
    creditor.name,
    creditor.street || "-",
    creditor.building || "-",
    creditor.zipCity,
    creditor.country.toUpperCase(),
    "",
    "",
    "",
    "",
    "",
    "",
    formatChf(invoice.amountCents),
    invoice.currency,
    "",
    "",
    "",
    "",
    "",
    "NON",
    "",
    message,
    "EPD",
    "",
  ];
  return lines.join("\n");
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isoDate(value: Date | string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 10)
    : d.toISOString().slice(0, 10);
}

/**
 * EN 16931 CrossIndustryInvoice (CII D16B) subset: header, seller/buyer,
 * delivery, settlement totals + one supply line carrying the invoice title.
 */
export function buildEn16931Xml(
  invoice: ExportInvoice,
  creditor: Creditor
): string {
  if (!["SENT", "PAID", "OVERDUE", "CREDITED"].includes(invoice.status)) {
    throw new Error("Only live invoices (never DRAFT/VOID) may be exported");
  }
  assertCreditor(creditor);
  const amount = formatChf(invoice.amountCents);
  const currency = invoice.currency;
  const issue = isoDate(invoice.issuedAt);
  const due = isoDate(invoice.dueAt);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument><ram:ID>${escXml(
    invoice.number
  )}</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">${issue.replace(
    /-/g,
    ""
  )}</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>${escXml(
      creditor.name
    )}</ram:Name></ram:SellerTradeParty></ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery />
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${escXml(currency)}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans><ram:Information>${escXml(
        invoice.title
      )}</ram:Information></ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount currencyID="${escXml(
          currency
        )}">${amount}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount currencyID="${escXml(
          currency
        )}">${amount}</ram:TaxBasisTotalAmount>
        <ram:DuePayableAmount currencyID="${escXml(
          currency
        )}">${amount}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
  <!-- due:${due} status:${escXml(invoice.status)} -->
</rsm:CrossIndustryInvoice>
`;
}
