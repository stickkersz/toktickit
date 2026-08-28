import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useRequester } from "./requesterContext.js";

// Application shell: nav (My Tickets/Create Ticket, ui-spec.md §4) +
// current-Requester display + Change Requester (FR-09). Mobile hamburger
// collapse is part of the later responsive/visual pass.
export default function Shell() {
  const { requester, clearRequester } = useRequester();
  const navigate = useNavigate();

  function handleChangeRequester() {
    clearRequester();
    navigate("/select-requester");
  }

  function navLinkClass({ isActive }: { isActive: boolean }) {
    return `nav-link text-white${isActive ? " fw-semibold border-bottom border-2" : ""}`;
  }

  return (
    <div>
      <header className="zg-header d-flex justify-content-between align-items-center text-white px-3">
        <div className="d-flex align-items-center gap-4">
          <span className="fw-semibold">TokTickIT</span>
          <nav className="d-flex gap-3" aria-label="Main">
            <NavLink to="/tickets" end className={navLinkClass}>
              My Tickets
            </NavLink>
            <NavLink to="/tickets/new" className={navLinkClass}>
              Create Ticket
            </NavLink>
          </nav>
        </div>
        <div className="d-flex align-items-center gap-3">
          <span>{requester?.name}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline-light"
            onClick={handleChangeRequester}
          >
            Change Requester
          </button>
        </div>
      </header>
      <main className="container py-4">
        <Outlet />
      </main>
    </div>
  );
}
