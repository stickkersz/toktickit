import { beforeAll, describe, expect, it } from "vitest";
import { createUser, signedIn, useIsolatedDatabase } from "./helpers.js";

// BR-22: IT Priority starts as a copy of the Requested Priority. Only IT Staff or an
// Administrator may change it afterwards, which arrives with the staff Ticket operations.
const iso = useIsolatedDatabase({ referenceData: true });

let requester: Awaited<ReturnType<typeof signedIn>>;

beforeAll(async () => {
  requester = await signedIn((await createUser()).user);
});

describe("IT Priority on a new Ticket", () => {
  // API-54 / BR-22
  it.each(["LOW", "MEDIUM", "HIGH"] as const)("starts as a copy of a %s Requested Priority", async (priority) => {
    const res = await requester.post("/api/tickets").send({
      categoryId: 1,
      relatedSystemId: 1,
      summary: `IT priority starts as ${priority}`,
      description: "Checks that IT Priority is copied from the Requested Priority at creation.",
      requestedPriority: priority,
    });
    expect(res.status).toBe(201);

    const stored = await iso.db.client.ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.requestedPriority).toBe(priority);
    expect(stored.itPriority).toBe(priority);
  });

  it("cannot be set by the Requester at creation: a client-supplied itPriority is ignored", async () => {
    const res = await requester.post("/api/tickets").send({
      categoryId: 1,
      relatedSystemId: 1,
      summary: "A Requester tries to set IT Priority",
      description: "The body carries an itPriority that must have no effect at all.",
      requestedPriority: "LOW",
      itPriority: "HIGH",
    });
    expect(res.status).toBe(201);
    const stored = await iso.db.client.ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.itPriority).toBe("LOW");
    expect(res.body.itPriority).toBeUndefined();
  });
});
