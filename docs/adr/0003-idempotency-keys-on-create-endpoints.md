# Idempotency keys on the four create endpoints

Lab 4 requires that duplicate actions caused by repeated clicking or a network retry are prevented or safely handled. Until now (Lab 2 BR-17) the only guard was the client disabling its Submit button, which cannot stop a request the browser or a proxy resends after a lost response. Ticket create, Public Comment create, Internal Note create, and Action Taken create therefore accept an `Idempotency-Key` header holding a client-generated UUID per form submission. The key is stored with the created row under a unique constraint scoped to the acting User, and a repeat of the same key returns the row that already exists instead of creating a second one.

## Considered Options

- **Client single-flight only**: no server change, but a retried request after a lost response still creates a duplicate.
- **Key on Action Taken create only**: covers the new feature but leaves Public Comments and Internal Notes, both append-only and visible, open to duplicates that can never be removed.
- **Key on all four create endpoints** (chosen): one mechanism, one test pattern, and the labsheet's hardening rule holds application-wide.
- **Deduplicate on identical payload**: rejected because two genuinely identical comments are legitimate.

## Consequences

Four existing endpoints change, so each needs a regression test for both the first request and the replay. The client must keep one key per form submission and generate a new one only after a confirmed success or when the user changes the content, otherwise a corrected retry would be swallowed. A missing key is accepted and behaves as before, so older clients and tests keep working.
