# Rename RequesterUser to User in place, with hand-written migration SQL

Lab 2 shipped a `RequesterUser` table whose rows own every existing Ticket. Lab 3 needs those same people to become real accounts with a password and a role, and the handout requires that existing Ticket ownership stay correct. We rename the table in place and add columns to it, rather than creating a `User` table and copying rows across, so every primary key is preserved and `Ticket.requesterId` keeps pointing at the same person without any data movement to verify.

## Consequences

Prisma renders a model rename as a drop followed by a create, which would destroy every row. The migration is therefore generated with `prisma migrate dev --create-only` and its SQL hand-edited to `ALTER TABLE "RequesterUser" RENAME TO "User"` before being applied, the same manual-SQL approach the Lab 2 migration used for `ticket_number_seq`. Anyone regenerating this migration from the schema alone will silently get the destructive version instead.

`passwordHash` cannot be added as `NOT NULL` directly, because existing rows cannot satisfy a `NOT NULL` column that has no default, and it cannot be filled in by the seed, because the seed only runs after the migration has finished. So the migration adds it nullable, backfills every existing row with the fixed marker `!` in the same file, and only then sets it `NOT NULL`. The marker is not a well-formed `scrypt$N$r$p$salt$hash` string, so `verifyPassword` rejects it for every input and a backfilled account cannot sign in until it is issued a real credential. SQL has no `scrypt`, which is why the migration cannot issue that credential itself.

The seed then issues the credentials as a separate second step: it writes a real hash only for a new row or a row still holding the marker, never over a well-formed hash, so re-seeding cannot reset a password a user has chosen. The required order is migrate, then seed, and no migrated account can sign in between the two. `docs/lab-03/specification.md` section 8 lists the exact statement order and BR-51 to BR-53 state the rules.

The order was checked by running it against the Lab 2 migrations with rows present: ids are preserved and `NOT NULL` holds. Omitting the marker backfill fails with `column "passwordHash" ... contains null values`.

The column stays named `requesterId` on `Ticket` even though it now references `User`. It names the role that user plays in the relationship, which is still accurate, and renaming it would touch every Lab 2 query and test for no behavioural gain.
