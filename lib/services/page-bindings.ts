import { db } from "@/lib/db";
import { liveBindingFormKeys, parsePageBindings, type PageBinding } from "@/lib/domain/page-bindings";

export type BindingHealth = {
  /** Every well-formed binding on the page, in stored order. */
  bindings: PageBinding[];
  /** Form keys whose target is live — these still start a run. */
  liveKeys: Set<string>;
  /** Bindings whose target is missing, unpublished, disabled or another org's. */
  stale: PageBinding[];
};

/**
 * Resolve which of a page's form bindings still point at a live workflow of the
 * page's own organisation: exists, `PUBLISHED`, not disabled. Everything else is
 * stale — a submission against a stale binding is recorded without a run.
 */
export async function bindingHealth(page: { orgId: string; bindings: string }): Promise<BindingHealth> {
  const bindings = parsePageBindings(page.bindings);
  if (bindings.length === 0) return { bindings, liveKeys: new Set(), stale: [] };

  const ids = [...new Set(bindings.map((b) => b.workflowId))];
  const live = await db.workflow.findMany({
    where: { id: { in: ids }, orgId: page.orgId, status: "PUBLISHED", disabled: false },
    select: { id: true },
  });
  const liveKeys = liveBindingFormKeys(bindings, live.map((w) => w.id));
  return { bindings, liveKeys, stale: bindings.filter((b) => !liveKeys.has(b.formKey)) };
}
