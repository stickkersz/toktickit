import { describe, expect, it } from "vitest";
import { escapeLike } from "../../src/searchText.js";
import { parseStaffQueueQuery } from "../../src/staffQueueQuery.js";

const DEFAULTS = {
  search: "",
  status: null,
  itPriority: null,
  categoryId: null,
  owner: null,
  sortField: "createdAt",
  sortDirection: "desc",
  page: 1,
  pageSize: 10,
};

describe("parseStaffQueueQuery", () => {
  // UNIT-08 / L2-BR-23. Every unrecognised input falls back to its default and nothing throws.
  it("returns the defaults for an empty query", () => {
    expect(parseStaffQueueQuery({})).toEqual(DEFAULTS);
  });

  it("falls back to the default sort for an unknown field, direction, or type", () => {
    for (const sort of ["nope", "-nope", "", "-", "summary", "--createdAt", 42, ["createdAt"], null, undefined]) {
      const parsed = parseStaffQueueQuery({ sort });
      expect(parsed.sortField, String(sort)).toBe("createdAt");
      expect(parsed.sortDirection, String(sort)).toBe("desc");
    }
  });

  it("accepts every documented sort, ascending and descending", () => {
    for (const field of ["createdAt", "updatedAt", "ticketNumber", "itPriority", "currentStatus"]) {
      expect(parseStaffQueueQuery({ sort: field })).toMatchObject({ sortField: field, sortDirection: "asc" });
      expect(parseStaffQueueQuery({ sort: `-${field}` })).toMatchObject({ sortField: field, sortDirection: "desc" });
    }
  });

  it("falls back for an out-of-range or non-numeric page and pageSize", () => {
    for (const page of ["0", "-1", "1.5", "abc", "", "NaN", "Infinity"]) {
      expect(parseStaffQueueQuery({ page }).page, page).toBe(1);
    }
    for (const pageSize of ["4", "51", "0", "-10", "2.5", "abc", "", "1e9"]) {
      expect(parseStaffQueueQuery({ pageSize }).pageSize, pageSize).toBe(10);
    }
    expect(parseStaffQueueQuery({ page: "7", pageSize: "5" })).toMatchObject({ page: 7, pageSize: 5 });
    expect(parseStaffQueueQuery({ pageSize: "50" }).pageSize).toBe(50);
  });

  it("ignores an unknown status, priority, category, or owner instead of erroring", () => {
    const parsed = parseStaffQueueQuery({
      status: "BOGUS",
      itPriority: "URGENT",
      category: "-3",
      owner: "everyone",
    });
    expect(parsed).toMatchObject({ status: null, itPriority: null, categoryId: null, owner: null });
    expect(parseStaffQueueQuery({ category: "abc" }).categoryId).toBeNull();
    expect(parseStaffQueueQuery({ owner: "0" }).owner).toBeNull();
    expect(parseStaffQueueQuery({ owner: "007" }).owner).toBeNull();
    expect(parseStaffQueueQuery({ owner: "1.5" }).owner).toBeNull();
    expect(parseStaffQueueQuery({ owner: "99999999999999999999" }).owner).toBeNull();
  });

  it("reads every valid filter", () => {
    expect(
      parseStaffQueueQuery({ search: "  vpn  ", status: "IN_PROGRESS", itPriority: "HIGH", category: "4", owner: "12" }),
    ).toEqual({ ...DEFAULTS, search: "vpn", status: "IN_PROGRESS", itPriority: "HIGH", categoryId: 4, owner: { kind: "id", id: 12 } });
    for (const owner of ["unassigned", "me", "needs-owner"] as const) {
      expect(parseStaffQueueQuery({ owner }).owner).toEqual({ kind: owner });
    }
    for (const status of ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"]) {
      expect(parseStaffQueueQuery({ status }).status).toBe(status);
    }
  });

  it("never throws, whatever it is given", () => {
    const hostile = [
      { search: { $ne: 1 }, page: [1, 2], pageSize: {}, sort: () => 1, owner: ["me"], status: 5 },
      { search: null, category: null, itPriority: undefined },
      Object.create(null),
    ];
    for (const query of hostile) {
      expect(() => parseStaffQueueQuery(query as Record<string, unknown>)).not.toThrow();
      expect(parseStaffQueueQuery(query as Record<string, unknown>)).toEqual(DEFAULTS);
    }
  });
});

describe("escapeLike", () => {
  it("escapes the three characters LIKE treats specially and nothing else", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("file_name")).toBe("file\\_name");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
    expect(escapeLike("plain text 123 -.")).toBe("plain text 123 -.");
    expect(escapeLike("")).toBe("");
  });
});
