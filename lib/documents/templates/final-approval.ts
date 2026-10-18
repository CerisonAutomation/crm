/**
 * Final Approval letter template.
 * Server-only; renders a real PDF via pdfkit on the firm letterhead.
 */
import {
  buildLetter, drawPreamble, paragraph, bulletList, fieldLine, sectionHeading,
  drawClosing, finishLetter, fmtChf,
  type LetterParty,
} from "../letterhead";
import { feeScheduleFor, professionalFeeOf, issuerRoleLabel, letterSubjectFor, type TemplateInput } from "../letter-data";

export async function render(input: TemplateInput) {
  const { data, business, style, issuer, letterRef, date } = input;
  const subject = letterSubjectFor(business, "FINAL_APPROVAL", data.caseRef);

  const doc = await buildLetter({
    title: `Final Approval — ${data.caseRef}`,
    subject,
    keywords: ["final-approval", data.caseRef],
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

  paragraph(doc, `We are delighted to inform you that your application under the ${data.programme?.name ?? "relevant"} programme has received final approval. All conditions precedent have been satisfied and the competent authority has confirmed the grant of citizenship.`);

  sectionHeading(doc, "Confirmation of Approval");
  fieldLine(doc, "Case Reference", data.caseRef);
  fieldLine(doc, "Programme", data.programme?.name ?? "—");
  fieldLine(doc, "Approval Date", date.toLocaleDateString("en-GB"));
  doc.y += 6;

  sectionHeading(doc, "Fee Summary");
  const schedule = feeScheduleFor(data.programme?.key ?? null, data.programme?.name ?? null, business);
  for (const line of schedule.lines) {
    fieldLine(doc, line.item, line.chf != null ? fmtChf(line.chf) : "at cost");
  }
  doc.y += 6;
  paragraph(doc, `Total professional fees: ${fmtChf(professionalFeeOf(data.programme?.key, business))}.`, { bold: true });

  sectionHeading(doc, "Next Steps");
  bulletList(doc, [
    "Your citizenship certificate and passport will be dispatched to your registered address within 10 business days.",
    "Our team will contact you to arrange the oath of allegiance ceremony.",
    "Please retain this letter for your records as evidence of the approval.",
  ]);

  drawClosing(doc, { name: issuer.name, role: issuerRoleLabel(issuer.role, business) });

  const { buffer, pages } = await finishLetter(doc);
  return { buffer, pages, title: `Final Approval — ${data.caseRef}` };
}
