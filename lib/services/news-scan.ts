/**
 * Regulatory watch — the admin news-scan.
 *
 * Polls OFFICIAL sources for a programme family, diffs each fetched page against
 * the hash stored on its last finding, and — when the page changed — extracts a
 * structured proposal an admin can review. Nothing is ever auto-published:
 * approval creates a new DRAFT `ProgramVersion`, and a change to a LIVE
 * programme is blocked until a second official source corroborates it. That
 * two-source rule is what prevents a single mis-read page from flipping a live
 * programme into a false "MEIN-style" panic.
 *
 * Rules enforced here, not at the call site:
 *   • only domains in `OFFICIAL_SOURCE_DOMAINS` are ever fetched;
 *   • the extractor may only summarise text that was actually fetched;
 *   • a live programme needs two sources before its terms can change.
 */
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/integrations";
import { DomainError } from "@/lib/domain/states";
import { PROGRAMMES } from "@/lib/domain/programmes";

/** Official source domains the scanner is permitted to fetch. */
export const OFFICIAL_SOURCE_DOMAINS: readonly string[] = [
  "residencymalta.gov.mt",
  "gov.mt",
  "eur-lex.europa.eu",
  "curia.europa.eu",
  "migration.gov.gr",
  "et.gr",
  "migration.gov.cy",
  "mof.gov.cy",
  "europa.eu",
];

/** Fields the extractor looks for, so a proposal names what changed. */
const FIELD_HINTS: readonly string[] = [
  "fee", "investment", "threshold", "timeline", "processing",
  "requirement", "quota", "deadline", "minimum", "capital",
];

/** How long a fetched page is reused before it is fetched again. */
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface NewsScanSource {
  url: string;
  label?: string;
  country?: string;
}

export interface NewsScanProposal {
  programmeKey: string | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  /** 0–100. Low confidence means the admin must read the excerpt. */
  confidence: number;
}

/** Diff hunk — a single changed region between old and new page text. */
export interface DiffHunk {
  type: "replace" | "insert" | "delete";
  /** 0-based line index in the old text where the change starts. */
  oldStart: number;
  /** Number of lines affected in the old text. */
  oldLength: number;
  /** 0-based line index in the new text where the change starts. */
  newStart: number;
  /** Number of lines affected in the new text. */
  newLength: number;
  /** Context lines around the change (for display). */
  context: string[];
}

/** Importance classification for a regulatory change finding. */
export type ChangeImportance = "IMPORTANT" | "ROUTINE";

/** Enriched finding with diff evidence and importance flag. */
export interface NewsScanFindingEnriched {
  id: string;
  profileId: string;
  sourceUrl: string;
  sourceLabel: string | null;
  contentHash: string;
  previousHash: string | null;
  proposal: NewsScanProposal;
  excerpt: string;
  evidenceUrl: string;
  confidence: number;
  status: "PENDING" | "APPROVED" | "DISMISSED" | "CORROBORATED";
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  corroboratedBy: string | null;
  /** Structured diff between previous and current page (if previous exists). */
  diff: DiffHunk[] | null;
  /** Importance flag set by admin or auto-assigned by heuristics. */
  importance: ChangeImportance;
  /** Timestamped evidence snapshot (URL + when captured). */
  evidenceCapturedAt: Date;
  createdAt: Date;
}

/** True when `url` is on an official domain (or a subdomain of one). */
export function isAllowedSource(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return OFFICIAL_SOURCE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** sha256 of a page body — the diff baseline. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Narrow the profile's `sources` JSON to well-formed entries. */
export function readSources(raw: unknown): NewsScanSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is NewsScanSource => {
    if (!s || typeof s !== "object") return false;
    const c = s as Partial<NewsScanSource>;
    return typeof c.url === "string" && c.url.length > 0;
  });
}

/** Narrow the profile's `keywords` JSON to non-empty strings. */
export function readKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
}

/** Narrow a stored proposal JSON value. */
export function readProposal(raw: unknown): NewsScanProposal {
  if (!raw || typeof raw !== "object") {
    return { programmeKey: null, field: null, oldValue: null, newValue: null, confidence: 0 };
  }
  const c = raw as Partial<NewsScanProposal>;
  return {
    programmeKey: typeof c.programmeKey === "string" ? c.programmeKey : null,
    field: typeof c.field === "string" ? c.field : null,
    oldValue: typeof c.oldValue === "string" ? c.oldValue : null,
    newValue: typeof c.newValue === "string" ? c.newValue : null,
    confidence: typeof c.confidence === "number" && Number.isFinite(c.confidence) ? c.confidence : 0,
  };
}

/**
 * The region of a fetched page that matters: a window around the first keyword
 * hit, else the opening of the page. This is the ONLY text the extractor sees.
 */
export function relevantExcerpt(text: string, keywords: readonly string[], radius = 400): string {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const k of keywords) {
    if (!k) continue;
    const i = lower.indexOf(k.toLowerCase());
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return text.slice(0, radius * 2).replace(/\s+/g, " ").trim();
  const from = Math.max(0, idx - radius);
  const to = Math.min(text.length, idx + radius);
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

/**
 * Extract a structured proposal from a fetched excerpt. Deterministic and
 * Prisma-free so it is unit-testable; an LLM may be substituted later, but it
 * may only ever summarise the excerpt passed in — never invent a value.
 */
export function extractProposal(excerpt: string, keywords: readonly string[]): NewsScanProposal {
  const lower = excerpt.toLowerCase();
  const programmeAliases: readonly [string, string][] = [
    ["malta citizenship", "MT_CITIZENSHIP_MEIN"],
    ["malta permanent residence", "MT_CITIZENSHIP_MEIN"],
  ];
  const programme = PROGRAMMES.find(
    (p) => lower.includes(p.key.toLowerCase()) || lower.includes(p.label.toLowerCase()),
  ) ?? PROGRAMMES.find((p) => programmeAliases.some(([phrase, key]) => lower.includes(phrase) && p.key === key)) ?? null;
  const field = FIELD_HINTS.find((f) => lower.includes(f)) ?? null;
  const hits = keywords.filter((k) => k && lower.includes(k.toLowerCase()));
  const confidence = Math.min(100, (programme ? 40 : 0) + (field ? 30 : 0) + hits.length * 15);
  return {
    programmeKey: programme?.key ?? null,
    field,
    oldValue: null,
    newValue: excerpt.slice(0, 500),
    confidence,
  };
}

// ── fetch (cached) ───────────────────────────────────────────────────────────

const cache = new Map<string, { at: number; text: string }>();

/** Maximum redirect hops followed before giving up (loop / chain guard). */
const MAX_REDIRECT_HOPS = 5;

/**
 * Fetch a source as plain text, with a TTL cache. Returns null on any failure.
 *
 * Redirects are followed manually: each hop's URL is re-validated against
 * `isAllowedSource` before it is fetched, so the official-domain allow-list
 * stays a real boundary rather than a property of the first request.
 */
export async function fetchSourceText(url: string): Promise<string | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;
  try {
    let currentUrl = url;
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      const res = await fetch(currentUrl, {
        headers: { "user-agent": "CitizenLane-RegulatoryWatch/1.0" },
        signal: AbortSignal.timeout(15_000),
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        const next = new URL(location, currentUrl).toString();
        if (!isAllowedSource(next)) return null;
        currentUrl = next;
        continue;
      }
      if (!res.ok) return null;
      const raw = await res.text();
      // Normalise markup so a trivial DOM change does not read as a content change.
      const text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      cache.set(url, { at: Date.now(), text });
      return text;
    }
    return null; // too many redirects
  } catch {
    return null;
  }
}

/** Fetch a source and return both text and the previous version for diffing. */
export async function fetchSourceWithPrevious(url: string): Promise<{ current: string; previous: string | null } | null> {
  const hit = cache.get(url);
  const previous = hit?.text ?? null;
  const current = await fetchSourceText(url);
  if (!current) return null;
  return { current, previous };
}

// ── Diff utility ───────────────────────────────────────────────────────────────

/** Compute a line-based diff between two texts. Returns an array of hunks. */
export function computeDiff(oldText: string, newText: string): DiffHunk[] {
  if (oldText.length === 0 && newText.length === 0) return [];
  if (oldText.length === 0) {
    const lines = newText.split("\n");
    return [{ type: "insert", oldStart: 0, oldLength: 0, newStart: 0, newLength: lines.length, context: lines.slice(0, 5) }];
  }
  if (newText.length === 0) {
    const lines = oldText.split("\n");
    return [{ type: "delete", oldStart: 0, oldLength: lines.length, newStart: 0, newLength: 0, context: lines.slice(0, 5) }];
  }
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const hunks: DiffHunk[] = [];

  // Simple LCS-based diff (Myers algorithm would be overkill for ~1000 lines)
  // We use a greedy approach: find matching runs, emit replace/insert/delete.
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    // Skip common prefix
    while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    }
    const commonStart = i;

    // If we've consumed all of one side, the rest is insert/delete
    if (i >= oldLines.length) {
      if (j < newLines.length) {
        hunks.push({
          type: "insert",
          oldStart: i,
          oldLength: 0,
          newStart: j,
          newLength: newLines.length - j,
          context: newLines.slice(Math.max(0, j - 2), j).concat(newLines.slice(j, j + 3)),
        });
      }
      break;
    }
    if (j >= newLines.length) {
      if (i < oldLines.length) {
        hunks.push({
          type: "delete",
          oldStart: i,
          oldLength: oldLines.length - i,
          newStart: j,
          newLength: 0,
          context: oldLines.slice(Math.max(0, i - 2), i).concat(oldLines.slice(i, i + 3)),
        });
      }
      break;
    }

    // Find next matching line pair (lookahead up to 20 lines)
    let matchFound = false;
    const LOOKAHEAD = 20;
    for (let oi = i; oi < Math.min(oldLines.length, i + LOOKAHEAD); oi++) {
      for (let nj = j; nj < Math.min(newLines.length, j + LOOKAHEAD); nj++) {
        if (oldLines[oi] === newLines[nj]) {
          // Found a match — emit the change before it
          const oldLen = oi - i;
          const newLen = nj - j;
          if (oldLen > 0 && newLen > 0) {
            hunks.push({
              type: "replace",
              oldStart: i,
              oldLength: oldLen,
              newStart: j,
              newLength: newLen,
              context: oldLines.slice(Math.max(0, i - 2), i).concat(newLines.slice(nj, nj + 3)),
            });
          } else if (oldLen > 0) {
            hunks.push({
              type: "delete",
              oldStart: i,
              oldLength: oldLen,
              newStart: j,
              newLength: 0,
              context: oldLines.slice(Math.max(0, i - 2), i).concat(oldLines.slice(i, i + 3)),
            });
          } else if (newLen > 0) {
            hunks.push({
              type: "insert",
              oldStart: i,
              oldLength: 0,
              newStart: j,
              newLength: newLen,
              context: newLines.slice(Math.max(0, j - 2), j).concat(newLines.slice(nj, nj + 3)),
            });
          }
          i = oi;
          j = nj;
          matchFound = true;
          break;
        }
      }
      if (matchFound) break;
    }

    // No match in lookahead — consume rest as replace
    if (!matchFound) {
      const oldLen = oldLines.length - i;
      const newLen = newLines.length - j;
      if (oldLen > 0 || newLen > 0) {
        hunks.push({
          type: "replace",
          oldStart: i,
          oldLength: oldLen,
          newStart: j,
          newLength: newLen,
          context: oldLines.slice(Math.max(0, i - 2), i).concat(newLines.slice(j, j + 3)),
        });
      }
      break;
    }
  }

  return hunks;
}

/** Classify a finding's importance based on heuristic signals. */
export function classifyImportance(
  proposal: NewsScanProposal,
  diff: DiffHunk[],
  programmeIsLive: boolean
): ChangeImportance {
  // Any change to a LIVE programme is IMPORTANT by default
  if (programmeIsLive) return "IMPORTANT";

  // High-confidence changes to fee/threshold/investment fields are IMPORTANT
  const criticalFields = ["fee", "investment", "threshold", "minimum", "capital", "quota"];
  const isCriticalField = proposal.field && criticalFields.some((f) => proposal.field!.toLowerCase().includes(f));

  if (isCriticalField && proposal.confidence >= 60) return "IMPORTANT";

  // Large diffs (>5 hunks or >50 changed lines) suggest substantive change
  const totalChangedLines = diff.reduce((sum, h) => sum + Math.max(h.oldLength, h.newLength), 0);
  if (diff.length > 5 || totalChangedLines > 50) return "IMPORTANT";

  return "ROUTINE";
}

// ── scan ─────────────────────────────────────────────────────────────────────

export interface ScanOutcome {
  scanned: number;
  changed: number;
  findings: string[];
}

/**
 * Run one profile: fetch every allowed source, diff against the stored hash, and
 * open a PENDING finding for each change. Sources outside the allow-list are
 * skipped, never fetched.
 */
export async function runNewsScan(profileId: string): Promise<ScanOutcome> {
  const profile = await db.newsScanProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw new DomainError("News scan profile not found", 404);

  const sources = readSources(profile.sources).filter((s) => isAllowedSource(s.url));
  const keywords = readKeywords(profile.keywords);
  const findings: string[] = [];
  let changed = 0;

  for (const src of sources) {
    const fetchResult = await fetchSourceWithPrevious(src.url);
    if (!fetchResult) continue;
    const { current: text, previous } = fetchResult;
    const hash = hashContent(text);
    const last = await db.newsScanFinding.findFirst({
      where: { profileId, sourceUrl: src.url },
      orderBy: { createdAt: "desc" },
      select: { contentHash: true },
    });
    if (last?.contentHash === hash) continue; // unchanged since the last scan

    const excerpt = relevantExcerpt(text, keywords);
    const proposal = extractProposal(excerpt, keywords);

    // Compute diff against previous version if available
    let diff: DiffHunk[] | null = null;
    if (previous) {
      diff = computeDiff(previous, text);
    }

    // Check if programme is live to classify importance
    let programmeIsLive = false;
    if (proposal.programmeKey) {
      const programme = await db.programme.findUnique({ where: { key: proposal.programmeKey } });
      if (programme) {
        const live = await db.programVersion.findFirst({
          where: { programmeId: programme.id, status: "PUBLISHED" },
          select: { id: true },
        });
        programmeIsLive = !!live;
      }
    }

    const importance = classifyImportance(proposal, diff ?? [], programmeIsLive);

    const finding = await db.newsScanFinding.create({
      data: {
        profileId,
        sourceUrl: src.url,
        sourceLabel: src.label ?? null,
        contentHash: hash,
        previousHash: last?.contentHash ?? null,
        proposal: proposal as object,
        excerpt,
        evidenceUrl: src.url,
        confidence: proposal.confidence,
        diff: diff as object,
        importance,
      },
    });
    findings.push(finding.id);
    changed++;
  }

  await db.newsScanProfile.update({ where: { id: profileId }, data: { lastRunAt: new Date() } });
  return { scanned: sources.length, changed, findings };
}

/** Profiles whose `checkEveryHours` interval has elapsed — the scheduler entry. */
export async function dueProfiles(now: Date = new Date()) {
  const profiles = await db.newsScanProfile.findMany({ where: { active: true } });
  return profiles.filter((p) => {
    if (!p.lastRunAt) return true;
    return (now.getTime() - p.lastRunAt.getTime()) / 3_600_000 >= p.checkEveryHours;
  });
}

// ── decisions ────────────────────────────────────────────────────────────────

/**
 * Record a second official source corroborating a finding. Required before a
 * change to a LIVE programme can be approved.
 */
export async function corroborateFinding(findingId: string, sourceUrl: string, actorId: string, actorLabel: string) {
  const finding = await db.newsScanFinding.findUnique({ where: { id: findingId } });
  if (!finding) throw new DomainError("Finding not found", 404);
  if (finding.status !== "PENDING") throw new DomainError("Only a pending finding can be corroborated", 409);
  if (!isAllowedSource(sourceUrl)) throw new DomainError("Corroborating source must be on an official domain", 422);
  if (sourceUrl === finding.sourceUrl) throw new DomainError("The corroborating source must be a different page", 422);

  const updated = await db.newsScanFinding.update({
    where: { id: findingId },
    data: { corroboratedBy: sourceUrl },
  });
  await audit({
    action: "news_scan.corroborated",
    target: findingId,
    actorId,
    actorLabel,
    after: { sourceUrl },
  });
  return updated;
}

/**
 * Approve a finding: create a new DRAFT `ProgramVersion` for the programme it
 * targets, with the source URL recorded as its legal basis. Never auto-publishes.
 *
 * The draft carries a null `effectiveAt` — the admin sets the effective date when
 * publishing. This keeps drafts distinct under `@@unique([programmeId, effectiveAt])`
 * (Postgres NULLS DISTINCT) and lets several drafts coexist for one programme.
 *
 * Two-source rule: a finding that targets a LIVE programme is refused until a
 * second official source corroborates it.
 */
export async function approveFinding(findingId: string, actorId: string, actorLabel: string, reason: string) {
  const finding = await db.newsScanFinding.findUnique({ where: { id: findingId } });
  if (!finding) throw new DomainError("Finding not found", 404);
  if (finding.status !== "PENDING") throw new DomainError("Only a pending finding can be approved", 409);

  const proposal = readProposal(finding.proposal);
  if (!proposal.programmeKey) {
    throw new DomainError("Finding has no programme target — an admin must set one before approving", 422);
  }
  const programme = await db.programme.findUnique({ where: { key: proposal.programmeKey } });
  if (!programme) throw new DomainError(`Unknown programme ${proposal.programmeKey}`, 404);

  const live = await db.programVersion.findFirst({
    where: { programmeId: programme.id, status: "PUBLISHED" },
    select: { id: true },
  });
  if (live && !finding.corroboratedBy) {
    throw new DomainError(
      "Two-source rule: this programme is live, so a second official source must corroborate the change before it can be approved.",
      422,
    );
  }

  const maxVersion = await db.programVersion.aggregate({
    where: { programmeId: programme.id },
    _max: { version: true },
  });
  const version = await db.programVersion.create({
    data: {
      programmeId: programme.id,
      version: (maxVersion._max.version ?? 0) + 1,
      status: "DRAFT",
      effectiveAt: null,
      meta: JSON.stringify({
        legalBasis: finding.evidenceUrl,
        sourceUrl: finding.sourceUrl,
        corroboratedBy: finding.corroboratedBy,
        field: proposal.field,
        oldValue: proposal.oldValue,
        newValue: proposal.newValue,
        confidence: finding.confidence,
        newsScanFindingId: finding.id,
      }),
    },
  });

  await db.newsScanFinding.update({
    where: { id: findingId },
    data: { status: "APPROVED", decidedBy: actorId, decidedAt: new Date(), decisionReason: reason },
  });
  await audit({
    action: "news_scan.approved",
    target: findingId,
    actorId,
    actorLabel,
    after: { programmeKey: programme.key, version: version.version, legalBasis: finding.evidenceUrl },
    reason,
  });

  const admins = await db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { email: true } });
  await Promise.all(
    admins.map((a) =>
      sendEmail({
        to: a.email,
        subject: `Regulatory watch: ${programme.key} draft v${version.version} awaiting review`,
        body: `A news-scan finding for ${programme.name} was approved and created draft ProgramVersion v${version.version}.\n\nSource: ${finding.evidenceUrl}\n${finding.corroboratedBy ? `Corroborated by: ${finding.corroboratedBy}\n` : ""}Review and publish it from the admin console.`,
      }).catch(() => undefined),
    ),
  );

  return version;
}

/** Dismiss a finding without creating a version. */
export async function dismissFinding(findingId: string, actorId: string, actorLabel: string, reason: string) {
  const finding = await db.newsScanFinding.findUnique({ where: { id: findingId } });
  if (!finding) throw new DomainError("Finding not found", 404);
  if (finding.status !== "PENDING") throw new DomainError("Only a pending finding can be dismissed", 409);
  const updated = await db.newsScanFinding.update({
    where: { id: findingId },
    data: { status: "DISMISSED", decidedBy: actorId, decidedAt: new Date(), decisionReason: reason },
  });
  await audit({ action: "news_scan.dismissed", target: findingId, actorId, actorLabel, reason });
  return updated;
}
