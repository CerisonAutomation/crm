/**
 * Prompt injection detection (Zenith blueprint §13).
 *
 * Detects and blocks prompt injection attempts in user inputs.
 * Uses a combination of pattern matching and heuristic analysis.
 */

export interface InjectionDetectionResult {
  blocked: boolean;
  /** Any listed pattern matched — set even when below the block threshold,
   * so callers can observe (audit) single-pattern probes that pass. */
  suspicious: boolean;
  reason: string;
  confidence: number;
  patterns: string[];
}

// Known injection patterns (simplified — production would use ML model)
const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) instructions/i,
  /disregard (all |any )?(previous|prior|above) instructions/i,
  /forget (all |any )?(previous|prior|above) instructions/i,
  /you are now/i,
  /act as (a|an|the) /i,
  /pretend (to be|you are)/i,
  /system prompt/i,
  /reveal (your |the )?(system |hidden |secret )?prompt/i,
  /show (me )?(your |the )?(system |hidden |secret )?prompt/i,
  /what (are|were) your instructions/i,
  /override (safety|security|policy|rules)/i,
  /bypass (safety|security|policy|rules)/i,
  /jailbreak/i,
  /DAN mode/i,
  /developer mode/i,
  /admin mode/i,
  /root access/i,
  /sudo /i,
  /rm -rf/i,
  /DROP TABLE/i,
  /DELETE FROM/i,
  /INSERT INTO/i,
  /UPDATE .* SET/i,
  /<script>/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /setTimeout\s*\(/i,
  /setInterval\s*\(/i,
  /fetch\s*\(/i,
  /XMLHttpRequest/i,
  /import\s+/i,
  /require\s*\(/i,
  /exec\s*\(/i,
  /spawn\s*\(/i,
  /child_process/i,
];

// High-risk patterns that always block. Compared by source below — these are
// re-declared literals, so reference equality against INJECTION_PATTERNS
// would never match and the always-block rule would silently never fire.
const HIGH_RISK_SOURCES: ReadonlySet<string> = new Set([
  /ignore (all |any )?(previous|prior|above) instructions/i.source,
  /disregard (all |any )?(previous|prior|above) instructions/i.source,
  /forget (all |any )?(previous|prior|above) instructions/i.source,
  /system prompt/i.source,
  /reveal (your |the )?(system |hidden |secret )?prompt/i.source,
  /jailbreak/i.source,
  /DAN mode/i.source,
  /developer mode/i.source,
]);

/**
 * Detect prompt injection attempts in user input.
 */
export function detectPromptInjection(input: string): InjectionDetectionResult {
  const patterns: string[] = [];
  let highRiskCount = 0;
  let totalMatches = 0;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      patterns.push(pattern.source);
      totalMatches++;
      if (HIGH_RISK_SOURCES.has(pattern.source)) {
        highRiskCount++;
      }
    }
  }

  // Heuristic: long inputs with many special characters
  const specialCharRatio = (input.match(/[^\w\s]/g) ?? []).length / Math.max(input.length, 1);
  if (specialCharRatio > 0.3 && input.length > 100) {
    patterns.push("high_special_char_ratio");
    totalMatches++;
  }

  // Heuristic: repeated attempts to change role
  const roleChangeAttempts = (input.match(/you are|act as|pretend|become/gi) ?? []).length;
  if (roleChangeAttempts > 2) {
    patterns.push("repeated_role_change");
    totalMatches++;
  }

  const blocked = highRiskCount > 0 || totalMatches >= 3;
  const confidence = Math.min(1, totalMatches / 5 + highRiskCount * 0.3);

  return {
    blocked,
    suspicious: totalMatches > 0,
    reason: blocked
      ? `Prompt injection detected: ${patterns.slice(0, 3).join(", ")}`
      : "No injection detected",
    confidence,
    patterns,
  };
}

/**
 * Sanitize user input by removing potentially dangerous content.
 */
export function sanitizeInput(input: string): string {
  // Remove null bytes
  let sanitized = input.replace(/\0/g, "");

  // Remove control characters except newlines and tabs
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Limit length
  if (sanitized.length > 10000) {
    sanitized = sanitized.slice(0, 10000);
  }

  return sanitized;
}

/**
 * Check if input contains cross-tenant data leakage patterns.
 */
export function detectCrossTenantLeakage(input: string, currentOrgId: string): boolean {
  // Check for references to other org IDs
  const orgIdPattern = /org[_-]?id[:\s]+([a-zA-Z0-9_-]+)/gi;
  const matches = input.match(orgIdPattern);
  if (matches) {
    for (const match of matches) {
      const extractedId = match.replace(/org[_-]?id[:\s]+/i, "").trim();
      if (extractedId !== currentOrgId && extractedId.length > 5) {
        return true;
      }
    }
  }
  return false;
}