/**
 * H2 port — transcript citations + action-item extraction (deterministic).
 *
 * A transcript becomes citable segments (stable ids + char offsets into the
 * original text) so anything derived from it — a note, a task — can point at
 * the exact words it came from (eval-receipt pattern). Action items come from
 * fixed cue rules, never an LLM: same transcript, same items, unit-testable.
 * No network, no database, no clock: Prisma-free, safe to import anywhere.
 */

export interface TranscriptSegment {
  id: string;
  speaker: string | null;
  text: string;
  start: number;
  end: number;
}

export interface TranscriptCitation {
  segmentId: string;
  quote: string;
}

export interface ActionItem {
  title: string;
  dueHint: string | null;
  sourceIds: string[];
}

export const MAX_ACTION_ITEMS = 10;

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * Split a transcript into citable segments. Speaker turns (`Name: ...`) start
 * a segment; long turns split further on sentence ends so one citation stays
 * short. Ids and offsets are stable for identical input.
 */
export function segmentTranscript(transcript: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let seq = 0;
  const lines = transcript.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let speaker: string | null = null;
    let body = trimmed;
    const m = trimmed.match(/^([A-Za-z][A-Za-z .\-]{0,40}):\s+(.+)$/);
    if (m) {
      speaker = m[1].trim();
      body = m[2].trim();
    }
    const parts = body
      .split(/(?<=[.!?])\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const chunks = parts.length > 0 ? parts : [body];
    let cursor = lineStart + line.indexOf(chunks[0]);
    for (const chunk of chunks) {
      const start = line.indexOf(chunk, cursor - lineStart) + lineStart;
      seq += 1;
      out.push({
        id: "seg-" + pad(seq),
        speaker,
        text: chunk,
        start,
        end: start + chunk.length,
      });
      cursor = start + chunk.length;
    }
  }
  return out;
}

/** Cite segments by id — quotes are sliced from the segment text itself. */
export function citeSegments(
  segments: TranscriptSegment[],
  ids: string[]
): TranscriptCitation[] {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const out: TranscriptCitation[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (s) out.push({ segmentId: id, quote: s.text });
  }
  return out;
}

const CUE =
  /(action item|\btodo\b|follow[ -]?up|will do|shall|need(?:s)? to|must|remember to|make sure|due|by (?:mon|tues|wednes|thurs|fri|satur|sun)day|by tomorrow|next week|asap)/i;
const DUE =
  /\b(by (?:tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)day|next week|\w+ \d{1,2})|due (?:tomorrow|\w+ \d{1,2})|asap)\b/i;

/**
 * Pull action items out of segments with fixed cue rules. A segment yields at
 * most one item; the title is the sentence trimmed to 140 chars, keeping the
 * segment id as its citation. Sorted in transcript order, capped.
 */
export function extractActionItems(
  segments: TranscriptSegment[]
): ActionItem[] {
  const out: ActionItem[] = [];
  for (const s of segments) {
    if (out.length >= MAX_ACTION_ITEMS) break;
    if (!CUE.test(s.text)) continue;
    const due = s.text.match(DUE);
    const title =
      s.text.length > 140 ? s.text.slice(0, 137).trimEnd() + "..." : s.text;
    out.push({ title, dueHint: due ? due[1] : null, sourceIds: [s.id] });
  }
  return out;
}

/** Full derivation in one call: segments, items, and each item cited. */
export function deriveTranscriptInsights(transcript: string): {
  segments: TranscriptSegment[];
  items: Array<ActionItem & { citations: TranscriptCitation[] }>;
} {
  const segments = segmentTranscript(transcript);
  const items = extractActionItems(segments).map((item) => ({
    ...item,
    citations: citeSegments(segments, item.sourceIds),
  }));
  return { segments, items };
}
