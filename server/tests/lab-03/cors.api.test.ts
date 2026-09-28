import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { DEFAULT_CORS_ORIGINS, allowedOrigins } from "../../src/cors.js";

// No database is touched: these exercise the CORS layer only.
describe("credentialed CORS for the session cookie", () => {
  const allowed = "http://localhost:5173";

  // API-53 / AC-45, BR-62
  it("echoes an allowed origin with credentials on a preflight, never a wildcard", async () => {
    const res = await request(app)
      .options("/api/auth/login")
      .set("Origin", allowed)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(allowed);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toMatch(/POST/);
    expect(res.headers["access-control-allow-headers"]).toMatch(/content-type/i);
    expect(res.headers["vary"]).toMatch(/Origin/);
  });

  it("adds the same headers to a real response, so the browser exposes it to the page", async () => {
    const res = await request(app).get("/api/health").set("Origin", "http://127.0.0.1:5180");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5180");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("sends no CORS headers to an origin that is not on the list", async () => {
    for (const origin of ["https://evil.example", "http://localhost:5174", "null"]) {
      const preflight = await request(app)
        .options("/api/auth/login")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST");
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
      expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();

      const actual = await request(app).get("/api/health").set("Origin", origin);
      expect(actual.headers["access-control-allow-origin"]).toBeUndefined();
      expect(actual.headers["access-control-allow-credentials"]).toBeUndefined();
    }
  });

  it("leaves a same-origin request with no Origin header alone", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reads CORS_ORIGINS, falls back to the dev defaults, and drops a wildcard", () => {
    expect(allowedOrigins({})).toEqual(DEFAULT_CORS_ORIGINS);
    expect(allowedOrigins({ CORS_ORIGINS: " https://app.example , http://a.test " })).toEqual([
      "https://app.example",
      "http://a.test",
    ]);
    expect(allowedOrigins({ CORS_ORIGINS: "*, http://a.test" })).toEqual(["http://a.test"]);
    expect(allowedOrigins({ CORS_ORIGINS: "*" })).toEqual([]);
    expect(allowedOrigins({ CORS_ORIGINS: "" })).toEqual([]);
  });
});
