# Server-side sessions in an httpOnly cookie, not a JWT

Lab 3 requires that logging out genuinely blocks further access, and that deactivating a user takes effect immediately. A self-contained JWT cannot satisfy either without a server-side revocation list, which is server state by another name, so we issue an opaque random token in an `httpOnly` cookie and keep the authoritative `Session` row in Postgres. Only the SHA-256 digest of the token is stored, so a database dump yields no usable sessions.

## Considered Options

- **JWT in `localStorage`**: simplest across origins, but readable by any injected script, and logout would be a client-side fiction: the token stays valid until it expires.
- **JWT in a cookie**: fixes the script exposure but not revocation.
- **Opaque token plus a `Session` table** (chosen): every request resolves the token to a row, so logout, expiry, deactivation, role change, and a password reset can all invalidate access at once.

## Consequences

The API is stateful: every authenticated request costs one session lookup, and expired rows need occasional pruning. Because the cookie must be first-party, the client is served through a Vite dev proxy so the API is same-origin in development; without it, a cross-origin cookie would need `SameSite=None; Secure`, which plain-HTTP local development cannot provide. CSRF is handled by `SameSite=Lax` plus the rule that no state-changing operation uses GET.
