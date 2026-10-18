/**
 * Payment Receipt letter template.
 * Server-only; renders a real PDF via pdfkit on the firm letterhead.
 */
import {
  buildLetter, drawPreamble, paragraph, fieldLine, sectionHeading,
  drawClosing, finishLetter, fmtChf,
  type LetterParty,
} from "../letterhead";
import { professionalFeeOf, issuerRoleLabel, letterSubjectFor, type TemplateInput } from "../letter-data";

export async function render(input: TemplateInput) {
  const { data, business, style, issuer, letterRef, date } = input;
  const subject = letterSubjectFor(business, "PAYMENT_RECEIPT", data.caseRef);

  const doc = await buildLetter({
    title: `Payment Receipt — ${data.caseRef}`,
    subject,
    keywords: ["payment-receipt", data.caseRef],
    style,
  });

  const party: LetterParty = {
    name: data.client.name,
    address: data.client.address,
    city: data.client.city,
    country: data.client.country,
    nationality: data.client.nationality,
  };

  drawPreamble(doc, {
    party,
    letterRef,
    caseRef: data.caseRef,
    place: style.place,
    date,
    subject,
  });

  paragraph(doc, `We acknowledge receipt of your payment. This letter serves as an official receipt for the amount received in connection with your application.`);

  sectionHeading(doc, "Receipt Details");
  fieldLine(doc, "Case Reference", data.caseRef);
  fieldLine(doc, "Programme", data.programme?.name ?? "—");
  fieldLine(doc, "Date", date.toLocaleDateString("en-GB"));
  fieldLine(doc, "Amount Received", fmtChf(professionalFeeOf(data.programme?.key, business)));
  doc.y += 6;

  sectionHeading(doc, "Confirmation");
  paragraph(doc, `This receipt confirms that payment of ${fmtChf(professionalFeeOf(data.programme?.key, business))} has been received and credited to your case. Please retain this letter for your records.`);

  drawClosing(doc, { name: issuer.name, role: issuerRoleLabel(issuer.role, business) });

  const { buffer, pages } = await finishLetter(doc);
  return { buffer, pages, title: `Payment Receipt — ${data.caseRef}` };
}
