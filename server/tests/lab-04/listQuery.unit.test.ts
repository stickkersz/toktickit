import { describe, expect, it } from "vitest";
import { parseTicketListQuery } from "../../src/ticketListQuery.js";
import { parseStaffQueueQuery } from "../../src/staffQueueQuery.js";

// Lab 4 api-spec section 11: the dashboard drill-down parameters on My Tickets and the Ticket Queue. Known
// values apply, unknown values fall back to the default (L2-BR-23), and a single status wins over a group.
describe("My Tickets query (parseTicketListQuery)", () => {
  // UNIT-07 / BR-36
  it("applies every status, both groups, the windows, and the last-updated sort", () => {
    for (const s of ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"]) {
      expect(parseTicketListQuery({ currentStatus: s }).currentStatus).toBe(s);
    }
    expect(parseTicketListQuery({ statusGroup: "active" }).statusGroup).toBe("active");
    expect(parseTicketListQuery({ statusGroup: "resolved" }).statusGroup).toBe("resolved");
    const q = parseTicketListQuery({ updatedWithinDays: "7", resolvedWithinDays: "30", sort: "-updatedAt" });
    expect(q).toMatchObject({ updatedWithinDays: 7, resolvedWithinDays: 30, sortField: "updatedAt", sortDirection: "desc" });
    expect(parseTicketListQuery({ sort: "updatedAt" })).toMatchObject({ sortField: "updatedAt", sortDirection: "asc" });
  });

  // UNIT-07 / BR-36, L2-BR-23
  it("falls back to the default for unknown values and windows outside 1 to 90", () => {
    const q = parseTicketListQuery({ currentStatus: "DONE", statusGroup: "open", updatedWithinDays: "0", resolvedWithinDays: "91", sort: "-lastSeen" });
    expect(q).toMatchObject({ currentStatus: null, statusGroup: null, updatedWithinDays: null, resolvedWithinDays: null, sortField: "createdAt", sortDirection: "desc" });
    expect(parseTicketListQuery({ updatedWithinDays: "7.5" }).updatedWithinDays).toBeNull();
    expect(parseTicketListQuery({ updatedWithinDays: "90" }).updatedWithinDays).toBe(90);
  });

  // UNIT-07 / BR-36
  it("lets a single status win over a group", () => {
    expect(parseTicketListQuery({ currentStatus: "CLOSED", statusGroup: "active" })).toMatchObject({ currentStatus: "CLOSED", statusGroup: null });
  });
});

describe("Ticket Queue query (parseStaffQueueQuery)", () => {
  // UNIT-07 / BR-36
  it("applies statusGroup and the last-updated sort, ignores unknown values, and lets a single status win", () => {
    expect(parseStaffQueueQuery({ statusGroup: "active" }).statusGroup).toBe("active");
    expect(parseStaffQueueQuery({ statusGroup: "anything" }).statusGroup).toBeNull();
    expect(parseStaffQueueQuery({ sort: "-updatedAt" })).toMatchObject({ sortField: "updatedAt", sortDirection: "desc" });
    expect(parseStaffQueueQuery({ status: "RESOLVED", statusGroup: "active" })).toMatchObject({ status: "RESOLVED", statusGroup: null });
  });
});
