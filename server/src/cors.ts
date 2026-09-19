import type { CorsOptions } from "cors";

// Browser origins allowed to call the API with the session cookie. These are the
// Vite dev server (5173) and the Playwright client (5180), on both spellings of
// the loopback host. Override with a comma separated CORS_ORIGINS.
export const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5180",
  "http://127.0.0.1:5180",
];

// A wildcard is dropped on purpose: browsers refuse `Access-Control-Allow-Origin: *`
// on a credentialed request, and reflecting any origin would let every website
// use a signed-in user's cookie. Only exact, listed origins are ever allowed.
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CORS_ORIGINS;
  if (raw === undefined) return DEFAULT_CORS_ORIGINS;
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "" && o !== "*");
}

// Credentialed CORS for the session cookie (BR-62). An allowed origin is echoed
// back exactly with `Access-Control-Allow-Credentials: true` and `Vary: Origin`;
// any other origin receives no CORS headers at all, so the browser blocks it.
export function buildCorsOptions(origins: string[] = allowedOrigins()): CorsOptions {
  return {
    origin: (origin, callback) => callback(null, origin !== undefined && origins.includes(origin)),
    credentials: true,
    maxAge: 600,
  };
}
