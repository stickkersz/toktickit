-- Lab 4 down script (spec BR-45). Removes only the objects added by the migration
-- 20261030090000_lab4_actions_status_history and leaves every Lab 3 row exactly as it was.
-- Actions Taken and Status Changes recorded since the migration are lost, so take a pg_dump
-- backup before running it. Tested by server/tests/lab-04/migration.test.ts (MIG-02).
--
-- Run it in one transaction:
--   npx prisma db execute --file prisma/rollback/lab-04-down.sql
-- then tell Prisma the migration is no longer applied:
--   npx prisma migrate resolve --rolled-back 20261030090000_lab4_actions_status_history
BEGIN;

DROP TABLE "ActionTaken";
DROP TABLE "StatusChange";
DROP TYPE "ActionStatus";

DROP INDEX "Ticket_requesterId_idempotencyKey_key";
DROP INDEX "PublicComment_authorId_idempotencyKey_key";
DROP INDEX "InternalNote_authorId_idempotencyKey_key";
DROP INDEX "Ticket_updatedAt_idx";
DROP INDEX "Ticket_itPriority_currentStatus_idx";

ALTER TABLE "Ticket" DROP COLUMN "idempotencyKey", DROP COLUMN "requestHash";
ALTER TABLE "PublicComment" DROP COLUMN "idempotencyKey", DROP COLUMN "requestHash";
ALTER TABLE "InternalNote" DROP COLUMN "idempotencyKey", DROP COLUMN "requestHash";

COMMIT;
