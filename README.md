# TokTickIT

IT service desk application. Lab 1 proved React/Vite/Bootstrap → Express → Prisma → PostgreSQL work together; Lab 2 builds the Requester-facing ticketing MVP on top of that (see `docs/lab-02/specification.md`).

## Stack

- Frontend: React + TypeScript + Vite + Bootstrap + React Router
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL + Prisma
- Testing: Vitest (client) + Vitest/Supertest (server)

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
npx prisma migrate dev    # creates the Category, RequesterUser, RelatedSystem, Ticket, Attachment tables
npm run prisma:seed       # seeds Categories, Related Systems, and Development Requesters (active + inactive fixtures)
npm run dev                # http://localhost:3001 (or PORT from .env)
```

### 3. Client

```bash
cd client
cp .env.example .env      # set VITE_API_URL to match the server PORT
npm install
npm run dev                # http://localhost:5173
```

Open the client URL. It opens on the Development Requester Selection screen (`/select-requester`, a Lab 2 testing mechanism, not authentication); selecting a Requester and clicking Continue takes you to `/tickets`. Ticket screens are placeholders for now, built out across the rest of Lab 2's Issues.

## Tests

```bash
cd server && npm test      # Vitest/Supertest: health, categories, requesters endpoints, Lab 2 seed
cd client && npm test      # Vitest: Development Requester Selection states + routing gate
```

See `docs/lab-02/tests.md` for the full Lab 2 test plan and evidence (`docs/lab-01/tests.md` for Lab 1).

## Project docs

- `docs/lab-02/specification.md`, `api-spec.md`, `ui-spec.md`, `tests.md` — Lab 2 engineering contract
- `docs/lab-01/tests.md` — Lab 1 test plan and passing evidence
- `docs/lab-01/ai_use.md` — AI tool usage and reflection
- `docs/lab-01/reviewer.md` — peer review record
