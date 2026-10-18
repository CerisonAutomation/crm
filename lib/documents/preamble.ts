/**
 * Shared per-letter preamble (server-only).
 */
import { drawPreamble, type PDFDoc } from "./letterhead";
import type { TemplateInput } from "./letter-data";

/** Draw the standard preamble for a letter, using `subject` as its subject line. */
export function drawLetterPreamble(doc: PDFDoc, input: TemplateInput, subject: string): void {
  const { data, letterRef, date } = input;
  drawPreamble(doc, {
    party: {
      name: data.client.name,
      address: data.client.address,
      city: data.client.city,
      country: data.client.country,
    },
    letterRef,
    caseRef: data.caseRef,
    place: input.business.firm.place,
    date,
    subject,
  });
}
