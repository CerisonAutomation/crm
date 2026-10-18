/**
 * OCR text normalisation — whitespace/control cleanup only, never character correction.
 */
export function normalizeOcrText(text: string): string {
  // Collapse runs of spaces/tabs to a single space, normalise CRLF/CR to LF,
  // drop control chars (except \n), collapse 3+ newlines to 2.
  let out = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/ *\n */g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trimEnd();
}
