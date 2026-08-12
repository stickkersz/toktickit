# Lab 1 — Test Plan and Evidence

All test files live under `server/tests/lab-01/` and `client/tests/lab-01/`.

| # | Test File | Tool | Test Description |
|---|-----------|------|-------------------|
| API-01 | server/tests/lab-01/health.test.ts | Supertest | Health endpoint returns 200 and expected JSON |
| API-02 | server/tests/lab-01/categories.test.ts | Supertest | Categories endpoint returns the four seeded categories in id order |
| UI-01 | client/tests/lab-01/App.test.tsx | Vitest | TokTickIT heading renders |
| UI-02 | client/tests/lab-01/App.test.tsx | Vitest | Loading state changes to category list on success |
| UI-03 | client/tests/lab-01/App.test.tsx | Vitest | API failure displays a useful error message |

## Passing terminal output

### Server (`cd server && npm test`)

```
 RUN  v2.1.9 server

 ✓ tests/lab-01/health.test.ts (1 test) 9ms
 ✓ tests/lab-01/categories.test.ts (1 test) 50ms

 Test Files  2 passed (2)
      Tests  2 passed (2)
```

### Client (`cd client && npm test`)

```
 RUN  v2.1.9 client

 ✓ tests/lab-01/App.test.tsx (3 tests) 62ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```
