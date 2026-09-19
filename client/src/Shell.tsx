import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { RoleBadge } from "./Badge.js";
import { useAuth } from "./authContext.js";
import type { UserRole } from "./api.js";

interface NavItem {
  label: string;
  to: string;
  // The routes on which this item is the current section. A Ticket Detail route
  // keeps its parent list active, so the nav never has no current page.
  isActive: (pathname: string) => boolean;
}

const MY_TICKETS: NavItem = {
  label: "My Tickets",
  to: "/tickets",
  isActive: (p) => p === "/tickets" || /^\/tickets\/\d+$/.test(p),
};
const CREATE_TICKET: NavItem = { label: "Create Ticket", to: "/tickets/new", isActive: (p) => p === "/tickets/new" };
const TICKET_QUEUE: NavItem = {
  label: "Ticket Queue",
  to: "/staff/tickets",
  isActive: (p) => p === "/staff/tickets" || /^\/staff\/tickets\/\d+$/.test(p),
};
const USERS: NavItem = { label: "Users", to: "/admin/users", isActive: (p) => p === "/admin/users" };

// ui-spec.md section 3: navigation is role specific, and a destination the role may
// not use is never rendered (AC-11, FR-05).
export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  REQUESTER: [MY_TICKETS, CREATE_TICKET],
  IT_STAFF: [TICKET_QUEUE],
  ADMINISTRATOR: [TICKET_QUEUE, USERS],
};

// Application shell: role navigation, the signed-in user's name and role, a way to
// change their password, and Logout.
//
// The nav collapses to a menu below 768px (ui-spec.md section 10). This uses
// Bootstrap's navbar-expand-md classes, which handle the breakpoint in pure CSS, but
// drives the `show` state from React instead of pulling in Bootstrap's JS bundle:
// the rest of this app has no Bootstrap JS dependency and adding one just for a
// toggle is not worth it. Identity and Logout sit inside that panel on mobile.
export default function Shell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // The gates above this component guarantee a user; nothing role specific renders
  // without one, so the wrong menu can never flash.
  if (!user) return null;
  const items = NAV_BY_ROLE[user.role];

  async function handleLogout() {
    setMenuOpen(false);
    await signOut();
    // replace: the signed-out page must not sit behind a Back button that leads
    // into the application.
    navigate("/login", { replace: true });
  }

  function navLinkClass(active: boolean) {
    // zg-nav-link keeps the >=44px touch target on mobile (ui-spec.md section 10).
    return `nav-link zg-nav-link text-white${active ? " fw-semibold border-bottom border-2" : ""}`;
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
              {items.map((item) => {
                const active = item.isActive(pathname);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={navLinkClass(active)}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="d-flex flex-column flex-md-row align-items-md-center gap-2 gap-md-3 py-2 py-md-0">
              <span className="text-white d-flex align-items-center gap-2">
                {user.name} <RoleBadge role={user.role} />
              </span>
              <Link
                to="/change-password"
                className="btn btn-sm btn-outline-light zg-touch-target"
                onClick={() => setMenuOpen(false)}
              >
                Change password
              </Link>
              <button type="button" className="btn btn-sm btn-outline-light zg-touch-target" onClick={() => void handleLogout()}>
                Logout
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
