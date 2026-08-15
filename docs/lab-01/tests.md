# Lab 1 — Test Plan and Evidence

This documents what each automated test checks, how to run the suites, and proof they pass on `main`.

## What is being tested and why

TokTickIT's Lab 1 slice has two moving parts that need independent proof of correctness: the Express API (talking to PostgreSQL through Prisma) and the React UI (talking to that API). Each Issue's acceptance criteria maps to one or more tests below, so a green suite is direct evidence the criteria are met — not just that the code compiles.

## Test matrix

| # | Test file | Tool | Issue | What it proves |
|---|-----------|------|-------|-----------------|
| API-01 | `server/tests/lab-01/health.test.ts` | Vitest + Supertest | 2 | `GET /api/health` returns HTTP 200 with body `{ status: "ok", service: "TokTickIT API" }` — proves the Express server boots and responds. |
| API-02 | `server/tests/lab-01/categories.test.ts` | Vitest + Supertest | 3, 4 | `GET /api/categories` returns HTTP 200 with the four seeded categories, in ascending `id` order: Account and Access, Hardware, Software, Network — proves the Prisma model, the seed script, and the route all agree. |
| UI-01 | `client/tests/lab-01/App.test.tsx` | Vitest + React Testing Library | 4 | The `TokTickIT` heading renders — smoke test that the app mounts. |
| UI-02 | `client/tests/lab-01/App.test.tsx` | Vitest + RTL + `userEvent` | 4 | Clicking "Check System" with a mocked successful API call flips the UI to `System Status: Online` and lists the seeded category names (e.g. "Hardware") — proves the idle → loading → success state transition and rendering. |
| UI-03 | `client/tests/lab-01/App.test.tsx` | Vitest + RTL + `userEvent` | 4 | Clicking "Check System" with a mocked failed API call flips the UI to `System Status: Offline` and shows "Unable to connect..." — proves the idle → loading → error state transition, so a down API never hangs silently. |

`client/src/api.ts` is mocked with `vi.spyOn` in the UI tests rather than hitting a real server, so the client suite is fast and independent of the database being up. API-01/API-02 do hit a real Express `app` instance (via Supertest) against the actual Postgres database, so they require the DB to be migrated (`npx prisma migrate deploy`) and seeded (`npx prisma db seed`) first.

## How to run

### 1. Start PostgreSQL

The API tests (API-01, API-02) hit a real database, so Postgres must be
running first. This project runs Postgres in Docker, container name
`toktickit-pg`.

```bash
# check Docker Desktop is running at all
docker ps
```

If that errors with something like `Cannot connect to the Docker daemon`,
Docker Desktop itself is not running — open it (`open -a Docker` on macOS)
and wait ~10-30s for the daemon to come up, then re-check with `docker ps`.

```bash
# check whether the toktickit-pg container exists and its state
docker ps -a --filter name=toktickit-pg
```

- If it shows `Up ...`, Postgres is already running — skip to step 2.
- If it shows `Exited ...`, start it: `docker start toktickit-pg`
- If no container is listed at all, it needs to be created (see the
  project setup docs) before continuing.

Confirm the port is actually reachable:

```bash
nc -z localhost 5432 && echo "Postgres is reachable" || echo "Postgres is NOT reachable"
```

### 2. Point the server at the database

`server/.env` must have `DATABASE_URL` pointing at that same Postgres
instance (copy `server/.env.example` if `.env` doesn't exist yet):

```text
DATABASE_URL="postgresql://toktickit:toktickit@localhost:5432/toktickit?schema=public"
```

### 3. Apply migrations and seed data

```bash
cd server
npx prisma migrate deploy   # applies any pending schema migrations
npx prisma db seed          # inserts the 4 fixed categories the tests expect
```

`migrate deploy` prints "No pending migrations to apply" if the schema is
already current — that's fine, not an error. `db seed` prints
"Seeded 4 categories." on success.

### 4. Run the server test suite

Still inside `server/`:

```bash
npm test
```

or, to see each test named individually (useful for screenshots/evidence):

```bash
npx vitest run tests/lab-01/health.test.ts tests/lab-01/categories.test.ts --reporter=verbose
```

Both API-01 (`health.test.ts`) and API-02 (`categories.test.ts`) should
report `✓`. If API-02 fails with a 500 status instead of 200, the most
common cause is Postgres not actually running/reachable — go back to
step 1.

### 5. Run the client test suite

The UI tests (UI-01, UI-02, UI-03) mock `client/src/api.ts` with
`vi.spyOn`, so no database or running server is required for this part.

```bash
cd client
npm test
```

or, verbose/individually:

```bash
npx vitest run tests/lab-01/App.test.tsx --reporter=verbose
```

All 3 tests in `App.test.tsx` should report `✓`.

## Passing terminal output (re-run on `feature/Lab1Doc`, commit `9f7c1e1`, 2026-08-15)

### Server — `cd server && npx vitest run tests/lab-01/health.test.ts tests/lab-01/categories.test.ts --reporter=verbose`

```text
 RUN  v2.1.9 /toktickit/server

 ✓ tests/lab-01/health.test.ts > GET /api/health > returns 200 with status ok and the service name
 ✓ tests/lab-01/categories.test.ts > GET /api/categories > returns the four seeded categories in id order

 Test Files  2 passed (2)
      Tests  2 passed (2)
```

### Client — `cd client && npx vitest run tests/lab-01/App.test.tsx --reporter=verbose`

```text
 RUN  v2.1.9 /toktickit/client

 ✓ tests/lab-01/App.test.tsx > App > renders the TokTickIT heading
 ✓ tests/lab-01/App.test.tsx > App > shows Online and the seeded categories on success
 ✓ tests/lab-01/App.test.tsx > App > shows an Offline error message when the API is unavailable

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Manual verification (screenshots)

Automated tests mock or isolate each layer; these screenshots show the real UI talking to the real API and database end to end, covering all three UI states.

**Idle** — initial load, before the user has checked the system:

![App idle state, showing the TokTickIT heading and an unclicked Check System button](screenshots/app-idle.jpg)

**Success** — after clicking "Check System" with the API and Postgres both up; the four seeded categories are listed in id order:

![App success state, showing System Status: Online and the four category names — Account and Access, Hardware, Software, Network](screenshots/app-success.jpg)

**Error** — after clicking "Check System" with the API unreachable; the UI fails safely instead of hanging:

![App error state, showing System Status: Offline and the message Unable to connect to TokTickIT API](screenshots/app-error.jpg)
