export type TicketSortKey =
  | "createdAt"
  | "-createdAt"
  | "ticketNumber"
  | "-ticketNumber"
  | "summary"
  | "-summary";

const SORT_FIELDS: Record<
  TicketSortKey,
  { field: "createdAt" | "ticketNumber" | "summary"; direction: "asc" | "desc" }
> = {
  createdAt: { field: "createdAt", direction: "asc" },
  "-createdAt": { field: "createdAt", direction: "desc" },
  ticketNumber: { field: "ticketNumber", direction: "asc" },
  "-ticketNumber": { field: "ticketNumber", direction: "desc" },
  summary: { field: "summary", direction: "asc" },
  "-summary": { field: "summary", direction: "desc" },
};

export interface ParsedTicketListQuery {
  search: string;
  categoryId: number | null;
  requestedPriority: "LOW" | "MEDIUM" | "HIGH" | null;
  currentStatus: "NEW" | null;
  sortField: "createdAt" | "ticketNumber" | "summary";
  sortDirection: "asc" | "desc";
  page: number;
  pageSize: number;
}

// FR-04/BR-20..23: unrecognized sort/page/pageSize fall back to the default
// rather than erroring; category/priority/status are plain optional filters.
export function parseTicketListQuery(query: Record<string, unknown>): ParsedTicketListQuery {
  const search = typeof query.search === "string" ? query.search.trim() : "";

  const categoryIdRaw = Number(query.category);
  const categoryId = Number.isInteger(categoryIdRaw) && categoryIdRaw > 0 ? categoryIdRaw : null;

  const requestedPriority = (["LOW", "MEDIUM", "HIGH"] as const).includes(
    query.requestedPriority as "LOW" | "MEDIUM" | "HIGH",
  )
    ? (query.requestedPriority as "LOW" | "MEDIUM" | "HIGH")
    : null;

  const currentStatus = query.currentStatus === "NEW" ? "NEW" : null;

  const sortKey =
    typeof query.sort === "string" && query.sort in SORT_FIELDS
      ? (query.sort as TicketSortKey)
      : "-createdAt";
  const { field: sortField, direction: sortDirection } = SORT_FIELDS[sortKey];

  let page = Number(query.page);
  if (!Number.isInteger(page) || page < 1) page = 1;

  let pageSize = Number(query.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 5 || pageSize > 50) pageSize = 10;

  return { search, categoryId, requestedPriority, currentStatus, sortField, sortDirection, page, pageSize };
}
