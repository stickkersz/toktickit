import { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./authContext.js";
import { RequesterProvider, useRequester } from "./requesterContext.js";
import { landingPathFor } from "./roles.js";
import type { UserRole } from "./api.js";
import RequesterSelection from "./RequesterSelection.js";
import Shell from "./Shell.js";
import MyTickets from "./screens/MyTickets.js";
import CreateTicket from "./screens/CreateTicket.js";
import TicketDetail from "./screens/TicketDetail.js";
import Login from "./screens/Login.js";
import ChangePassword from "./screens/ChangePassword.js";
import RoleLanding from "./screens/RoleLanding.js";
import Forbidden from "./screens/Forbidden.js";

// BR-07/AC-02: no ticket screen renders without a current Requester. While
// the stored id is still being revalidated against active Requesters
// (BR-05), render nothing rather than redirecting prematurely.
//
// Lab 3 (BR-63): these are Requester screens. A signed-in IT Staff member or
// Administrator gets the forbidden state before anything else is decided, so the
// screen never renders and none of its data is requested.
function RequireRequester({ children }: { children: ReactNode }) {
  const { requester, status } = useRequester();
  const { user } = useAuth();
  if (status === "checking") return <p className="container py-4">Loading…</p>;
  if (user && user.role !== "REQUESTER") {
    return <Forbidden message="You do not have access to Requester tickets." />;
  }
  if (!requester) return <Navigate to="/select-requester" replace />;
  return children;
}

// Lab 3 (FR-02, BR-02): a user who still holds an initial password can reach no
// route except Change Password. Nothing renders until the identity request has
// answered, so neither a menu nor a redirect flashes first (ui-spec section 3).
function RequirePasswordChange({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const { pathname } = useLocation();
  // The Lab 2 selector is exempt from the wait: it is a development screen that
  // Issue 04 deletes, and it has its own loading state.
  if (status === "checking" && pathname !== "/select-requester") {
    return <p className="container py-4" role="status">Loading…</p>;
  }
  if (user?.mustChangePassword && pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

// Routes that need a signed-in user of any role.
function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Routes restricted to particular roles (BR-14, BR-16, BR-63). No session goes to
// Login; a session whose role is not permitted gets the forbidden state, so a
// direct URL cannot reach a screen the navigation would never have offered. This
// is presentation only: the server enforces the same rule on every endpoint.
function RequireRole({ roles, message, children }: { roles: UserRole[]; message: string; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Forbidden message={message} />;
  return children;
}

// An unknown URL goes to the signed-in user's own home, and only signed-out
// visitors fall through to the Lab 2 Requester flow.
function FallbackRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? landingPathFor(user.role) : "/tickets"} replace />;
}

// The Development Requester selector is a Lab 2 testing mechanism that Issue 04
// removes. A signed-in user has no use for it, so send them to their landing route.
function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user && !user.mustChangePassword) return <Navigate to={landingPathFor(user.role)} replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <RequesterProvider>
        <RequirePasswordChange>
          <AppRoutes />
        </RequirePasswordChange>
      </RequesterProvider>
    </AuthProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/change-password"
        element={
          <RequireAuth>
            <ChangePassword />
          </RequireAuth>
        }
      />
      <Route
        path="/staff/tickets"
        element={
          <RequireRole roles={["IT_STAFF", "ADMINISTRATOR"]} message="You do not have access to the Ticket Queue.">
            <RoleLanding destination="IT Staff Ticket Queue" />
          </RequireRole>
        }
      />
      <Route
        path="/admin/users"
        element={
          <RequireRole roles={["ADMINISTRATOR"]} message="You do not have access to User Management.">
            <RoleLanding destination="Administrator User Management" />
          </RequireRole>
        }
      />
      <Route
        path="/select-requester"
        element={
          <RedirectIfSignedIn>
            <RequesterSelection />
          </RedirectIfSignedIn>
        }
      />
      <Route
        element={
          <RequireRequester>
            <Shell />
          </RequireRequester>
        }
      >
        <Route path="/tickets" element={<MyTickets />} />
        <Route path="/tickets/new" element={<CreateTicket />} />
        <Route path="/tickets/:id" element={<TicketDetail />} />
      </Route>
      <Route path="*" element={<FallbackRedirect />} />
    </Routes>
  );
}
