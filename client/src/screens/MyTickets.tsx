import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Category, getCategories, getTickets, TicketListItem, TicketPriority } from "../api.js";
import { useRequester } from "../requesterContext.js";
import { PriorityBadge, StatusBadge } from "../Badge.js";

type ListState = "loading" | "ready" | "error";
type SortableField = "createdAt" | "ticketNumber" | "summary";

const PAGE_SIZE = 10;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export default function MyTickets() {
  const { requester } = useRequester();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [requestedPriority, setRequestedPriority] = useState<TicketPriority | "">("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [sort, setSort] = useState("-createdAt");
  const [page, setPage] = useState(1);

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
    if (!requester) return;
    const requestId = ++requestIdRef.current;
    setListState("loading");
    getTickets({
      requesterId: requester.id,
      search: search || undefined,
      category: categoryId ? Number(categoryId) : undefined,
      requestedPriority: requestedPriority || undefined,
      currentStatus: currentStatus || undefined,
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
        setListState("error");
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [requester, search, categoryId, requestedPriority, currentStatus, sort, page]);

  const anyFilterActive = Boolean(search || categoryId || requestedPriority || currentStatus);

  function resetToFirstPage() {
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setCategoryId("");
    setRequestedPriority("");
    setCurrentStatus("");
    setPage(1);
  }

  function toggleSort(field: SortableField) {
    setSort((prev) => (prev === field ? `-${field}` : field));
    setPage(1);
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

      {hasLoadedOnce && total === 0 && !anyFilterActive && (
        <div className="text-center py-5">
          <p className="text-muted">You haven't submitted any tickets yet.</p>
          <button type="button" className="btn zg-btn-primary" onClick={() => navigate("/tickets/new")}>
            Create Ticket
          </button>
        </div>
      )}

      {hasLoadedOnce && (total > 0 || anyFilterActive) && (
        <>
          <div className="row g-2 mb-3">
            <div className="col-md-4">
              <input
                type="search"
                className="form-control"
                placeholder="Search by ticket number or summary…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetToFirstPage();
                }}
              />
            </div>
            <div className="col-md-3">
              <select
                className="form-select"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  resetToFirstPage();
                }}
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
                onChange={(e) => {
                  setRequestedPriority(e.target.value as TicketPriority | "");
                  resetToFirstPage();
                }}
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
                value={currentStatus}
                onChange={(e) => {
                  setCurrentStatus(e.target.value);
                  resetToFirstPage();
                }}
              >
                <option value="">All Statuses</option>
                <option value="NEW">New</option>
              </select>
            </div>
          </div>

          {total === 0 && anyFilterActive && (
            <div className="text-center py-5">
              <p className="text-muted">No tickets match your filters or search.</p>
              <button type="button" className="btn btn-outline-secondary" onClick={clearFilters}>
                Clear Filters
              </button>
            </div>
          )}

          {total > 0 && (
            <>
              <div className="table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th role="button" onClick={() => toggleSort("ticketNumber")}>
                        Ticket No.{sortIndicator("ticketNumber")}
                      </th>
                      <th role="button" onClick={() => toggleSort("createdAt")}>
                        Created Date{sortIndicator("createdAt")}
                      </th>
                      <th role="button" onClick={() => toggleSort("summary")}>
                        Summary{sortIndicator("summary")}
                      </th>
                      <th>Category</th>
                      <th>Requested Priority</th>
                      <th>Current Status</th>
                      <th>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((ticket) => (
                      <tr
                        key={ticket.id}
                        role="button"
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                      >
                        <td>{ticket.ticketNumber}</td>
                        <td>{formatDate(ticket.createdAt)}</td>
                        <td>{ticket.summary}</td>
                        <td>{ticket.categoryName}</td>
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
                    onClick={() => setPage((p) => p - 1)}
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
                    onClick={() => setPage((p) => p + 1)}
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
