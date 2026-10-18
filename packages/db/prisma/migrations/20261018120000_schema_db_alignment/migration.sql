-- Align the deployed database with packages/db/prisma/schema.prisma.
--
-- Two defects shipped in the workflow-automation drop:
--   1. Routine.triggerEvents / Routine.changedFields had no default and were
--      nullable, while the client reads them as always-present arrays.
--   2. ChannelMessage.ownerUserId was declared as a relation but the foreign
--      key was never added, so a message could be ingested for a user id that
--      does not exist and every owner-scoped read would still return it.

-- Backfill before tightening, so the NOT NULL and the foreign key cannot fail
-- on rows written during the window when the column was free-form.
UPDATE "Routine" SET "triggerEvents" = ARRAY[]::TEXT[] WHERE "triggerEvents" IS NULL;
UPDATE "Routine" SET "changedFields" = ARRAY[]::TEXT[] WHERE "changedFields" IS NULL;

ALTER TABLE "Routine" ALTER COLUMN "triggerEvents" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Routine" ALTER COLUMN "triggerEvents" SET NOT NULL;
ALTER TABLE "Routine" ALTER COLUMN "changedFields" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Routine" ALTER COLUMN "changedFields" SET NOT NULL;

UPDATE "ChannelMessage"
SET "ownerUserId" = NULL
WHERE "ownerUserId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = "ChannelMessage"."ownerUserId");

ALTER TABLE "ChannelMessage"
  ADD CONSTRAINT "ChannelMessage_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
