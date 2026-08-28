import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import * as prisma from "../../src/prisma.js";

// Requires the DB to be migrated and seeded first.
describe("GET /api/related-systems", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns only active Related Systems, in id order", async () => {
    const res = await request(app).get("/api/related-systems");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((r: { id: number }) => r.id > 0)).toBe(true);
    expect(res.body.some((r: { name: string }) => r.name === "Legacy Alumni Portal")).toBe(false);
    expect(res.body.map((r: { id: number }) => r.id)).toEqual(
      [...res.body.map((r: { id: number }) => r.id)].sort((a: number, b: number) => a - b),
    );
  });

  it("returns a safe 500 in the documented { error, message } shape on database failure", async () => {
    vi.spyOn(prisma, "getPrisma").mockReturnValue({
      relatedSystem: { findMany: () => Promise.reject(new Error("connection refused")) },
    } as unknown as ReturnType<typeof prisma.getPrisma>);

    const res = await request(app).get("/api/related-systems");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "INTERNAL_ERROR",
      message: "Unable to load related systems.",
    });
  });
});
