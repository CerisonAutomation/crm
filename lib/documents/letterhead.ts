/**
 * Citizen Lane — letterhead PDF scaffolding (server-only).
 */
import { MONOGRAM_D } from "@/components/brand/seal-paths";
import type { BusinessConfig } from "@/lib/business/defaults";
import { CANON_BRAND, type CanonBrand } from "@/lib/brand/defaults";

export const BRAND = {
  cobble: CANON_BRAND.tokens.cobble,
  gold: CANON_BRAND.tokens.gold,
  sky: CANON_BRAND.tokens.sky,
  limestone: CANON_BRAND.tokens.limestone,
  paper: CANON_BRAND.tokens.paper,
  iron: CANON_BRAND.tokens.iron,
  muted: "#6A6A69",
} as const;

const F_ROMAN = "Times-Roman";
const F_BOLD = "Times-Bold";
const F_ITALIC = "Times-Italic";

export const LAYOUT = {
  W: 595.28,
  H: 841.89,
  MX: 68,
  CW: 595.28 - 2 * 68,
  TOP: 64,
  SEAL: 54,
  RULE_Y: 146,
  CONTACT_Y: 158,
  BODY_TOP: 206,
  BODY_BOTTOM: 762,
  FOOTER_RULE_Y: 790,
} as const;

export type PDFDoc = PDFKit.PDFDocument;
type PdfKitCtor = new (options?: PDFKit.PDFDocumentOptions) => PDFDoc;

let ctorPromise: Promise<PdfKitCtor> | null = null;

async function pdfKitCtor(): Promise<PdfKitCtor> {
  if (!ctorPromise) {
    ctorPromise = (async () => {
      const mod = (await import("pdfkit")) as unknown as { default?: PdfKitCtor } & PdfKitCtor;
      const Ctor = ((mod && mod.default) || mod) as PdfKitCtor;
      if (typeof Ctor !== "function") throw new Error("pdfkit: unexpected module shape");
      return Ctor;
    })();
  }
  return ctorPromise;
}

export type LetterStyle = {
  wordmark: string;
  tagline: string;
  senderLine: string;
  contactLine: string;
  shortLine: string;
  confidentiality: string;
  slogan: string;
  signOff: string;
  closing: string;
  place: string;
};

export const DEFAULT_LETTER_STYLE: LetterStyle = {
  wordmark: "CITIZEN LANE",
  tagline: "CITIZENSHIP & RESIDENCE BY INVESTMENT",
  senderLine: "CITIZEN LANE AG · ZURICH",
  contactLine: "CITIZEN LANE AG · ZURICH · INFO@CITIZEN-LANE.COM · +41 55 511 54 00 · WWW.CITIZEN-LANE.COM",
  shortLine: "CITIZEN LANE AG · ZURICH · CITIZEN-LANE.COM",
  confidentiality: "STRICTLY CONFIDENTIAL — FOR THE NAMED ADDRESSEE ONLY",
  slogan: "Let's create tomorrow",
  signOff: "Citizen Lane GmbH · Relationship Management",
  closing: "Yours sincerely,",
  place: "Zurich",
};

export function letterStyleFor(business: BusinessConfig, brand: CanonBrand): LetterStyle {
  const fallback = (value: string, canon: string) => (value && value.trim() ? value : canon);
  const { legalName, place, closing, signOff, confidentiality } = business.firm;
  const { email, phone, site } = brand.contact;
  const upper = (v: string) => v.toUpperCase();
  return {
    wordmark: fallback(upper(brand.wordmark.title), DEFAULT_LETTER_STYLE.wordmark),
    tagline: fallback(upper(brand.wordmark.tagline), DEFAULT_LETTER_STYLE.tagline),
    senderLine: fallback(upper(`${legalName} · ${place}`), DEFAULT_LETTER_STYLE.senderLine),
    contactLine: fallback(
      upper(`${legalName} · ${place} · ${email} · ${phone} · ${site}`),
      DEFAULT_LETTER_STYLE.contactLine,
    ),
    shortLine: fallback(
      upper(`${legalName} · ${place} · ${site}`),
      DEFAULT_LETTER_STYLE.shortLine,
    ),
    confidentiality: fallback(confidentiality, DEFAULT_LETTER_STYLE.confidentiality),
    slogan: fallback(brand.slogan, DEFAULT_LETTER_STYLE.slogan),
    signOff: fallback(signOff, DEFAULT_LETTER_STYLE.signOff),
    closing: fallback(closing, DEFAULT_LETTER_STYLE.closing),
    place: fallback(place, DEFAULT_LETTER_STYLE.place),
  };
}

const STYLES = new WeakMap<PDFDoc, LetterStyle>();

function styleOf(doc: PDFDoc): LetterStyle {
  return STYLES.get(doc) ?? DEFAULT_LETTER_STYLE;
}

export function drawMonogram(doc: PDFDoc, x: number, y: number, size: number, color: string = BRAND.gold) {
  const s = size / 386.7;
  doc.save();
  doc.transform(s, 0, 0, s, x, y);
  doc.path(MONOGRAM_D).fill(color, "even-odd");
  doc.restore();
}

function drawHeader(doc: PDFDoc) {
  const { W, MX, TOP, SEAL } = LAYOUT;
  const style = styleOf(doc);
  doc.rect(0, 0, W, LAYOUT.H).fill(BRAND.paper);

  drawMonogram(doc, MX, TOP, SEAL);

  const wmX = MX + (400 / 386.7) * SEAL + 18;
  doc.font(F_BOLD).fontSize(16.5).fillColor(BRAND.cobble).text(style.wordmark, wmX, TOP + 12, {
    characterSpacing: 5.5,
    lineBreak: false,
  });
  doc.font(F_ROMAN).fontSize(6.6).fillColor(BRAND.sky).text(style.tagline, wmX + 1, TOP + 34, {
    characterSpacing: 2.2,
    lineBreak: false,
  });

  doc.moveTo(MX, LAYOUT.RULE_Y).lineTo(W - MX, LAYOUT.RULE_Y).lineWidth(1).strokeColor(BRAND.gold).stroke();

  doc.font(F_ROMAN).fontSize(7).fillColor(BRAND.muted).text(
    style.contactLine,
    MX,
    LAYOUT.CONTACT_Y,
    { characterSpacing: 0.9, lineBreak: false },
  );
}

function drawContinuationHeader(doc: PDFDoc) {
  const { W, MX, TOP } = LAYOUT;
  doc.rect(0, 0, W, LAYOUT.H).fill(BRAND.paper);
  drawMonogram(doc, MX, TOP - 6, 26);
  doc.font(F_ROMAN).fontSize(7).fillColor(BRAND.muted).text(
    styleOf(doc).shortLine,
    MX + 40,
    TOP,
    { characterSpacing: 0.9, lineBreak: false },
  );
  doc.moveTo(MX, TOP + 22).lineTo(W - MX, TOP + 22).lineWidth(0.75).strokeColor(BRAND.gold).stroke();
  doc.x = MX;
  doc.y = TOP + 44;
}

export type LetterBuildOptions = {
  title: string;
  subject?: string;
  keywords?: string[];
  style?: LetterStyle;
};

export async function buildLetter(opts: LetterBuildOptions): Promise<PDFDoc> {
  const PdfDoc = await pdfKitCtor();
  const doc = new PdfDoc({
    size: "A4",
    margins: { top: LAYOUT.BODY_TOP, bottom: LAYOUT.H - LAYOUT.BODY_BOTTOM, left: LAYOUT.MX, right: LAYOUT.MX },
    bufferPages: true,
    info: {
      Title: opts.title,
      Author: "Citizen Lane GmbH",
      Subject: opts.subject ?? opts.title,
      Keywords: (opts.keywords ?? []).join(", "),
      Creator: "Citizen Lane — Document Service",
    },
  });

  STYLES.set(doc, opts.style ?? DEFAULT_LETTER_STYLE);

  doc.on("pageAdded", () => {
    const n = doc.bufferedPageRange().count;
    if (n > 1) drawContinuationHeader(doc);
    else drawHeader(doc);
  });
  drawHeader(doc);

  doc.x = LAYOUT.MX;
  doc.y = LAYOUT.BODY_TOP;
  return doc;
}

function drawFooters(doc: PDFDoc) {
  const style = styleOf(doc);
  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  for (let i = range.start; i < range.start + pageCount; i += 1) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(LAYOUT.MX, LAYOUT.FOOTER_RULE_Y)
      .lineTo(LAYOUT.W - LAYOUT.MX, LAYOUT.FOOTER_RULE_Y)
      .lineWidth(0.5)
      .strokeColor(BRAND.gold)
      .stroke();
    const y = LAYOUT.FOOTER_RULE_Y + 9;
    const left = style.confidentiality;
    const leftOpts = { characterSpacing: 0.5 };
    doc.font(F_ROMAN).fontSize(6.4).fillColor(BRAND.muted);
    const leftW = doc.widthOfString(left, leftOpts);
    doc.text(left, LAYOUT.MX, y, { ...leftOpts, lineBreak: false });
    const pageText = `Page ${i - range.start + 1} of ${pageCount}`;
    doc.font(F_ROMAN).fontSize(7.5).fillColor(BRAND.muted);
    const pageW = doc.widthOfString(pageText);
    doc.text(pageText, LAYOUT.MX, y, { width: LAYOUT.CW, align: "right", lineBreak: false });
    const gapStart = LAYOUT.MX + leftW + 16;
    const gapEnd = LAYOUT.MX + LAYOUT.CW - pageW - 16;
    if (gapEnd - gapStart > 110) {
      doc.font(F_ITALIC).fontSize(8).fillColor(BRAND.gold).text(style.slogan, gapStart, y + 0.5, {
        width: gapEnd - gapStart,
        align: "center",
        lineBreak: false,
      });
    }
    doc.page.margins.bottom = savedBottom;
  }
}

export async function finishLetter(doc: PDFDoc): Promise<{ buffer: Buffer; pages: number }> {
  const pages = doc.bufferedPageRange().count;
  drawFooters(doc);
  doc.flushPages();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.end();
  const buffer = await done;
  return { buffer, pages };
}

export type LetterParty = {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  nationality?: string | null;
};

export type LetterFrame = {
  party: LetterParty;
  letterRef: string;
  caseRef: string;
  place: string;
  date: Date;
  subject: string;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function fmtSwissDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtChf(amount: number, currency: string = "CHF"): string {
  const grouped = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u2019");
  return `${currency} ${grouped}.\u2013`;
}

function line(doc: PDFDoc, text: string, x: number, y: number, opts?: { characterSpacing?: number; align?: "right" }): void {
  doc.text(text, x, y, { characterSpacing: opts?.characterSpacing, lineBreak: false });
}

export function drawPreamble(doc: PDFDoc, f: LetterFrame, salutation?: string): void {
  const { MX, CW } = LAYOUT;

  doc.font(F_ROMAN).fontSize(7.5).fillColor(BRAND.muted);
  line(doc, styleOf(doc).senderLine, MX, doc.y, { characterSpacing: 0.8 });
  doc.y += 18;

  doc.font(F_ROMAN).fontSize(10).fillColor(BRAND.iron);
  const dateStr = `${f.place}, ${fmtSwissDate(f.date)}`;
  line(doc, dateStr, MX + CW - doc.widthOfString(dateStr), doc.y);
  doc.y += 22;

  doc.font(F_ROMAN).fontSize(10.5).fillColor(BRAND.iron);
  line(doc, f.party.name, MX, doc.y);
  doc.y += 14;
  const lines = [f.party.address, [f.party.city, f.party.country].filter(Boolean).join(", ")]
    .filter((l): l is string => Boolean(l && l.trim()));
  for (const addrLine of lines) {
    line(doc, addrLine, MX, doc.y);
    doc.y += 13;
  }
  doc.y += 20;

  doc.font(F_ROMAN).fontSize(8.5).fillColor(BRAND.muted);
  line(doc, `Application ${f.caseRef} · Letter ${f.letterRef}`, MX, doc.y, { characterSpacing: 0.4 });
  doc.y += 26;

  doc.font(F_BOLD).fontSize(11.5).fillColor(BRAND.cobble);
  doc.text(f.subject.toUpperCase(), MX, doc.y, { width: CW, characterSpacing: 0.4, lineGap: 1 });
  doc.y += 12;

  doc.font(F_ROMAN).fontSize(10.5).fillColor(BRAND.iron);
  doc.text(salutation ?? `Dear ${f.party.name},`, MX, doc.y, { width: CW, lineGap: 3.2 });
  doc.y += 8;
  doc.x = MX;
}

export function paragraph(doc: PDFDoc, text: string, opts?: { gap?: number; size?: number; bold?: boolean; italic?: boolean }): void {
  const { MX, CW } = LAYOUT;
  doc.font(opts?.bold ? F_BOLD : opts?.italic ? F_ITALIC : F_ROMAN)
    .fontSize(opts?.size ?? 10.5)
    .fillColor(opts?.bold ? BRAND.cobble : BRAND.iron)
    .text(text, MX, doc.y, { width: CW, lineGap: 3.2, paragraphGap: opts?.gap ?? 10 });
  doc.x = MX;
}

export function bulletList(doc: PDFDoc, items: string[]): void {
  const { MX, CW } = LAYOUT;
  for (const item of items) {
    const h = doc.heightOfString(item, { width: CW - 16, lineGap: 3.2 });
    ensureSpace(doc, h + 24);
    doc.font(F_ROMAN).fontSize(10.5);
    const y0 = doc.y;
    doc.fillColor(BRAND.gold).text("\u2013", MX, y0, { lineBreak: false });
    doc.fillColor(BRAND.iron).text(item, MX + 16, y0, { width: CW - 16, lineGap: 3.2 });
    doc.y = Math.max(doc.y, y0) + 5;
  }
  doc.y += 4;
  doc.x = MX;
}

export function amountLines(doc: PDFDoc, rows: Array<{ label: string; amount: string | null }>): void {
  const { MX, CW } = LAYOUT;
  for (const row of rows) {
    const amountText = row.amount ?? "at cost";
    const labelWidth = CW - 120;
    const h = doc.heightOfString(row.label, { width: labelWidth, lineGap: 3 });
    ensureSpace(doc, h + 20);
    const y0 = doc.y;
    doc.font(F_ROMAN).fontSize(10.5).fillColor(BRAND.iron).text(row.label, MX, y0, { width: labelWidth, lineGap: 3 });
    doc.font(F_BOLD).fontSize(10.5).fillColor(BRAND.cobble);
    line(doc, amountText, MX + CW - doc.widthOfString(amountText), y0);
    doc.y = Math.max(doc.y, y0) + 7;
  }
  doc.x = MX;
}

export function fieldLine(doc: PDFDoc, label: string, value: string): void {
  const { MX } = LAYOUT;
  const labelOpts = { characterSpacing: 1 };
  doc.font(F_BOLD).fontSize(7.2).fillColor(BRAND.muted);
  const lw = doc.widthOfString(label.toUpperCase(), labelOpts);
  line(doc, label.toUpperCase(), MX, doc.y + 1.5, labelOpts);
  doc.font(F_ROMAN).fontSize(10).fillColor(BRAND.iron);
  line(doc, value, MX + lw + 10, doc.y);
  doc.y += 15;
}

export function sectionHeading(doc: PDFDoc, text: string): void {
  const { MX } = LAYOUT;
  ensureSpace(doc, 56);
  doc.y += 6;
  doc.font(F_BOLD).fontSize(8.5).fillColor(BRAND.gold);
  line(doc, text.toUpperCase(), MX, doc.y, { characterSpacing: 1.6 });
  const headingBottom = doc.y + 12;
  doc.moveTo(MX, headingBottom + 4).lineTo(MX + 26, headingBottom + 4).lineWidth(1).strokeColor(BRAND.gold).stroke();
  doc.y = headingBottom + 12;
  doc.x = MX;
}

export function ensureSpace(doc: PDFDoc, needed: number): void {
  if (doc.y + needed > LAYOUT.BODY_BOTTOM) doc.addPage();
}

export function drawClosing(
  doc: PDFDoc,
  issuer: { name: string; role: string },
  opts?: { closing?: string; enclosures?: string[] },
): void {
  const { MX } = LAYOUT;
  const style = styleOf(doc);
  ensureSpace(doc, 120);
  doc.y += 10;
  doc.font(F_ROMAN).fontSize(10.5).fillColor(BRAND.iron);
  line(doc, opts?.closing ?? style.closing, MX, doc.y);
  doc.y += 40;
  doc.font(F_BOLD).fontSize(10.5).fillColor(BRAND.cobble);
  line(doc, issuer.name, MX, doc.y);
  doc.y += 14;
  doc.font(F_ROMAN).fontSize(8.5).fillColor(BRAND.muted);
  line(doc, style.signOff, MX, doc.y, { characterSpacing: 0.4 });
  doc.y += 13;
  line(doc, issuer.role, MX, doc.y);
  if (opts?.enclosures?.length) {
    doc.y += 26;
    line(doc, "Enclosures:", MX, doc.y);
    doc.y += 12;
    for (const e of opts.enclosures) {
      line(doc, `\u00b7 ${e}`, MX + 8, doc.y);
      doc.y += 11;
    }
  }
}
