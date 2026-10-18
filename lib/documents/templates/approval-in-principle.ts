/**
 * Approval-in-Principle letter template.
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
  const subject = letterSubjectFor(business, "APPROVAL_IN_PRINCIPLE", data.caseRef);

  const doc = await buildLetter({
    title: `Approval in Principle — ${data.caseRef}`,
    subject,
    keywords: ["approval-in-principle", data.caseRef],
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

  paragraph(doc, `We are pleased to confirm that your application under the ${data.programme?.name ?? "relevant"} programme has been reviewed and has received approval in principle. This letter confirms that your application meets the substantive requirements for the grant of citizenship, subject to the conditions set out below.`);

  sectionHeading(doc, "Conditions");
  bulletList(doc, [
    "Submission of all outstanding documents as listed in the accompanying document request.",
    "Completion of the enhanced due diligence process, including source-of-funds verification.",
    "Payment of the applicable government and professional fees as set out in the fee schedule.",
    "No material change in your circumstances prior to final approval.",
  ]);

  sectionHeading(doc, "Fee Schedule");
  const schedule = feeScheduleFor(data.programme?.key ?? null, data.programme?.name ?? null, business);
  for (const line of schedule.lines) {
    fieldLine(doc, line.item, line.chf != null ? fmtChf(line.chf) : "at cost");
  }
  doc.y += 6;
  paragraph(doc, `Our professional fee for this engagement is ${fmtChf(professionalFeeOf(data.programme?.key, business))}. Government fees and disbursements are payable at cost and are not included in this amount.`, { size: 9.5, italic: true });

  sectionHeading(doc, "Next Steps");
  paragraph(doc, "Our team will contact you shortly to arrange the next steps. Please do not hesitate to contact your relationship manager should you have any questions in the meantime.");

  drawClosing(doc, { name: issuer.name, role: issuerRoleLabel(issuer.role, business) });

  const { buffer, pages } = await finishLetter(doc);
  return { buffer, pages, title: `Approval in Principle — ${data.caseRef}` };
}
