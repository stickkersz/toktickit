import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useRequester } from "./requesterContext.js";

// Application shell: nav (My Tickets/Create Ticket, ui-spec.md §4) +
// current-Requester display + Change Requester (FR-09).
//
// ui-spec.md §10 requires the nav to collapse to a menu below 768px. This uses
// Bootstrap's navbar-expand-md classes, which handle the breakpoint in pure
// CSS, but drives the `show` state from React instead of pulling in Bootstrap's
// JS bundle: the rest of this app has no Bootstrap JS dependency and adding one
// just for a toggle is not worth it.
export default function Shell() {
  const { requester, clearRequester } = useRequester();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // My Tickets owns the list *and* the Ticket Detail screen reached from it, so
  // it stays the active section on /tickets/:id. NavLink's `end` alone can't
  // express this: without it /tickets also matches /tickets/new, and with it
  // nothing is active on /tickets/:id, leaving the nav with no current page.
  const myTicketsActive = pathname === "/tickets" || /^\/tickets\/\d+$/.test(pathname);

  function handleChangeRequester() {
    setMenuOpen(false);
    clearRequester();
    navigate("/select-requester");
  }

  function navLinkClass({ isActive }: { isActive: boolean }) {
    // zg-nav-link keeps the >=44px touch target on mobile (ui-spec.md §10).
    return `nav-link zg-nav-link text-white${isActive ? " fw-semibold border-bottom border-2" : ""}`;
  }

  return (
    <div>
      <nav className="navbar navbar-expand-md zg-header px-3 py-0" aria-label="Main">
        <div className="container-fluid px-0">
          <span className="navbar-brand text-white fw-semibold mb-0">TokTickIT</span>

          <button
            type="button"
            className="navbar-toggler zg-navbar-toggler border-light"
            aria-controls="main-nav"
            aria-expanded={menuOpen}
            aria-label="Toggle navigation"
            title="Toggle navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="navbar-toggler-icon" />
          </button>

          <div className={`collapse navbar-collapse${menuOpen ? " show" : ""}`} id="main-nav">
            <div className="navbar-nav me-auto ms-md-4">
              {/* Plain Link + explicit aria-current (§11) so the active section
                  follows myTicketsActive rather than NavLink's path matching. */}
              <Link
                to="/tickets"
                className={navLinkClass({ isActive: myTicketsActive })}
                aria-current={myTicketsActive ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                My Tickets
              </Link>
              <NavLink to="/tickets/new" className={navLinkClass} onClick={() => setMenuOpen(false)}>
                Create Ticket
              </NavLink>
            </div>

            <div className="d-flex flex-column flex-md-row align-items-md-center gap-2 gap-md-3 py-2 py-md-0">
              <span className="text-white">{requester?.name}</span>
              <button
                type="button"
                className="btn btn-sm btn-outline-light zg-touch-target"
                onClick={handleChangeRequester}
              >
                Change Requester
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="container py-4">
        <Outlet />
      </main>
    </div>
  );
}
