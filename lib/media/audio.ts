/**
 * Shared audio-container helpers (server-only).
 *
 * `stripDataUrl` unwraps a browser `data:` URL to its base64 payload, and
 * `sniffAudioMime` identifies the audio container by magic bytes for the
 * formats the browser can record. Both were duplicated byte-for-byte between
 * the meetings and teams services; this is the single copy.
 */

/** Strip the `data:<mime>;base64,` prefix when present, leaving the payload. */
export function stripDataUrl(value: string): string {
  const idx = value.indexOf(",");
  if (value.startsWith("data:") && idx >= 0) return value.slice(idx + 1);
  return value;
}

/** Magic-byte sniff for the audio containers the browser can record. */
export function sniffAudioMime(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length < 4) return null;
  if (bytes.subarray(0, 4).toString("hex") === "1a45dfa3") return { mime: "audio/webm", ext: "webm" };
  if (bytes.subarray(0, 4).toString("ascii") === "OggS") return { mime: "audio/ogg", ext: "ogg" };
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp") return { mime: "audio/mp4", ext: "m4a" };
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return { mime: "audio/wav", ext: "wav" };
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return { mime: "audio/mpeg", ext: "mp3" };
  if (bytes.subarray(0, 3).toString("ascii") === "ID3") return { mime: "audio/mpeg", ext: "mp3" };
  return null;
}
