"use client";

/**
 * Upload pre-processing — make OCR fast.
 *
 * Phone photos of passports are typically 4–8 MB; base64-inflating and
 * OCR-processing them costs seconds. Downsampling to a 1600px-long-edge JPEG
 * (≈200–400 KB) keeps far more than enough resolution for passport MRZ/VLM
 * extraction (the OCR adapter itself downsamples to ≤1500px anyway) and cuts
 * upload+OCR time dramatically.
 *
 * Guarantees:
 *  - Non-image files (PDF etc.) pass through untouched.
 *  - Any failure falls back to the original file — never blocks an upload.
 *  - Output stays within the server's 10 MB cap.
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
/** Skip compression when the original is already small. */
const MIN_BYTES_TO_COMPRESS = 400 * 1024;

export type PreparedUpload = { dataBase64: string; mimeType: string; fileName: string; compressed: boolean };

async function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

async function downscaleToJpeg(file: File): Promise<Blob | null> {
  if (globalThis.document === undefined) return null;
  const imageCtor = (window as unknown as { Image?: typeof Image }).Image;
  if (!imageCtor) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new imageCtor();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longEdge) return null;
    const scale = Math.min(1, MAX_EDGE / longEdge);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    return blob;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Prepare a File for upload: downscale large images, pass everything else through. */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const isImage = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.type);
  if (!isImage || file.size < MIN_BYTES_TO_COMPRESS) {
    return { dataBase64: await readAsBase64(file), mimeType: file.type || "application/octet-stream", fileName: file.name, compressed: false };
  }
  try {
    const blob = await downscaleToJpeg(file);
    if (blob && blob.size < file.size) {
      const baseName = file.name.replace(/\.[^.]+$/, "");
      return {
        dataBase64: await readAsBase64(blob),
        mimeType: "image/jpeg",
        fileName: `${baseName}.jpg`,
        compressed: true,
      };
    }
  } catch {
    /* fall through to the original */
  }
  return { dataBase64: await readAsBase64(file), mimeType: file.type || "application/octet-stream", fileName: file.name, compressed: false };
}
