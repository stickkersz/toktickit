# TokTickIT

IT service desk application. Lab 1 proved React/Vite/Bootstrap → Express → Prisma → PostgreSQL work together; Lab 2 builds the Requester-facing ticketing MVP on top of that (see `docs/lab-02/specification.md`).

## Stack

- Frontend: React + TypeScript + Vite + Bootstrap + React Router
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL + Prisma
- Testing: Vitest (client) + Vitest/Supertest (server) + Playwright (E2E, responsive/visual)

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ reachable locally (or run via Docker, see below)

## Setup

### 1. Database

Start a local PostgreSQL matching the default `.env` values (user/password/db all `toktickit`), e.g. via Docker:

```bash
docker run -d --name toktickit-pg \
  -e POSTGRES_USER=toktickit -e POSTGRES_PASSWORD=toktickit -e POSTGRES_DB=toktickit \
  -p 5432:5432 postgres:16-alpine
```

### 2. Server

```bash
cd server
cp .env.example .env      # edit DATABASE_URL / PORT if needed
npm install
npx prisma migrate deploy # applies every migration, in order, without touching existing data
npm run prisma:seed       # then, as a SEPARATE second step: Categories, Related Systems, and the Lab 3 user accounts
npm run dev                # http://localhost:3000 (PORT from .env)
```

The API accepts credentialed cross-origin requests (the session cookie) only from an allow-list of browser origins: the Vite dev server and the Playwright client on `localhost` and `127.0.0.1`. Serve the client from another port or host by adding it to `CORS_ORIGINS` in `server/.env`.

**Run the migration first and the seed second, always in that order.** The Lab 3 migration renames the Lab 2 `RequesterUser` table to `User` in place and cannot compute a password hash in SQL, so it gives every existing account an unusable placeholder credential. Until the seed has run, no migrated account can sign in. The seed is what issues the real initial password, and it never overwrites a password that a user has already chosen, so running it again is always safe. See `docs/adr/0002-rename-requesteruser-to-user-in-place.md`.

Use `prisma migrate deploy`, not `prisma migrate dev`, on a database that already holds data: `migrate dev` would regenerate the rename as a destructive drop and create.

### Development accounts (local only)

These accounts exist only in a local development database and are created by the seed. The shared initial password is a **local development credential, not a real secret**; every account must replace it at first sign in.

| Role | Accounts | Initial password |
|---|---|---|
| Requester | `kanokwan.srisuwan@toktickit.test`, `thanapon.wattana@toktickit.test`, `nutchanon.boonmee@toktickit.test`, `ploypailin.chaisiri@toktickit.test` (active), `somsak.rattanakosin@toktickit.test` (inactive) | `ChangeMe!23` |
| IT Staff | `pimchanok.somboon@toktickit.test`, `wichai.charoen@toktickit.test`, `anucha.prasert@toktickit.test` (active), `sunisa.kaewmanee@toktickit.test` (inactive) | `ChangeMe!23` |
| Administrator | `aekkarat.wongsa@toktickit.test` | `ChangeMe!23` |

Sign in at `http://localhost:5173/login`. An account that still holds the initial password is taken straight to Change Password and can reach nothing else until it has chosen a new one. The seed also creates 14 example Tickets (numbers `TKT-2026-900001` to `TKT-2026-900014`) spread over every status, priority and Requester, with some unassigned and two owned by the inactive IT Staff account, so the IT Staff Ticket Queue has something to show and its "Needs new owner" markers have real rows. Re-running the seed never changes a Ticket that already exists. IT Staff and Administrators land on the Ticket Queue; try the Owner filter's "Needs an owner" option, then open a Ticket to claim it, change its IT Priority and status, and read or download its attachments. Resolving asks for a Resolution Summary, which the Requester can read; the Requester can answer "Problem appears resolved", which staff see as a banner and which never changes the status by itself.

The Lab 2 Development Requester selector no longer exists: you are always the account you signed in as. Each role sees only its own navigation, and a screen its role may not use shows an "Access denied" state even by direct URL. The Administrator's User Management screen and the Public Comments and Internal Notes panels arrive in later Issues. Once an account has chosen its own password the seed never resets it, so to sign in with `ChangeMe!23` again use an account you have not touched yet.

### 3. Client

```bash
cd client
cp .env.example .env      # optional: only needed if your server is not on port 3000
npm install
npm run dev                # http://localhost:5173
```

The client calls a relative `/api`, and the Vite dev server proxies it to the API (`http://127.0.0.1:3000` by default; set `VITE_API_PROXY_TARGET` in `client/.env` if your server uses another port). That keeps the browser on a single origin, so the session cookie is first-party. **Leave `VITE_API_URL` unset**: an older `client/.env` that still sets it sends the browser straight to that URL cross-origin instead of through the proxy.

Open the client URL. Without a session every route sends you to the Login screen. The four active seeded Requesters are listed under Development accounts below.

After signing in as a Requester the Lab 2 workflow is complete: create a Ticket with attachments, find it in My Tickets (search, filter, sort, paginate), open its Ticket Detail, and add, download, or soft-remove attachments. A Requester only ever sees their own Tickets; another Requester's Ticket returns "Ticket not found" even by direct URL.

## Tests

```bash
cd server && npm test      # Vitest/Supertest: unit validators + every Lab 2 and Lab 3 API endpoint, plus migration and seed tests
cd client && npm test      # Vitest + Testing Library: every Lab 2 screen and its states
```

### End-to-end, responsive, and visual

Playwright drives a real browser against a live stack. It starts the API and client dev
servers itself, so only the database has to be up, migrated, and seeded first.

```bash
npm install                       # once, at the repo root
npx playwright install chromium   # once, downloads the browser
npx playwright test               # E2E flows + responsive checks at 375/768/1280
```

This also regenerates the screenshots under `artifacts/lab-02/screenshots/`.

See `docs/lab-02/tests.md` for the full Lab 2 test plan, the acceptance-criterion
traceability matrix, and the final results (`docs/lab-01/tests.md` for Lab 1).

## Project docs

- `docs/lab-02/specification.md`, `api-spec.md`, `ui-spec.md`, `tests.md` — Lab 2 engineering contract
- `docs/lab-02/reviewer.md` — Lab 2 peer review record, both directions
- `docs/lab-02/ai-use.md` — Lab 2 AI tool usage and reflection
- `docs/lab-01/tests.md` — Lab 1 test plan and passing evidence
- `docs/lab-01/ai_use.md` — AI tool usage and reflection
- `docs/lab-01/reviewer.md` — peer review record
