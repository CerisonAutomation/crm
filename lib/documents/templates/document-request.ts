/**
 * Document Request letter template.
 * Server-only; renders a real PDF via pdfkit on the firm letterhead.
 */
import {
  buildLetter, drawPreamble, paragraph, bulletList, fieldLine, sectionHeading,
  drawClosing, finishLetter, fmtSwissDate,
  type LetterParty,
} from "../letterhead";
import { issuerRoleLabel, letterSubjectFor, type TemplateInput } from "../letter-data";

export async function render(input: TemplateInput) {
  const { data, business, style, issuer, letterRef, date } = input;
  const subject = letterSubjectFor(business, "DOCUMENT_REQUEST", data.caseRef);

  const doc = await buildLetter({
    title: `Document Request — ${data.caseRef}`,
    subject,
    keywords: ["document-request", data.caseRef],
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

  paragraph(doc, `As part of the processing of your application, we require the following outstanding documents. Please submit these at your earliest convenience to avoid any delay in the progress of your case.`);

  sectionHeading(doc, "Outstanding Documents");
  if (data.outstandingRequests.length === 0) {
    paragraph(doc, "There are no outstanding document requests at this time.", { italic: true });
  } else {
    for (const req of data.outstandingRequests) {
      const due = req.dueDate ? fmtSwissDate(req.dueDate) : req.flexible ? "Flexible" : "As soon as possible";
      fieldLine(doc, req.label, `${req.title} — due ${due}`);
      if (req.instructions) {
        paragraph(doc, req.instructions, { size: 9.5, italic: true });
      }
      doc.y += 4;
    }
  }

  sectionHeading(doc, "Submission");
  paragraph(doc, "Documents may be submitted securely through the client portal or by email to your relationship manager. Please ensure that all documents are clear, legible and valid at the time of submission.");

  drawClosing(doc, { name: issuer.name, role: issuerRoleLabel(issuer.role, business) });

  const { buffer, pages } = await finishLetter(doc);
  return { buffer, pages, title: `Document Request — ${data.caseRef}` };
}
