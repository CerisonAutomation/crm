/**
 * Page → workflow binding health (Prisma-free).
 *
 * A Lane Page stores `bindings` as JSON `[{ formKey, workflowId }]`. Each entry
 * is validated against a *published* workflow when the draft is saved, so it can
 * go stale afterwards: the workflow gets unpublished, disabled or deleted, and
 * the page keeps a binding that points at nothing. From then on a visitor's
 * submission is recorded with `runId: null` — no run, no error.
 *
 * These helpers decide which form keys can still start a run, given the set of
 * workflow ids the caller has already confirmed to be live. Callers must scope
 * that set to the page's own organisation (tenant isolation is not this file's
 * job) and to `status === "PUBLISHED" && !disabled`.
 */

export type PageBinding = { formKey: string; workflowId: string };

/** Parse the raw `LanePage.bindings` column. Never throws — a corrupt row reads as unbound. */
export function parsePageBindings(raw: string | null | undefined): PageBinding[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: PageBinding[] = [];
  for (const entry of v) {
    if (!entry || typeof entry !== "object") continue;
    const formKey = (entry as { formKey?: unknown }).formKey;
    const workflowId = (entry as { workflowId?: unknown }).workflowId;
    if (typeof formKey !== "string" || typeof workflowId !== "string") continue;
    if (!formKey || !workflowId) continue;
    out.push({ formKey, workflowId });
  }
  return out;
}

/**
 * Form keys whose bound workflow appears in `liveWorkflowIds`.
 * A key absent from the result is *stale*: the binding exists but cannot start a run.
 */
export function liveBindingFormKeys(bindings: PageBinding[], liveWorkflowIds: Iterable<string>): Set<string> {
  const live = liveWorkflowIds instanceof Set ? liveWorkflowIds : new Set(liveWorkflowIds);
  const out = new Set<string>();
  for (const b of bindings) {
    if (live.has(b.workflowId)) out.add(b.formKey);
  }
  return out;
}
