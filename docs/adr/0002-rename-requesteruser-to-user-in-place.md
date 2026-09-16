# Rename RequesterUser to User in place, with hand-written migration SQL

Lab 2 shipped a `RequesterUser` table whose rows own every existing Ticket. Lab 3 needs those same people to become real accounts with a password and a role, and the handout requires that existing Ticket ownership stay correct. We rename the table in place and add columns to it, rather than creating a `User` table and copying rows across, so every primary key is preserved and `Ticket.requesterId` keeps pointing at the same person without any data movement to verify.

## Consequences

Prisma renders a model rename as a drop followed by a create, which would destroy every row. The migration is therefore generated with `prisma migrate dev --create-only` and its SQL hand-edited to `ALTER TABLE "RequesterUser" RENAME TO "User"` before being applied, the same manual-SQL approach the Lab 2 migration used for `ticket_number_seq`. Anyone regenerating this migration from the schema alone will silently get the destructive version instead.

`passwordHash` is added nullable, backfilled by the seed, then set `NOT NULL` within the same migration, because existing rows cannot satisfy a `NOT NULL` column that has no default.

The column stays named `requesterId` on `Ticket` even though it now references `User`. It names the role that user plays in the relationship, which is still accurate, and renaming it would touch every Lab 2 query and test for no behavioural gain.
