import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import * as prisma from "../../src/prisma.js";

// Requires the DB to be migrated and seeded first (BR-37).
describe("GET /api/requesters", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns only active Development Requesters, in id order", async () => {
    const res = await request(app).get("/api/requesters");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, name: "Kanokwan Srisuwan", email: "kanokwan.srisuwan@toktickit.test" },
      { id: 2, name: "Thanapon Wattana", email: "thanapon.wattana@toktickit.test" },
      { id: 3, name: "Nutchanon Boonmee", email: "nutchanon.boonmee@toktickit.test" },
      { id: 4, name: "Ploypailin Chaisiri", email: "ploypailin.chaisiri@toktickit.test" },
    ]);
    expect(res.body.every((r: { name: string }) => r.name !== "Somsak Rattanakosin")).toBe(true);
  });

  it("returns a safe 500 in the documented { error, message } shape on database failure", async () => {
    vi.spyOn(prisma, "getPrisma").mockReturnValue({
      requesterUser: { findMany: () => Promise.reject(new Error("connection refused")) },
    } as unknown as ReturnType<typeof prisma.getPrisma>);

    const res = await request(app).get("/api/requesters");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "INTERNAL_ERROR",
      message: "Unable to load requesters.",
    });
  });
});
