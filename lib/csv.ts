/**
 * CSV encoding with spreadsheet-formula neutralisation.
 *
 * The whole security story for every CSV this platform emits (the admin audit
 * export, the BI reports) lives here. A cell whose value begins with `=`, `+`,
 * `-`, `@`, a tab or a CR is a formula to Excel / Google Sheets, and quoting
 * does NOT stop evaluation — so the leading character is prefixed with an
 * apostrophe. Actor names and targets are attacker-controlled at
 * self-registration, so this is the boundary that keeps a downloaded audit
 * trail from executing `=HYPERLINK(...)`/DDE trickery on an administrator's
 * machine.
 *
 * Prisma-free and dependency-free so it is unit-testable on its own.
 */

/** Neutralise spreadsheet formula injection, then apply RFC-4180 quoting. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV line from a list of cells. */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

/** A full CSV document (CRLF line endings, per RFC 4180) from rows of cells. */
export function csvDocument(rows: ReadonlyArray<readonly unknown[]>): string {
  return rows.map(csvRow).join("\r\n");
}
