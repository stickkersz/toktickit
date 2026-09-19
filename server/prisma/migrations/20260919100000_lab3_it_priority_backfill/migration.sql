-- BR-22: IT Priority starts as a copy of the Requested Priority. Tickets created
-- before Lab 3 have IT Priority NULL because Lab 2 never set it, and the staff queue
-- shows, filters and sorts by it, so those rows are backfilled once. Data only: the
-- column already exists and no schema object changes.
UPDATE "Ticket" SET "itPriority" = "requestedPriority" WHERE "itPriority" IS NULL;
