import { DomainError } from "@/lib/domain/states";

/** Redaction-safe preview for workflow inputs/outputs stored on run records. */
export function redactionSafe(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/pass|secret|token|auth|documentNumber|fullName|dateOfBirth/i.test(k) && typeof v === "string" && v.length > 3) {
      out[k] = `${v.slice(0, 2)}•••`;
    } else if (typeof v === "object" && v !== null) {
      out[k] = redactionSafe(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export { DomainError };
