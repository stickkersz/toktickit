-- Lab 3 Issue 02: rename RequesterUser to User in place and add the auth models.
--
-- HAND WRITTEN. `prisma migrate dev` renders this model rename as
-- DROP TABLE "RequesterUser" followed by CREATE TABLE "User", which destroys
-- every Lab 2 row and breaks Ticket ownership. Do not regenerate this file
-- from the schema. Statement order is fixed by docs/lab-03/specification.md
-- section 8 and docs/adr/0002-rename-requesteruser-to-user-in-place.md.

-- 1. Types the new columns depend on.
CREATE TYPE "UserRole" AS ENUM ('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR');

-- 2. Rename in place. The primary key, the Ticket foreign key and every row keep
--    their identity. The index and sequence renames give Prisma the names it
--    expects, so the schema shows no drift.
ALTER TABLE "RequesterUser" RENAME TO "User";
ALTER INDEX "RequesterUser_pkey" RENAME TO "User_pkey";
ALTER INDEX "RequesterUser_email_key" RENAME TO "User_email_key";
ALTER SEQUENCE "RequesterUser_id_seq" RENAME TO "User_id_seq";

-- 3. New columns. passwordHash is added NULLABLE because existing rows cannot
--    satisfy NOT NULL yet. The defaults below fill every existing row: each
--    migrated user becomes a REQUESTER who must change their password (BR-48).
ALTER TABLE "User"
    ADD COLUMN "passwordHash" TEXT,
    ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'REQUESTER',
    ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Backfill. SQL cannot compute scrypt, so every existing row receives the
--    fixed marker "!", which is not a well-formed scrypt hash and therefore
--    never verifies (BR-51). The seed issues real credentials afterwards
--    (BR-52). isActive is untouched: the account is not deactivated, it simply
--    holds no usable credential yet.
UPDATE "User" SET "passwordHash" = '!' WHERE "passwordHash" IS NULL;

-- 5. Only now can the column become NOT NULL. updatedAt is maintained by
--    Prisma (@updatedAt) and carries no database default.
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- 6. Additive changes.
ALTER TYPE "TicketStatus" ADD VALUE 'OPEN';
ALTER TYPE "TicketStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "TicketStatus" ADD VALUE 'WAITING_FOR_REQUESTER';
ALTER TYPE "TicketStatus" ADD VALUE 'RESOLVED';
ALTER TYPE "TicketStatus" ADD VALUE 'CLOSED';
ALTER TYPE "TicketStatus" ADD VALUE 'REOPENED';
ALTER TYPE "TicketStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "Ticket"
    ADD COLUMN "ownerId" INTEGER,
    ADD COLUMN "requesterResolutionFlaggedAt" TIMESTAMP(3),
    ADD COLUMN "resolutionSummary" TEXT;

CREATE TABLE "Session" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicComment" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "authorRole" "UserRole" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalNote" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "authorRole" "UserRole" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "PublicComment_ticketId_createdAt_idx" ON "PublicComment"("ticketId", "createdAt");
CREATE INDEX "InternalNote_ticketId_createdAt_idx" ON "InternalNote"("ticketId", "createdAt");
CREATE INDEX "Ticket_currentStatus_createdAt_idx" ON "Ticket"("currentStatus", "createdAt");
CREATE INDEX "Ticket_ownerId_currentStatus_idx" ON "Ticket"("ownerId", "currentStatus");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
