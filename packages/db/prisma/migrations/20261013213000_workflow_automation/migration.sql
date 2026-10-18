-- Workflow automation layer: durable workflow runs, routines, webhooks, deliveries.
-- Extracted from the Customermates workflow engine (registry + step journal +
-- routine scheduler + signed webhook delivery) and adapted to this schema.

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'abandoned');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('pending', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "RoutineTriggerKind" AS ENUM ('manual', 'cron', 'event');

-- CreateEnum
CREATE TYPE "RoutineRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'processing', 'success', 'failed');

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowName" TEXT NOT NULL,
    "tenantUserId" TEXT,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "failureName" TEXT,
    "failureMessage" TEXT,
    "failureStack" TEXT,
    "failureExpected" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStepRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "status" "WorkflowStepStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 0,
    "failureName" TEXT,
    "failureMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Routine" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerKind" "RoutineTriggerKind" NOT NULL DEFAULT 'manual',
    "cronExpression" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "triggerEvents" TEXT[],
    "changedFields" TEXT[],
    "debounceSeconds" INTEGER NOT NULL DEFAULT 300,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" "RoutineRunStatus",
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Routine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineRun" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "executedByUserId" TEXT,
    "status" "RoutineRunStatus" NOT NULL DEFAULT 'queued',
    "triggerKind" "RoutineTriggerKind" NOT NULL,
    "triggerEvent" TEXT,
    "triggerEntityId" TEXT,
    "triggerPayload" JSONB,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "workflowRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[],
    "secret" TEXT,
    "headers" JSONB,
    "bodyTemplate" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT,
    "ownerUserId" TEXT,
    "url" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "requestBody" JSONB NOT NULL,
    "statusCode" INTEGER,
    "responseMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowName_status_idx" ON "WorkflowRun"("workflowName", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_createdAt_idx" ON "WorkflowRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_tenantUserId_idx" ON "WorkflowRun"("tenantUserId");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_runId_stepName_idx" ON "WorkflowStepRun"("runId", "stepName");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_status_idx" ON "WorkflowStepRun"("status");

-- CreateIndex
CREATE INDEX "Routine_enabled_nextRunAt_idx" ON "Routine"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "Routine_ownerUserId_idx" ON "Routine"("ownerUserId");

-- CreateIndex
CREATE INDEX "Routine_triggerKind_idx" ON "Routine"("triggerKind");

-- CreateIndex
CREATE INDEX "RoutineRun_routineId_createdAt_idx" ON "RoutineRun"("routineId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutineRun_status_scheduledFor_idx" ON "RoutineRun"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Webhook_ownerUserId_idx" ON "Webhook"("ownerUserId");

-- CreateIndex
CREATE INDEX "Webhook_enabled_idx" ON "Webhook"("enabled");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_idx" ON "WebhookDelivery"("webhookId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_ownerUserId_idx" ON "WebhookDelivery"("ownerUserId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_createdAt_idx" ON "WebhookDelivery"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_tenantUserId_fkey" FOREIGN KEY ("tenantUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepRun" ADD CONSTRAINT "WorkflowStepRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineRun" ADD CONSTRAINT "RoutineRun_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineRun" ADD CONSTRAINT "RoutineRun_executedByUserId_fkey" FOREIGN KEY ("executedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineRun" ADD CONSTRAINT "RoutineRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
