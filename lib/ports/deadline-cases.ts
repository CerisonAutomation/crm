/**
 * H2 port — deadline case context.
 *
 * The deadline runner needs one read: the case's org (for integrity-alert
 * audit) plus its programme's versions (for the in-force deadline windows).
 * That read sits behind this contract so feature modules never import the
 * database directly (H4) and offline paths resolve to nothing (H3).
 *
 * Structural types only: Prisma-free, safe to import anywhere.
 */
export interface ProgrammeVersionLike {
  version: number;
  status: string;
  effectiveAt: Date | null;
  effectiveTo: Date | null;
  deadlineWindows: unknown;
}

export interface DeadlineCaseLike {
  orgId: string;
  versions: ProgrammeVersionLike[];
}

export interface DeadlineCaseSource {
  loadCaseVersions(caseId: string): Promise<DeadlineCaseLike | null>;
}

/** H3 offline default — loads nothing, so no deadline ever arms offline. */
export const offlineDeadlineCaseSource: DeadlineCaseSource = {
  loadCaseVersions: async () => null,
};
