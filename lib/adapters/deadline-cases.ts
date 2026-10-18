/**
 * H2 adapter — Prisma-backed DeadlineCaseSource. Server-only: never imported
 * from client components (the H4 gate forbids generated-Prisma types there).
 */
import { db } from "@/lib/db";
import type { DeadlineCaseSource } from "@/lib/ports/deadline-cases";

export const prismaDeadlineCaseSource: DeadlineCaseSource = {
  async loadCaseVersions(caseId: string) {
    const kase = await db.case.findUnique({
      where: { id: caseId },
      include: { programme: { include: { versions: true } } },
    });
    if (!kase) return null;
    return { orgId: kase.orgId, versions: kase.programme?.versions ?? [] };
  },
};
