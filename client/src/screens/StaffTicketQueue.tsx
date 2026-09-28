import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Category, getCategories, getStaffTickets, StaffTicketItem } from "../api.js";
import { PriorityBadge, StatusBadge } from "../Badge.js";

type ListState = "loading" | "ready" | "error";
type SortableField = "ticketNumber" | "createdAt" | "itPriority" | "currentStatus";

const PAGE_SIZE = 10;
const DEFAULT_SORT = "-createdAt";

const STATUS_OPTIONS: [string, string][] = [
  ["NEW", "New"],
  ["OPEN", "Open"],
  ["IN_PROGRESS", "In Progress"],
  ["WAITING_FOR_REQUESTER", "Waiting for Requester"],
  ["RESOLVED", "Resolved"],
  ["CLOSED", "Closed"],
  ["REOPENED", "Reopened"],
  ["CANCELLED", "Cancelled"],
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function activateOnKey(handler: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  };
}

// The Owner cell (ui-spec.md section 7): "Unassigned" in muted text rather than an empty cell,
// and an owner who is no longer eligible keeps their name with a marker in words and a badge
// (BR-56, BR-59), so the row is never mistaken for a healthy assignment.
export function OwnerCell({ ticket }: { ticket: StaffTicketItem }) {
  if (ticket.ownerId === null) return <span className="text-muted">Unassigned</span>;
  return (
    <span>
      {ticket.ownerName}
      {ticket.ownerEligible === false && (
        <>
          {" "}
          <span className="text-muted">{ticket.ownerIsActive === false ? "(inactive)" : "(not IT Staff)"}</span>{" "}
          <span className="zg-badge zg-badge-needs-owner">Needs new owner</span>
        </>
      )}
    </span>
  );
}

// Page numbers to show: the first, the last, and a window around the current page.
function pageWindow(page: number, totalPages: number): (number | "gap")[] {
  const shown = new Set([1, totalPages, page - 1, page, page + 1]);
  const pages = [...shown].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

// ui-spec.md section 7: the IT Staff Ticket Queue. Every search, filter, sort and page lives in
// the URL, so "Back to Queue" from a Ticket Detail returns to exactly the view that was left.
export default function StaffTicketQueue() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "";
  const itPriority = params.get("itPriority") ?? "";
  const categoryId = params.get("category") ?? "";
  const owner = params.get("owner") ?? "";
  const sort = params.get("sort") ?? DEFAULT_SORT;
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [categories, setCategories] = useState<Category[]>([]);
  const [listState, setListState] = useState<ListState>("loading");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [items, setItems] = useState<StaffTicketItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  // Rapid changes fire overlapping requests. Without this a slower earlier response could
  // resolve after a newer one and overwrite it with stale rows, a defect found in Lab 2.
  const requestIdRef = useRef(0);

  function load() {
    const requestId = ++requestIdRef.current;
    setListState("loading");
    getStaffTickets({
      search: search || undefined,
      status: status || undefined,
      itPriority: itPriority || undefined,
      category: categoryId ? Number(categoryId) : undefined,
      owner: owner || undefined,
      sort,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setItems(result.tickets);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.totalPages);
        setListState("ready");
        setHasLoadedOnce(true);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        // A failed request must not leave the previous rows on screen looking half successful.
        setItems([]);
        setTotal(0);
        setTotalPages(0);
        setListState("error");
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [search, status, itPriority, categoryId, owner, sort, page]);

  const anyFilterActive = Boolean(search || status || itPriority || categoryId || owner);

  // Every change replaces the history entry: stepping Back should leave the queue, not walk
  // through each keystroke of a search.
  function update(changes: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  }

  function clearFilters() {
    const next = new URLSearchParams();
    if (sort !== DEFAULT_SORT) next.set("sort", sort);
    setParams(next, { replace: true });
  }

  function toggleSort(field: SortableField) {
    update({ sort: sort === field ? `-${field}` : field });
  }

  function ariaSort(field: SortableField): "ascending" | "descending" | "none" {
    if (sort === field) return "ascending";
    if (sort === `-${field}`) return "descending";
    return "none";
  }

  function caret(field: SortableField): string {
    if (sort === field) return " ▲";
    if (sort === `-${field}`) return " ▼";
    return "";
  }

  const open = (ticket: StaffTicketItem) => navigate(`/staff/tickets/${ticket.id}`);
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  const sortableHeader = (field: SortableField, label: string, className = "") => (
    <th
      tabIndex={0}
      className={className || undefined}
      aria-sort={ariaSort(field)}
      onClick={() => toggleSort(field)}
      onKeyDown={activateOnKey(() => toggleSort(field))}
    >
      {label}
      {caret(field)}
    </th>
  );

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <h1 className="h4 mb-0">Ticket Queue</h1>
        {hasLoadedOnce && listState === "ready" && total > 0 && (
          <span className="text-muted small" aria-live="polite">
            Showing {first} to {last} of {total} tickets
          </span>
        )}
      </div>

      {!hasLoadedOnce && listState === "loading" && <p role="status">Loading…</p>}

      {!hasLoadedOnce && listState === "error" && (
        <div className="zg-alert-error rounded p-3" role="alert">
          <p className="mb-2">Unable to load the ticket queue.</p>
          <button type="button" className="btn zg-btn-primary btn-sm" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {hasLoadedOnce && (
        <>
          {/* Mounted for good after the first successful load, including while a request is
              in flight and after a failure, so a filter can always be adjusted or retried. */}
          <div className="row g-2 mb-3" role="search">
            <div className="col-12 col-lg-4">
              <input
                type="search"
                className="form-control"
                aria-label="Search tickets"
                placeholder="Search by ticket number or summary"
                value={search}
                onChange={(e) => update({ search: e.target.value })}
              />
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <select className="form-select" aria-label="Status" value={status} onChange={(e) => update({ status: e.target.value })}>
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <select
                className="form-select"
                aria-label="IT Priority"
                value={itPriority}
                onChange={(e) => update({ itPriority: e.target.value })}
              >
                <option value="">All IT Priorities</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <select className="form-select" aria-label="Category" value={categoryId} onChange={(e) => update({ category: e.target.value })}>
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <select className="form-select" aria-label="Owner" value={owner} onChange={(e) => update({ owner: e.target.value })}>
                <option value="">Anyone</option>
                <option value="unassigned">Unassigned</option>
                <option value="me">Assigned to me</option>
                <option value="needs-owner">Needs an owner</option>
              </select>
            </div>
          </div>
          {anyFilterActive && (
            <div className="mb-3">
              <button type="button" className="btn btn-link p-0" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}

          {listState === "error" && (
            <div className="zg-alert-error rounded p-3" role="alert">
              <p className="mb-2">Unable to load the ticket queue.</p>
              <button type="button" className="btn zg-btn-primary btn-sm" onClick={load}>
                Retry
              </button>
            </div>
          )}

          {listState === "loading" && (
            <p role="status" className="text-muted small mb-2">
              Loading…
            </p>
          )}

          {listState === "ready" && total === 0 && !anyFilterActive && (
            <div className="text-center py-5">
              <p className="text-muted mb-0">No tickets in the queue yet.</p>
            </div>
          )}

          {listState === "ready" && total === 0 && anyFilterActive && (
            <div className="text-center py-5">
              <p className="text-muted">No tickets match these filters.</p>
              <button type="button" className="btn btn-outline-secondary" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}

          {/* Kept on screen while a later request is in flight (aria-busy), so a keyboard user
              who has just sorted with Enter keeps their focus and their place. The rows are
              replaced when the newest response arrives, or cleared if it fails. */}
          {listState !== "error" && total > 0 && (
            <div aria-busy={listState === "loading"}>
              {/* Table from 768px; Category and Req. Priority drop out below 992px, leaving six
                  columns on a tablet. No role="button" on a th: that would replace its
                  columnheader role. tabIndex, a key handler and aria-sort keep it operable. */}
              <div className="d-none d-md-block table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      {sortableHeader("ticketNumber", "Ticket No.")}
                      {sortableHeader("createdAt", "Created Date")}
                      <th>Summary</th>
                      <th className="d-none d-lg-table-cell">Category</th>
                      <th className="d-none d-lg-table-cell">Req. Priority</th>
                      {sortableHeader("itPriority", "IT Priority")}
                      {sortableHeader("currentStatus", "Status")}
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((ticket) => (
                      <tr
                        key={ticket.id}
                        role="button"
                        tabIndex={0}
                        className="zg-clickable-row"
                        onClick={() => open(ticket)}
                        onKeyDown={activateOnKey(() => open(ticket))}
                      >
                        <td>{ticket.ticketNumber}</td>
                        <td>{formatDate(ticket.createdAt)}</td>
                        <td>{ticket.summary}</td>
                        <td className="d-none d-lg-table-cell">{ticket.categoryName}</td>
                        <td className="d-none d-lg-table-cell">
                          <PriorityBadge value={ticket.requestedPriority} />
                        </td>
                        <td>
                          <PriorityBadge value={ticket.itPriority} />
                        </td>
                        <td>
                          <StatusBadge value={ticket.currentStatus} />
                        </td>
                        <td>
                          <OwnerCell ticket={ticket} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Below 768px: a card list. Ticket No. and Status lead, Summary has its own
                  line, then Category, IT Priority and Owner as label-value pairs. */}
              <div className="d-md-none" aria-label="Tickets">
                {items.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="card mb-2 zg-clickable-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => open(ticket)}
                    onKeyDown={activateOnKey(() => open(ticket))}
                  >
                    <div className="card-body">
                      <div className="d-flex justify-content-between align-items-center gap-2">
                        <span className="fw-semibold">{ticket.ticketNumber}</span>
                        <StatusBadge value={ticket.currentStatus} />
                      </div>
                      <div className="fw-semibold my-1">{ticket.summary}</div>
                      <dl className="row small mb-0 g-0">
                        <dt className="col-4 text-muted fw-normal">Category</dt>
                        <dd className="col-8 mb-1">{ticket.categoryName}</dd>
                        <dt className="col-4 text-muted fw-normal">IT Priority</dt>
                        <dd className="col-8 mb-1">
                          <PriorityBadge value={ticket.itPriority} />
                        </dd>
                        <dt className="col-4 text-muted fw-normal">Owner</dt>
                        <dd className="col-8 mb-0">
                          <OwnerCell ticket={ticket} />
                        </dd>
                      </dl>
                    </div>
                  </div>
                ))}
              </div>

              <nav aria-label="Pagination" className="d-flex justify-content-center mt-3">
                <ul className="pagination mb-0 flex-wrap">
                  <li className={`page-item${page <= 1 ? " disabled" : ""}`}>
                    <button type="button" className="page-link zg-touch-target" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
                      Previous
                    </button>
                  </li>
                  {pageWindow(page, totalPages).map((entry, i) =>
                    entry === "gap" ? (
                      <li key={`gap-${i}`} className="page-item disabled" aria-hidden="true">
                        <span className="page-link">…</span>
                      </li>
                    ) : (
                      <li key={entry} className={`page-item${entry === page ? " active" : ""}`}>
                        <button
                          type="button"
                          className="page-link zg-touch-target"
                          aria-label={`Page ${entry}`}
                          aria-current={entry === page ? "page" : undefined}
                          onClick={() => update({ page: String(entry) }, false)}
                        >
                          {entry}
                        </button>
                      </li>
                    ),
                  )}
                  <li className={`page-item${page >= totalPages ? " disabled" : ""}`}>
                    <button type="button" className="page-link zg-touch-target" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) }, false)}>
                      Next
                    </button>
                  </li>
                </ul>
              </nav>
            </div>
          )}
        </>
      )}
    </div>
  );
}
