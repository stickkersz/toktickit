import { TicketStatus } from "@prisma/client";
import { isValidId } from "./ids.js";
import { type StatusGroup, parseStatusGroup } from "./staffQueueQuery.js";

export type TicketSortKey =
  | "createdAt"
  | "-createdAt"
  | "ticketNumber"
  | "-ticketNumber"
  | "summary"
  | "-summary"
  | "updatedAt"
  | "-updatedAt";

const SORT_FIELDS: Record<
  TicketSortKey,
  { field: "createdAt" | "ticketNumber" | "summary" | "updatedAt"; direction: "asc" | "desc" }
> = {
  createdAt: { field: "createdAt", direction: "asc" },
  "-createdAt": { field: "createdAt", direction: "desc" },
  ticketNumber: { field: "ticketNumber", direction: "asc" },
  "-ticketNumber": { field: "ticketNumber", direction: "desc" },
  summary: { field: "summary", direction: "asc" },
  "-summary": { field: "summary", direction: "desc" },
  // Lab 4 api-spec section 11: by last activity, for the dashboard's drill-downs.
  updatedAt: { field: "updatedAt", direction: "asc" },
  "-updatedAt": { field: "updatedAt", direction: "desc" },
};

export interface ParsedTicketListQuery {
  search: string;
  categoryId: number | null;
  requestedPriority: "LOW" | "MEDIUM" | "HIGH" | null;
  currentStatus: TicketStatus | null;
  statusGroup: StatusGroup | null;
  updatedWithinDays: number | null;
  resolvedWithinDays: number | null;
  sortField: "createdAt" | "ticketNumber" | "summary" | "updatedAt";
  sortDirection: "asc" | "desc";
  page: number;
  pageSize: number;
}

// FR-04/BR-20..23: unrecognized sort/page/pageSize fall back to the default
// rather than erroring; category/priority/status are plain optional filters.
export function parseTicketListQuery(query: Record<string, unknown>): ParsedTicketListQuery {
  const search = typeof query.search === "string" ? query.search.trim() : "";

  const categoryIdRaw = Number(query.category);
  const categoryId = isValidId(categoryIdRaw) ? categoryIdRaw : null;

  const requestedPriority = (["LOW", "MEDIUM", "HIGH"] as const).includes(
    query.requestedPriority as "LOW" | "MEDIUM" | "HIGH",
  )
    ? (query.requestedPriority as "LOW" | "MEDIUM" | "HIGH")
    : null;

  // Lab 4 api-spec section 11: any of the eight statuses (Lab 2 accepted New only), a status group, and the
  // BR-29 windows of 1 to 90 days. A single status wins over a group; anything else falls back to none.
  const currentStatus = typeof query.currentStatus === "string" && (Object.values(TicketStatus) as string[]).includes(query.currentStatus) ? (query.currentStatus as TicketStatus) : null;
  const statusGroup = currentStatus === null ? parseStatusGroup(query.statusGroup) : null;
  const windowDays = (raw: unknown) => {
    const n = Number(raw);
    return isValidId(n) && n <= 90 ? n : null;
  };
  const updatedWithinDays = windowDays(query.updatedWithinDays);
  const resolvedWithinDays = windowDays(query.resolvedWithinDays);

  const sortKey =
    typeof query.sort === "string" && query.sort in SORT_FIELDS
      ? (query.sort as TicketSortKey)
      : "-createdAt";
  const { field: sortField, direction: sortDirection } = SORT_FIELDS[sortKey];

  let page = Number(query.page);
  if (!isValidId(page)) page = 1;

  let pageSize = Number(query.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 5 || pageSize > 50) pageSize = 10;

  return { search, categoryId, requestedPriority, currentStatus, statusGroup, updatedWithinDays, resolvedWithinDays, sortField, sortDirection, page, pageSize };
}
