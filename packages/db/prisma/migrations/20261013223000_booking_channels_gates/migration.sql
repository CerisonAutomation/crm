-- Booking engine, workflow gates (waits/approvals), send claims and messaging
-- channels. Patterns harvested from SeldonFrame (bookings, workflow-waits,
-- workflow-approvals, replay-send-claims), Twenty (connected accounts,
-- message drivers), Postiz (provider contract) and Customermates (channels).

-- CreateEnum
CREATE TYPE "WorkflowWaitStatus" AS ENUM ('active', 'resumed', 'timed_out', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkflowWaitResumeReason" AS ENUM ('event_match', 'timeout', 'manual', 'cancelled');

-- CreateEnum
CREATE TYPE "WorkflowApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'timed_out', 'cancelled');

-- CreateEnum
CREATE TYPE "SendClaimOutcome" AS ENUM ('unknown', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "ConnectedAccountStatus" AS ENUM ('pending', 'active', 'expired', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "ChannelMessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateTable
CREATE TABLE "AppointmentType" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "availability" JSONB NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "meetingProvider" TEXT NOT NULL DEFAULT 'none',
    "color" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "appointmentTypeId" TEXT,
    "ownerUserId" TEXT,
    "contactId" TEXT,
    "title" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "meetingUrl" TEXT,
    "externalEventId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowWait" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "matchEvent" TEXT NOT NULL,
    "matchPredicate" JSONB NOT NULL,
    "timeoutAt" TIMESTAMP(3),
    "status" "WorkflowWaitStatus" NOT NULL DEFAULT 'active',
    "resumedAt" TIMESTAMP(3),
    "resumedByRunEventId" TEXT,
    "resumedReason" "WorkflowWaitResumeReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowWait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowApproval" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "approverHint" TEXT,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "WorkflowApprovalStatus" NOT NULL DEFAULT 'pending',
    "timeoutAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendClaim" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "workflowRunId" TEXT,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outcome" "SendClaimOutcome" NOT NULL DEFAULT 'unknown',
    "providerReference" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "SendClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "provider" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "status" "ConnectedAccountStatus" NOT NULL DEFAULT 'pending',
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMessage" (
    "id" TEXT NOT NULL,
    "connectedAccountId" TEXT,
    "ownerUserId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "direction" "ChannelMessageDirection" NOT NULL,
    "threadId" TEXT,
    "senderHandle" TEXT NOT NULL,
    "recipientHandle" TEXT,
    "body" TEXT,
    "media" JSONB NOT NULL DEFAULT '[]',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentType_ownerUserId_slug_key" ON "AppointmentType"("ownerUserId", "slug");

-- CreateIndex
CREATE INDEX "AppointmentType_ownerUserId_idx" ON "AppointmentType"("ownerUserId");

-- CreateIndex
CREATE INDEX "AppointmentType_enabled_idx" ON "AppointmentType"("enabled");

-- CreateIndex
CREATE INDEX "Booking_ownerUserId_startsAt_idx" ON "Booking"("ownerUserId", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_status_startsAt_idx" ON "Booking"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_externalEventId_idx" ON "Booking"("externalEventId");

-- CreateIndex
CREATE INDEX "WorkflowWait_status_timeoutAt_idx" ON "WorkflowWait"("status", "timeoutAt");

-- CreateIndex
CREATE INDEX "WorkflowWait_runId_stepName_idx" ON "WorkflowWait"("runId", "stepName");

-- CreateIndex
CREATE INDEX "WorkflowWait_matchEvent_status_idx" ON "WorkflowWait"("matchEvent", "status");

-- CreateIndex
CREATE INDEX "WorkflowApproval_status_timeoutAt_idx" ON "WorkflowApproval"("status", "timeoutAt");

-- CreateIndex
CREATE INDEX "WorkflowApproval_runId_stepName_idx" ON "WorkflowApproval"("runId", "stepName");

-- CreateIndex
CREATE UNIQUE INDEX "SendClaim_channel_kind_stepNumber_idempotencyKey_key" ON "SendClaim"("channel", "kind", "stepNumber", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SendClaim_outcome_claimedAt_idx" ON "SendClaim"("outcome", "claimedAt");

-- CreateIndex
CREATE INDEX "SendClaim_ownerUserId_idx" ON "SendClaim"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_ownerUserId_provider_handle_key" ON "ConnectedAccount"("ownerUserId", "provider", "handle");

-- CreateIndex
CREATE INDEX "ConnectedAccount_provider_status_idx" ON "ConnectedAccount"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMessage_provider_externalId_key" ON "ChannelMessage"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ChannelMessage_ownerUserId_occurredAt_idx" ON "ChannelMessage"("ownerUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "ChannelMessage_provider_threadId_idx" ON "ChannelMessage"("provider", "threadId");

-- AddForeignKey
ALTER TABLE "AppointmentType" ADD CONSTRAINT "AppointmentType_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_appointmentTypeId_fkey" FOREIGN KEY ("appointmentTypeId") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowWait" ADD CONSTRAINT "WorkflowWait_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApproval" ADD CONSTRAINT "WorkflowApproval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendClaim" ADD CONSTRAINT "SendClaim_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
