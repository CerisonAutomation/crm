/**
 * Image normalisation + derivative generation (server-only).
 *
 * Two jobs, both driven from ONE place so the upload route, the OCR pipeline and
 * any future surface agree on what a stored image looks like:
 *
 *  1. **Normalise** — strip EXIF/GPS metadata (a passport photo carries the
 *     applicant's home coordinates; storing that is a privacy incident, not a
 *     feature), auto-rotate from EXIF orientation, and cap the long edge so a
 *     48-megapixel phone photo does not become a 40 MB vault object.
 *
 *  2. **Derivatives** — emit a small preview (list/thumbnail) and a mid-size
 *     display rendition, so the app never ships the original to a browser just
 *     to paint a 64px avatar.
 *
 * HEIC/HEIF is deliberately NOT decoded here: sharp needs libheif compiled in,
 * and silently failing on the most common iPhone format would be worse than
 * refusing it. `isImage` only claims formats we can actually process.
 *
 * Nothing in this module throws for an unsupported input — callers get the
 * original bytes back unchanged, so adding image support can never break an
 * upload path that already worked.
 */
import sharp from "sharp";
import { DomainError } from "@/lib/domain/states";

/** Mime types sharp can decode on a stock build. */
const DECODABLE = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/tiff",
  "image/avif",
  "image/gif",
]);

export type ImageDerivative = {
  /** Object-key suffix, e.g. "preview" → `<key>.preview.webp`. */
  name: string;
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
};

export type NormalisedImage = {
  /** Re-encoded, metadata-free original (or the input untouched when not an image). */
  bytes: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
  /** True when the bytes were re-encoded rather than passed through. */
  normalised: boolean;
  derivatives: ImageDerivative[];
};

/** Pixel cap for the stored original — long edge. Generous enough for OCR (300dpi A4 ≈ 2480px). */
export const MAX_ORIGINAL_EDGE = 4000;
/** Renditions: [suffix, long edge, quality]. Ordered small → large. */
const RENDITIONS: ReadonlyArray<readonly [string, number, number]> = [
  ["thumb", 192, 72],
  ["preview", 1280, 78],
];

/** Whether this mime type is one we can decode and re-encode. */
export function isDecodableImage(mimeType: string): boolean {
  return DECODABLE.has(mimeType.toLowerCase().split(";")[0].trim());
}

/** Long edge of an image, or null when it cannot be read. */
async function dimensions(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/**
 * Normalise an uploaded image and build its renditions.
 *
 * `maxEdge` is the caller's cap for the stored original (from admin settings),
 * clamped to a sane floor so a misconfigured 10px cap cannot destroy a document.
 */
export async function normaliseImage(
  bytes: Buffer,
  mimeType: string,
  opts: { maxEdge?: number } = {},
): Promise<NormalisedImage> {
  const passThrough: NormalisedImage = {
    bytes, mimeType, width: null, height: null, normalised: false, derivatives: [],
  };
  if (!isDecodableImage(mimeType)) return passThrough;

  const edge = Math.max(320, Math.min(8000, Math.round(opts.maxEdge ?? MAX_ORIGINAL_EDGE)));

  try {
    // `.rotate()` with no argument applies the EXIF orientation and then drops
    // the tag; sharp strips all other metadata unless `withMetadata()` is called.
    const pipeline = sharp(bytes, { failOn: "none" }).rotate();
    const meta = await pipeline.metadata();

    const original = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    // One decode per rendition; a corrupt frame degrades to "no derivative"
    // rather than failing the upload.
    const derivatives: ImageDerivative[] = [];
    for (const [name, longEdge, quality] of RENDITIONS) {
      try {
        const out = await sharp(bytes, { failOn: "none" })
          .rotate()
          .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
          .webp({ quality })
          .toBuffer();
        const dim = await dimensions(out);
        if (dim) {
          derivatives.push({
            name, bytes: out, mimeType: "image/webp",
            width: dim.width, height: dim.height, sizeBytes: out.byteLength,
          });
        }
      } catch {
        /* this rendition is unavailable — the original is still stored */
      }
    }

    return {
      bytes: original,
      mimeType: "image/jpeg",
      width: meta.width ?? null,
      height: meta.height ?? null,
      normalised: true,
      derivatives,
    };
  } catch {
    // Undecodable despite a known mime type (truncated file, wrong extension).
    // Store the original: the human review step is the right place to catch this.
    return passThrough;
  }
}

/**
 * Object key for a derivative, derived from the original key so the two can
 * never drift: `vault://x/y.jpg` + "preview" → `vault://x/y.jpg.preview.webp`.
 */
export function derivativeKey(storageKey: string, name: string): string {
  if (!storageKey.startsWith("vault://")) {
    throw new DomainError("Invalid storage key", 422);
  }
  return `${storageKey}.${name}.webp`;
}
