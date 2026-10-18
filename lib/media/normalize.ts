/**
 * Scan normalisation for OCR - server-only (sharp).
 *
 * OCRmyPDF pattern, honest subset: EXIF-orientation rotation, contrast
 * normalisation and sharpening. True geometric deskew (Hough skew estimation)
 * needs OpenCV and is NOT claimed here - every result reports exactly what was
 * applied via OrientationReport so callers never overstate the correction.
 *
 * Thin wrappers over sharp: any failure degrades to the input bytes, never a
 * thrown upload failure (the human review step is the right place to catch a
 * crooked scan, not a 500 page).
 */
import sharp from "sharp";

export type OrientationReport = {
  bytes: Buffer;
  /** True when EXIF orientation was applied and stripped. */
  rotationApplied: boolean;
  /** True when contrast/sharpen enhancement was applied. */
  enhanced: boolean;
  width: number | null;
  height: number | null;
};

/** Apply EXIF orientation (auto-rotate) and strip the tag. Never throws. */
export async function correctOrientation(bytes: Buffer): Promise<{ bytes: Buffer; applied: boolean }> {
  try {
    const out = await sharp(bytes, { failOn: "none" }).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    return { bytes: out, applied: true };
  } catch {
    return { bytes, applied: false };
  }
}

/** Greyscale + normalise + sharpen for recogniser input. Never throws. */
export async function enhanceForOcr(bytes: Buffer): Promise<{ bytes: Buffer; applied: boolean }> {
  try {
    const out = await sharp(bytes, { failOn: "none" })
      .rotate()
      .greyscale()
      .normalize()
      .sharpen()
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return { bytes: out, applied: true };
  } catch {
    return { bytes, applied: false };
  }
}

/** Full pre-OCR pass: orientation then enhancement, with a per-step report. */
export async function normaliseForOcr(bytes: Buffer): Promise<OrientationReport> {
  const oriented = await correctOrientation(bytes);
  const enhanced = await enhanceForOcr(oriented.bytes);
  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await sharp(enhanced.bytes).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch {
    /* dimensions stay null - still storable */
  }
  return {
    bytes: enhanced.bytes,
    rotationApplied: oriented.applied,
    enhanced: enhanced.applied,
    width,
    height,
  };
}
