import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import * as prisma from "../../src/prisma.js";

// Requires the DB to be migrated and seeded first.
describe("GET /api/categories", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the four seeded categories in id order", async () => {
    const res = await request(app).get("/api/categories");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, name: "Account and Access" },
      { id: 2, name: "Hardware" },
      { id: 3, name: "Software" },
      { id: 4, name: "Network" },
    ]);
  });

  it("returns a safe 500 in the documented { error, message } shape on database failure", async () => {
    vi.spyOn(prisma, "getPrisma").mockReturnValue({
      category: { findMany: () => Promise.reject(new Error("connection refused")) },
    } as unknown as ReturnType<typeof prisma.getPrisma>);

    const res = await request(app).get("/api/categories");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "INTERNAL_ERROR",
      message: "Unable to load categories.",
    });
  });
});
