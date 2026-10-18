/**
 * Searchable PDF builder — emits a minimal %PDF with an invisible text layer.
 */

export type BuildSearchablePdfInput = {
  ocrText: string;
  jpeg: Buffer | null;
};

export type BuildSearchablePdfResult = {
  pdfBytes: Buffer;
  imageEmbedded: boolean;
  pdfACompliant: boolean;
  pageCount: number;
};

export function buildSearchablePdf(input: BuildSearchablePdfInput): BuildSearchablePdfResult {
  const { ocrText, jpeg } = input;
  const imageEmbedded = !!jpeg && jpeg.length > 0;
  const escaped = ocrText.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  // Build a minimal PDF 1.4 with one page, optional image, invisible text (3 Tr).
  const objects: string[] = [];
  // 1: Catalog
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  // 2: Pages
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  let imageObj = "";
  let imageRef = "";
  if (imageEmbedded) {
    imageObj = `4 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg!.length} >>\nstream\n${jpeg!.toString("binary")}\nendstream\nendobj\n`;
    imageRef = " /XObject << /Im0 4 0 R >>";
  }

  // 3: Page
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]${imageRef} /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n`,
  );

  // 5: Content stream with invisible text
  const content = `BT /F1 12 Tf 100 700 Td 3 Tr (${escaped}) Tj ET`;
  objects.push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  // 6: Font
  objects.push("6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(pdf.length);
    pdf += o;
  }
  if (imageEmbedded) {
    offsets.push(pdf.length);
    pdf += imageObj;
  }
  const xrefPos = pdf.length;
  pdf += "xref\n";
  pdf += `0 ${objects.length + (imageEmbedded ? 2 : 1)}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += "trailer\n<< /Size " + (objects.length + (imageEmbedded ? 2 : 1)) + " /Root 1 0 R >>\n";
  pdf += "startxref\n" + xrefPos + "\n%%EOF\n";

  return {
    pdfBytes: Buffer.from(pdf, "latin1"),
    imageEmbedded,
    pdfACompliant: false,
    pageCount: 1,
  };
}

export type Sidecar = { text: string };

export function buildSidecar(text: string): Sidecar {
  return { text: text.replace(/\r\n/g, "\n").replace(/\r/g, "\n") };
}
