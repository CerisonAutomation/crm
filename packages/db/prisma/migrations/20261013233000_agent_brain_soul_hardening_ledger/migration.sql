-- Agent governance ledger (U5), brain memory (U6), soul identity (U7),
-- workspace hardening (U8) and workflow ledger (U9).
-- Patterns harvested from SeldonFrame (clean-room, AGPL donors contribute
-- patterns only).


-- CreateEnum
CREATE TYPE "AgentDraftStatus" AS ENUM ('pending', 'approved', 'rejected', 'executed', 'expired');

-- CreateEnum
CREATE TYPE "WorkspaceDomainStatus" AS ENUM ('pending', 'verified', 'failed');

-- CreateTable
CREATE TABLE "AgentRunReceipt" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "agentKind" TEXT NOT NULL,
    "externalRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRunReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentActionDraft" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "agentKind" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "AgentDraftStatus" NOT NULL DEFAULT 'pending',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentActionDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentReflectionEvent" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "runReceiptId" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentReflectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTasteSession" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "topic" TEXT NOT NULL,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTasteSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "kind" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "passed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brain" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Brain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainNote" (
    "id" TEXT NOT NULL,
    "brainId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrainNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainOutcome" (
    "id" TEXT NOT NULL,
    "brainId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "noteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrainOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoulProfile" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "labels" JSONB NOT NULL DEFAULT '{}',
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "positioning" TEXT,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SoulProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSecret" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "name" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceDomain" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "domain" TEXT NOT NULL,
    "status" "WorkspaceDomainStatus" NOT NULL DEFAULT 'pending',
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAccessCode" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "codeHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalAccessCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "channel" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'unsubscribe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStepResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowStepResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEventLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepName" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSecret_ownerUserId_name_key" ON "WorkspaceSecret"("ownerUserId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceDomain_domain_key" ON "WorkspaceDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccessCode_codeHash_key" ON "PortalAccessCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_ownerUserId_channel_handle_key" ON "SuppressionEntry"("ownerUserId", "channel", "handle");

-- CreateIndex
CREATE INDEX "AgentRunReceipt_ownerUserId_createdAt_idx" ON "AgentRunReceipt"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRunReceipt_agentKind_status_idx" ON "AgentRunReceipt"("agentKind", "status");

-- CreateIndex
CREATE INDEX "AgentRunReceipt_externalRunId_idx" ON "AgentRunReceipt"("externalRunId");

-- CreateIndex
CREATE INDEX "AgentActionDraft_status_createdAt_idx" ON "AgentActionDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentActionDraft_ownerUserId_actionKind_idx" ON "AgentActionDraft"("ownerUserId", "actionKind");

-- CreateIndex
CREATE INDEX "AgentReflectionEvent_ownerUserId_kind_idx" ON "AgentReflectionEvent"("ownerUserId", "kind");

-- CreateIndex
CREATE INDEX "AgentReflectionEvent_runReceiptId_idx" ON "AgentReflectionEvent"("runReceiptId");

-- CreateIndex
CREATE INDEX "AgentTasteSession_ownerUserId_topic_idx" ON "AgentTasteSession"("ownerUserId", "topic");

-- CreateIndex
CREATE INDEX "EvalRun_ownerUserId_kind_idx" ON "EvalRun"("ownerUserId", "kind");

-- CreateIndex
CREATE INDEX "EvalRun_targetKind_targetId_idx" ON "EvalRun"("targetKind", "targetId");

-- CreateIndex
CREATE INDEX "Brain_ownerUserId_idx" ON "Brain"("ownerUserId");

-- CreateIndex
CREATE INDEX "BrainNote_brainId_idx" ON "BrainNote"("brainId");

-- CreateIndex
CREATE INDEX "BrainOutcome_brainId_occurredAt_idx" ON "BrainOutcome"("brainId", "occurredAt");

-- CreateIndex
CREATE INDEX "SoulProfile_ownerUserId_idx" ON "SoulProfile"("ownerUserId");

-- CreateIndex
CREATE INDEX "SoulProfile_parentId_idx" ON "SoulProfile"("parentId");

-- CreateIndex
CREATE INDEX "WorkspaceSecret_ownerUserId_idx" ON "WorkspaceSecret"("ownerUserId");

-- CreateIndex
CREATE INDEX "WorkspaceDomain_ownerUserId_status_idx" ON "WorkspaceDomain"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "PortalAccessCode_ownerUserId_idx" ON "PortalAccessCode"("ownerUserId");

-- CreateIndex
CREATE INDEX "SuppressionEntry_channel_handle_idx" ON "SuppressionEntry"("channel", "handle");

-- CreateIndex
CREATE INDEX "WorkflowStepResult_runId_stepName_idx" ON "WorkflowStepResult"("runId", "stepName");

-- CreateIndex
CREATE INDEX "WorkflowStepResult_status_idx" ON "WorkflowStepResult"("status");

-- CreateIndex
CREATE INDEX "WorkflowEventLog_runId_createdAt_idx" ON "WorkflowEventLog"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowEventLog_kind_idx" ON "WorkflowEventLog"("kind");

-- AddForeignKey
ALTER TABLE "AgentRunReceipt" ADD CONSTRAINT "AgentRunReceipt_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActionDraft" ADD CONSTRAINT "AgentActionDraft_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReflectionEvent" ADD CONSTRAINT "AgentReflectionEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTasteSession" ADD CONSTRAINT "AgentTasteSession_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brain" ADD CONSTRAINT "Brain_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainNote" ADD CONSTRAINT "BrainNote_brainId_fkey" FOREIGN KEY ("brainId") REFERENCES "Brain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainOutcome" ADD CONSTRAINT "BrainOutcome_brainId_fkey" FOREIGN KEY ("brainId") REFERENCES "Brain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoulProfile" ADD CONSTRAINT "SoulProfile_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoulProfile" ADD CONSTRAINT "SoulProfile_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SoulProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSecret" ADD CONSTRAINT "WorkspaceSecret_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDomain" ADD CONSTRAINT "WorkspaceDomain_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccessCode" ADD CONSTRAINT "PortalAccessCode_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepResult" ADD CONSTRAINT "WorkflowStepResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEventLog" ADD CONSTRAINT "WorkflowEventLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

