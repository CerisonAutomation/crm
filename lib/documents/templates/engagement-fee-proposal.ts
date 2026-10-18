/**
 * Engagement Fee Proposal letter template.
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
  const subject = letterSubjectFor(business, "ENGAGEMENT_FEE_PROPOSAL", data.caseRef);

  const doc = await buildLetter({
    title: `Engagement Fee Proposal — ${data.caseRef}`,
    subject,
    keywords: ["engagement-fee-proposal", data.caseRef],
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

  paragraph(doc, `Thank you for engaging Citizen Lane. We are pleased to set out below our fee proposal for the ${data.programme?.name ?? "relevant"} programme. This proposal is valid for 30 days from the date of this letter.`);

  sectionHeading(doc, "Fee Schedule");
  const schedule = feeScheduleFor(data.programme?.key ?? null, data.programme?.name ?? null, business);
  for (const line of schedule.lines) {
    fieldLine(doc, line.item, line.chf != null ? fmtChf(line.chf) : "at cost");
  }
  doc.y += 6;
  paragraph(doc, `Our professional fee is ${fmtChf(professionalFeeOf(data.programme?.key, business))}.`, { bold: true });

  sectionHeading(doc, "Terms of Engagement");
  bulletList(doc, schedule.terms);

  sectionHeading(doc, "Payment");
  paragraph(doc, "Payment is due upon acceptance of this proposal. An invoice will be issued separately. All fees are exclusive of any applicable taxes.");

  drawClosing(doc, { name: issuer.name, role: issuerRoleLabel(issuer.role, business) });

  const { buffer, pages } = await finishLetter(doc);
  return { buffer, pages, title: `Engagement Fee Proposal — ${data.caseRef}` };
}
