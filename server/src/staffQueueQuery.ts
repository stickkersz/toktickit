import { TicketStatus } from "@prisma/client";
import { isValidId } from "./ids.js";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
type Priority = (typeof PRIORITIES)[number];

const SORT_FIELDS = ["createdAt", "updatedAt", "ticketNumber", "itPriority", "currentStatus"] as const;
export type StaffSortField = (typeof SORT_FIELDS)[number];

// `owner` is a User id, or one of three words (api-spec.md endpoint 7, BR-59).
export type OwnerFilter =
  | { kind: "id"; id: number }
  | { kind: "unassigned" }
  | { kind: "me" }
  | { kind: "needs-owner" };

// Lab 4 api-spec section 11: `active` is not Resolved, Closed, or Cancelled; `resolved` is Resolved or Closed.
export type StatusGroup = "active" | "resolved";
export const parseStatusGroup = (value: unknown): StatusGroup | null => (value === "active" || value === "resolved" ? value : null);

export interface ParsedStaffQueueQuery {
  search: string;
  status: TicketStatus | null;
  statusGroup: StatusGroup | null;
  itPriority: Priority | null;
  categoryId: number | null;
  owner: OwnerFilter | null;
  sortField: StaffSortField;
  sortDirection: "asc" | "desc";
  page: number;
  pageSize: number;
}

const STATUSES = Object.values(TicketStatus) as string[];

// Following L2-BR-23, an unrecognised or out-of-range value falls back to its
// default rather than returning an error, so a stale bookmark degrades to a sane
// queue instead of a failure. Nothing here throws, whatever it is given.
export function parseStaffQueueQuery(query: Record<string, unknown>): ParsedStaffQueueQuery {
  const search = typeof query.search === "string" ? query.search.trim() : "";

  const status = typeof query.status === "string" && STATUSES.includes(query.status) ? (query.status as TicketStatus) : null;

  const itPriority =
    typeof query.itPriority === "string" && (PRIORITIES as readonly string[]).includes(query.itPriority)
      ? (query.itPriority as Priority)
      : null;

  const categoryRaw = typeof query.category === "string" ? Number(query.category) : NaN;
  const categoryId = isValidId(categoryRaw) ? categoryRaw : null;

  let owner: OwnerFilter | null = null;
  if (typeof query.owner === "string") {
    if (query.owner === "unassigned" || query.owner === "me" || query.owner === "needs-owner") {
      owner = { kind: query.owner };
    } else if (/^[1-9]\d*$/.test(query.owner)) {
      const id = Number(query.owner);
      if (isValidId(id)) owner = { kind: "id", id };
    }
  }

  // "-field" is descending. The default is newest first.
  let sortField: StaffSortField = "createdAt";
  let sortDirection: "asc" | "desc" = "desc";
  if (typeof query.sort === "string") {
    const descending = query.sort.startsWith("-");
    const field = descending ? query.sort.slice(1) : query.sort;
    if ((SORT_FIELDS as readonly string[]).includes(field)) {
      sortField = field as StaffSortField;
      sortDirection = descending ? "desc" : "asc";
    }
  }

  let page = typeof query.page === "string" ? Number(query.page) : NaN;
  if (!isValidId(page)) page = 1;

  let pageSize = typeof query.pageSize === "string" ? Number(query.pageSize) : NaN;
  if (!Number.isInteger(pageSize) || pageSize < 5 || pageSize > 50) pageSize = 10;

  // A single status wins over a group (api-spec section 11).
  const statusGroup = status === null ? parseStatusGroup(query.statusGroup) : null;

  return { search, status, statusGroup, itPriority, categoryId, owner, sortField, sortDirection, page, pageSize };
}
