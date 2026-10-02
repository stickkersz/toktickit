# A version column for stale Action Taken edits

Several IT Staff users may edit the same Planned Action Taken, and the labsheet requires that nobody unknowingly overwrites another user's recent change. Each Action Taken carries an integer `version`; every edit, completion, or cancellation must send the version it read, and the server applies it with a conditional update that matches both the id and that version, incrementing it on success. A mismatch writes nothing and returns 409, and the client reloads the Action while keeping what the user typed.

## Considered Options

- **Last write wins**: simplest, but silently discards a colleague's change, which the labsheet forbids.
- **Compare `updatedAt` timestamps**: no new column, but millisecond timestamps can collide and depend on clock precision.
- **Integer version with a conditional update** (chosen): exact, cheap, and atomic in a single statement, so no lock is held between read and write.

## Consequences

Every write request for an Action Taken must include `version`, and the API rejects one without it. Tickets use a different, documented check: a status move carries the status the user saw (`fromStatus`, BR-23) and is written conditionally on it, so a move chosen against a status the Ticket no longer has is refused with 409. Lab 3 already wrote moves conditionally on the status the server checked (`server/src/routes/staffTickets.ts`); Lab 4 makes the client state that status. A Ticket needs no version number because its status is the only field whose stale overwrite matters.
