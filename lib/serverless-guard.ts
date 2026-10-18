// C3 serverless-scan gate — pure classifier (Prisma-free, Vitest-safe).
//
// Why this exists: sharp, tesseract.js and transformers blow the Vercel
// function budget when bundled into an API route. They are allowed ONLY
// behind narrow seams:
//   - sharp -> src/lib/media + scripts (build-time rasterizer)
//   - tesseract.js -> src/lib/adapters/ocr + src/lib/ai/browser
//   - transformers -> src/lib/ai/browser only
//   - pdfkit -> src/lib/documents only (serverExternalPackages seam)
//
// Route handlers under src/app/api must reach heavy engines through those
// seams — never by direct import. This module is the single source of truth;
// scripts/serverless-scan.mjs is the CLI runner over it.

export const HEAVY_RULES = [
  {
    pkg: "sharp",
    allowedPrefixes: ["src/lib/media/", "src/lib/adapters/", "scripts/"],
    message:
      "sharp is native-bound — import via src/lib/media/* or src/lib/adapters/*, never directly from a route.",
  },
  {
    pkg: "tesseract.js",
    allowedPrefixes: ["src/lib/adapters/ocr/", "src/lib/ai/browser/"],
    message:
      "tesseract.js ships WASM+data — import via src/lib/adapters/ocr/* or src/lib/ai/browser/*, never directly from a route.",
  },
  {
    pkg: "@huggingface/transformers",
    allowedPrefixes: ["src/lib/ai/browser/"],
    message:
      "transformers.js pulls model runtime into the bundle — import via src/lib/ai/browser/*, never directly from a route.",
  },
  {
    pkg: "pdfkit",
    allowedPrefixes: ["src/lib/documents/"],
    message:
      "pdfkit must stay behind the serverExternalPackages seam — import via src/lib/documents/*, never directly from a route.",
  },
] as const;

/** Vercel unzipped function limit is 50MB; standalone warn threshold is local-only signal. */
export const MAX_FUNCTION_MB = 50;
export const WARN_STANDALONE_MB = 80;

export type Violation = {
  file: string;
  pkg: string;
  message: string;
};

const IMPORT_RE =
  /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** True when `file` lives under a server route (the budget-critical surface). */
export function isRouteFile(file: string): boolean {
  const n = normalizePath(file);
  return n.includes("src/app/api/") && n.endsWith("/route.ts");
}

/** True when the import specifier resolves to the heavy package. */
export function specMatchesPkg(spec: string, pkg: string): boolean {
  return spec === pkg || spec.startsWith(`${pkg}/`);
}

/** True when `file` is inside one of the allowed seams for `pkg`. */
export function isAllowedSeam(
  file: string,
  allowedPrefixes: readonly string[]
): boolean {
  const n = normalizePath(file);
  return allowedPrefixes.some((p) => n.includes(p));
}

export function scanContent(file: string, content: string): Violation[] {
  const out: Violation[] = [];
  if (!isRouteFile(file)) return out;
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    for (const rule of HEAVY_RULES) {
      if (
        specMatchesPkg(spec, rule.pkg) &&
        !isAllowedSeam(file, rule.allowedPrefixes)
      ) {
        out.push({
          file: normalizePath(file),
          pkg: rule.pkg,
          message: rule.message,
        });
        break;
      }
    }
  }
  return out;
}

/** Scan many files; pure and deterministic (sorted output). */
export function scanFiles(
  files: Array<{ file: string; content: string }>
): Violation[] {
  const all = files.flatMap((f) => scanContent(f.file, f.content));
  return all.sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.pkg < b.pkg ? -1 : 1
  );
}
