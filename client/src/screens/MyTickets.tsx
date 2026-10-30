import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Category, getCategories, getTickets, TicketListItem, TicketPriority } from "../api.js";
import { useAuth } from "../authContext.js";
import { PriorityBadge, STATUS_OPTIONS, StatusBadge } from "../Badge.js";
import { FilterChip, STATUS_GROUP_LABEL, parseStatusGroup } from "../dashboard.js";

type ListState = "loading" | "ready" | "error";
type SortableField = "createdAt" | "ticketNumber" | "summary" | "updatedAt";

const PAGE_SIZE = 10;
const DEFAULT_SORT = "-createdAt";
// Below 768px the table and its sortable headers give way to cards, so the same sorts are a select there.
const SORT_OPTIONS: [string, string][] = [
  ["-createdAt", "Newest first"],
  ["createdAt", "Oldest first"],
  ["-updatedAt", "Last updated, newest first"],
  ["updatedAt", "Last updated, oldest first"],
  ["ticketNumber", "Ticket No., ascending"],
  ["-ticketNumber", "Ticket No., descending"],
  ["summary", "Summary, A to Z"],
  ["-summary", "Summary, Z to A"],
];
// The server's window range (api-spec section 11); anything else is no window.
const windowDays = (raw: string | null) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : undefined;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export default function MyTickets() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Lab 4 ui-spec section 6: every filter, sort and page lives in the URL, so a dashboard card opens My
  // Tickets already filtered. The route uses `status`; the API keeps its Lab 2 name `currentStatus`.
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const categoryId = params.get("category") ?? "";
  const requestedPriority = (params.get("requestedPriority") ?? "") as TicketPriority | "";
  const currentStatus = params.get("status") ?? "";
  const statusGroup = parseStatusGroup(params.get("statusGroup"));
  const updatedWithinDays = windowDays(params.get("updatedWithinDays"));
  const resolvedWithinDays = windowDays(params.get("resolvedWithinDays"));
  const sort = params.get("sort") ?? DEFAULT_SORT;
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [categories, setCategories] = useState<Category[]>([]);

  const [listState, setListState] = useState<ListState>("loading");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [items, setItems] = useState<TicketListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  // Guards against out-of-order responses: rapid filter/search changes fire
  // overlapping requests, and without this a slower earlier request could
  // resolve after a newer one and overwrite it with stale results.
  const requestIdRef = useRef(0);

  function load() {
    if (!user) return;
    const requestId = ++requestIdRef.current;
    setListState("loading");
    getTickets({
      search: search || undefined,
      category: categoryId ? Number(categoryId) : undefined,
      requestedPriority: requestedPriority || undefined,
      currentStatus: currentStatus || undefined,
      statusGroup,
      updatedWithinDays,
      resolvedWithinDays,
      sort,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setItems(result.data);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.totalPages);
        setListState("ready");
        setHasLoadedOnce(true);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        // Never leave a previous request's rows on screen next to a failure:
        // a failed search/filter/page request must not look like it partly
        // succeeded.
        setItems([]);
        setTotal(0);
        setTotalPages(0);
        setListState("error");
      });
  }

  function handleActivateKey(handler: () => void) {
    return (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    };
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [user?.id, search, categoryId, requestedPriority, currentStatus, statusGroup, updatedWithinDays, resolvedWithinDays, sort, page]);

  const anyFilterActive = Boolean(search || categoryId || requestedPriority || currentStatus || statusGroup || updatedWithinDays || resolvedWithinDays);

  // Every change replaces the history entry and returns to page 1, as on the queue.
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

  function sortIndicator(field: SortableField) {
    if (sort === field) return " ▲";
    if (sort === `-${field}`) return " ▼";
    return "";
  }

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <div>
          <h1 className="h4 mb-0">My Tickets</h1>
        </div>
        <div className="d-flex gap-2">
          {anyFilterActive && (
            <button type="button" className="btn btn-link" onClick={clearFilters}>
              Clear Filters
            </button>
          )}
          <button type="button" className="btn zg-btn-primary" onClick={() => navigate("/tickets/new")}>
            + Create Ticket
          </button>
        </div>
      </div>

      {!hasLoadedOnce && listState === "loading" && <p>Loading…</p>}

      {!hasLoadedOnce && listState === "error" && (
        <div className="zg-alert-error rounded p-3" role="alert">
          <p className="mb-2">Unable to load your tickets.</p>
          <button type="button" className="btn zg-btn-primary btn-sm" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {hasLoadedOnce && (
        <>
          {/* Hidden only for the one confirmed, genuinely-empty, no-filter
              case (AC-21); visible for every other state including a
              failed request, so the user is never stuck without a way to
              adjust filters or retry. */}
          {!(listState === "ready" && total === 0 && !anyFilterActive) && (
            <div className="row g-2 mb-3">
              <div className="col-md-4">
                <input
                  type="search"
                  className="form-control"
                  placeholder="Search by ticket number or summary…"
                  value={search}
                  onChange={(e) => update({ search: e.target.value })}
                />
              </div>
              <div className="col-md-3">
                <select
                  className="form-select"
                  value={categoryId}
                  onChange={(e) => update({ category: e.target.value })}
                >
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <select
                  className="form-select"
                  value={requestedPriority}
                  onChange={(e) => update({ requestedPriority: e.target.value })}
                >
                  <option value="">All Priorities</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
              </div>
              <div className="col-md-3">
                <select
                  className="form-select"
                  aria-label="Status"
                  value={currentStatus || (statusGroup ? `group:${statusGroup}` : "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    // A group and a single status are alternatives; choosing one clears the other.
                    if (v.startsWith("group:")) update({ statusGroup: v.slice(6), status: "" });
                    else update({ status: v, statusGroup: "" });
                  }}
                >
                  <option value="">All Statuses</option>
                  <option value="group:active">Active</option>
                  <option value="group:resolved">Resolved or closed</option>
                  {STATUS_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12 d-md-none">
                <select className="form-select" aria-label="Sort by" value={sort} onChange={(e) => update({ sort: e.target.value })}>
                  {SORT_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      Sort: {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {(updatedWithinDays || resolvedWithinDays || (statusGroup && !currentStatus)) && (
            <div className="d-flex flex-wrap gap-2 mb-3">
              {statusGroup && !currentStatus && <FilterChip label={STATUS_GROUP_LABEL[statusGroup]} onRemove={() => update({ statusGroup: "" })} />}
              {updatedWithinDays && <FilterChip label={`Updated in the last ${updatedWithinDays} days`} onRemove={() => update({ updatedWithinDays: "" })} />}
              {resolvedWithinDays && <FilterChip label={`Resolved in the last ${resolvedWithinDays} days`} onRemove={() => update({ resolvedWithinDays: "" })} />}
            </div>
          )}

          {listState === "error" && (
            <div className="zg-alert-error rounded p-3" role="alert">
              <p className="mb-2">Unable to load your tickets.</p>
              <button type="button" className="btn zg-btn-primary btn-sm" onClick={load}>
                Retry
              </button>
            </div>
          )}

          {listState !== "error" && total === 0 && !anyFilterActive && (
            <div className="text-center py-5">
              <p className="text-muted">You haven't submitted any tickets yet.</p>
              <button
                type="button"
                className="btn zg-btn-primary"
                onClick={() => navigate("/tickets/new")}
              >
                Create Ticket
              </button>
            </div>
          )}

          {listState !== "error" && total === 0 && anyFilterActive && (
            <div className="text-center py-5">
              <p className="text-muted">No tickets match your filters or search.</p>
              <button type="button" className="btn btn-outline-secondary" onClick={clearFilters}>
                Clear Filters
              </button>
            </div>
          )}

          {listState !== "error" && total > 0 && (
            <>
              {/* Desktop (>=992px) and tablet (768-991px): a table, with
                  Created Date/Category hidden below the lg breakpoint per
                  ui-spec.md §7's tablet 5-column layout. Hidden below 768px
                  in favor of the card list. */}
              <div className="d-none d-md-block table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      {/* No role="button" here: a <th> already has an
                          implicit columnheader role that assistive tech
                          relies on for table navigation, and setting an
                          explicit role would replace it, not add to it.
                          tabIndex + onKeyDown + aria-sort are enough to make
                          these keyboard-operable without losing that. */}
                      <th
                        tabIndex={0}
                        aria-sort={
                          sort === "ticketNumber"
                            ? "ascending"
                            : sort === "-ticketNumber"
                              ? "descending"
                              : "none"
                        }
                        onClick={() => toggleSort("ticketNumber")}
                        onKeyDown={handleActivateKey(() => toggleSort("ticketNumber"))}
                      >
                        Ticket No.{sortIndicator("ticketNumber")}
                      </th>
                      <th
                        tabIndex={0}
                        className="d-none d-lg-table-cell"
                        aria-sort={
                          sort === "createdAt"
                            ? "ascending"
                            : sort === "-createdAt"
                              ? "descending"
                              : "none"
                        }
                        onClick={() => toggleSort("createdAt")}
                        onKeyDown={handleActivateKey(() => toggleSort("createdAt"))}
                      >
                        Created Date{sortIndicator("createdAt")}
                      </th>
                      <th
                        tabIndex={0}
                        aria-sort={
                          sort === "summary" ? "ascending" : sort === "-summary" ? "descending" : "none"
                        }
                        onClick={() => toggleSort("summary")}
                        onKeyDown={handleActivateKey(() => toggleSort("summary"))}
                      >
                        Summary{sortIndicator("summary")}
                      </th>
                      <th className="d-none d-lg-table-cell">Category</th>
                      <th>Requested Priority</th>
                      <th>Current Status</th>
                      <th
                        tabIndex={0}
                        aria-sort={sort === "updatedAt" ? "ascending" : sort === "-updatedAt" ? "descending" : "none"}
                        onClick={() => toggleSort("updatedAt")}
                        onKeyDown={handleActivateKey(() => toggleSort("updatedAt"))}
                      >
                        Last Updated{sortIndicator("updatedAt")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((ticket) => (
                      <tr
                        key={ticket.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                        onKeyDown={handleActivateKey(() => navigate(`/tickets/${ticket.id}`))}
                      >
                        <td>{ticket.ticketNumber}</td>
                        <td className="d-none d-lg-table-cell">{formatDate(ticket.createdAt)}</td>
                        <td>{ticket.summary}</td>
                        <td className="d-none d-lg-table-cell">{ticket.categoryName}</td>
                        <td>
                          <PriorityBadge value={ticket.requestedPriority} />
                        </td>
                        <td>
                          <StatusBadge value={ticket.currentStatus} />
                        </td>
                        <td>{formatDate(ticket.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile (<768px): card list, ui-spec.md §7. */}
              <div className="d-md-none" aria-label="Tickets">
                {items.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="card mb-2"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/tickets/${ticket.id}`)}
                    onKeyDown={handleActivateKey(() => navigate(`/tickets/${ticket.id}`))}
                  >
                    <div className="card-body">
                      <div className="d-flex justify-content-between">
                        <span className="fw-semibold">{ticket.ticketNumber}</span>
                        <span className="text-muted small">{formatDate(ticket.createdAt)}</span>
                      </div>
                      <div className="fw-semibold">{ticket.summary}</div>
                      <div className="d-flex gap-2 mt-1">
                        <PriorityBadge value={ticket.requestedPriority} />
                        <StatusBadge value={ticket.currentStatus} />
                      </div>
                      <div className="text-muted small mt-1">
                        Updated {formatDate(ticket.updatedAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="d-flex justify-content-between align-items-center mt-3">
                <span className="text-muted small">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}{" "}
                  tickets
                </span>
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={page <= 1}
                    onClick={() => update({ page: String(page - 1) }, false)}
                  >
                    Previous
                  </button>
                  <span className="small align-self-center">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={page >= totalPages}
                    onClick={() => update({ page: String(page + 1) }, false)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
