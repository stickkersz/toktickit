import { describe, expect, it } from "vitest";
import { parseTicketListQuery } from "../../src/ticketListQuery.js";

describe("parseTicketListQuery", () => {
  it("defaults sort to -createdAt, page to 1, pageSize to 10", () => {
    const result = parseTicketListQuery({});
    expect(result.sortField).toBe("createdAt");
    expect(result.sortDirection).toBe("desc");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.search).toBe("");
    expect(result.categoryId).toBeNull();
    expect(result.requestedPriority).toBeNull();
    expect(result.currentStatus).toBeNull();
  });

  it("accepts every permitted sort key", () => {
    expect(parseTicketListQuery({ sort: "createdAt" })).toMatchObject({
      sortField: "createdAt",
      sortDirection: "asc",
    });
    expect(parseTicketListQuery({ sort: "ticketNumber" })).toMatchObject({
      sortField: "ticketNumber",
      sortDirection: "asc",
    });
    expect(parseTicketListQuery({ sort: "-summary" })).toMatchObject({
      sortField: "summary",
      sortDirection: "desc",
    });
  });

  it("falls back to the default sort for an unrecognized value", () => {
    const result = parseTicketListQuery({ sort: "priority" });
    expect(result.sortField).toBe("createdAt");
    expect(result.sortDirection).toBe("desc");
  });

  it("falls back to page 1 for non-numeric or out-of-range page", () => {
    expect(parseTicketListQuery({ page: "abc" }).page).toBe(1);
    expect(parseTicketListQuery({ page: "0" }).page).toBe(1);
    expect(parseTicketListQuery({ page: "-3" }).page).toBe(1);
    expect(parseTicketListQuery({ page: "3" }).page).toBe(3);
  });

  it("falls back to pageSize 10 outside the 5-50 range", () => {
    expect(parseTicketListQuery({ pageSize: "abc" }).pageSize).toBe(10);
    expect(parseTicketListQuery({ pageSize: "4" }).pageSize).toBe(10);
    expect(parseTicketListQuery({ pageSize: "51" }).pageSize).toBe(10);
    expect(parseTicketListQuery({ pageSize: "5" }).pageSize).toBe(5);
    expect(parseTicketListQuery({ pageSize: "50" }).pageSize).toBe(50);
  });

  it("parses category/requestedPriority/currentStatus filters, ignoring invalid values", () => {
    expect(parseTicketListQuery({ category: "3" }).categoryId).toBe(3);
    expect(parseTicketListQuery({ category: "abc" }).categoryId).toBeNull();
    expect(parseTicketListQuery({ requestedPriority: "HIGH" }).requestedPriority).toBe("HIGH");
    expect(parseTicketListQuery({ requestedPriority: "URGENT" }).requestedPriority).toBeNull();
    expect(parseTicketListQuery({ currentStatus: "NEW" }).currentStatus).toBe("NEW");
    expect(parseTicketListQuery({ currentStatus: "CLOSED" }).currentStatus).toBeNull();
  });

  it("trims the search term", () => {
    expect(parseTicketListQuery({ search: "  battery  " }).search).toBe("battery");
  });
});
