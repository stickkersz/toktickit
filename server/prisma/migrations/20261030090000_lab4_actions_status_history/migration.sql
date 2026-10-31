-- Lab 4 (spec section 7, BR-44): additive only. New tables for Actions Taken and Status Changes,
-- nullable idempotencyKey and requestHash columns on the four created records, the dashboard
-- indexes, and the BR-25 backfill. No existing column changes and no row is deleted.
-- Recovery: take a pg_dump backup first; prisma/rollback/lab-04-down.sql removes only these objects (BR-45).

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "InternalNote" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- AlterTable
ALTER TABLE "PublicComment" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- CreateTable
CREATE TABLE "ActionTaken" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "actionAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "result" TEXT,
    "status" "ActionStatus" NOT NULL DEFAULT 'PLANNED',
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpNote" TEXT,
    "attachmentNotes" TEXT,
    "recordedById" INTEGER NOT NULL,
    "responsibleStaffId" INTEGER NOT NULL,
    "performedById" INTEGER,
    "completedAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "lastEditedById" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT,
    "requestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionTaken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusChange" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "fromStatus" "TicketStatus",
    "toStatus" "TicketStatus" NOT NULL,
    "changedById" INTEGER NOT NULL,
    "resolutionSummary" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionTaken_ticketId_actionAt_id_idx" ON "ActionTaken"("ticketId", "actionAt", "id");

-- CreateIndex
CREATE INDEX "ActionTaken_responsibleStaffId_status_actionAt_idx" ON "ActionTaken"("responsibleStaffId", "status", "actionAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionTaken_recordedById_idempotencyKey_key" ON "ActionTaken"("recordedById", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StatusChange_ticketId_changedAt_id_idx" ON "StatusChange"("ticketId", "changedAt", "id");

-- CreateIndex
CREATE INDEX "StatusChange_toStatus_changedAt_idx" ON "StatusChange"("toStatus", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InternalNote_authorId_idempotencyKey_key" ON "InternalNote"("authorId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PublicComment_authorId_idempotencyKey_key" ON "PublicComment"("authorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Ticket_updatedAt_idx" ON "Ticket"("updatedAt");

-- CreateIndex
CREATE INDEX "Ticket_itPriority_currentStatus_idx" ON "Ticket"("itPriority", "currentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_requesterId_idempotencyKey_key" ON "Ticket"("requesterId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_responsibleStaffId_fkey" FOREIGN KEY ("responsibleStaffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill (BR-25): every Ticket that existed before Lab 4 gets one Status Change recording its
-- creation as NEW, at its creation time, made by its Requester. Its later moves were never recorded
-- and are not invented.
INSERT INTO "StatusChange" ("ticketId", "fromStatus", "toStatus", "changedById", "changedAt")
SELECT id, NULL, 'NEW', "requesterId", "createdAt" FROM "Ticket";
