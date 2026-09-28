import { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./authContext.js";
import { landingPathFor } from "./roles.js";
import type { UserRole } from "./api.js";
import Shell from "./Shell.js";
import MyTickets from "./screens/MyTickets.js";
import CreateTicket from "./screens/CreateTicket.js";
import TicketDetail from "./screens/TicketDetail.js";
import Login from "./screens/Login.js";
import ChangePassword from "./screens/ChangePassword.js";
import UserManagement from "./screens/UserManagement.js";
import StaffTicketDetail from "./screens/StaffTicketDetail.js";
import StaffTicketQueue from "./screens/StaffTicketQueue.js";
import Forbidden from "./screens/Forbidden.js";

// Lab 3 (FR-02, BR-02): a user who still holds an initial password can reach no
// route except Change Password. Nothing renders until the identity request has
// answered, so neither a menu nor a redirect flashes first (ui-spec section 3).
function RequirePasswordChange({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const { pathname } = useLocation();
  if (status === "checking") return <p className="container py-4" role="status">Loading…</p>;
  if (user?.mustChangePassword && pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

// Routes that need a signed-in user of any role. No session goes to Login.
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

// An unknown URL goes to the signed-in user's own home, and a visitor with no
// session goes to Login.
function FallbackRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? landingPathFor(user.role) : "/login"} replace />;
}

const REQUESTER_ONLY = "You do not have access to Requester tickets.";

export default function App() {
  return (
    <AuthProvider>
      <RequirePasswordChange>
        <AppRoutes />
      </RequirePasswordChange>
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
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route
          path="/tickets"
          element={
            <RequireRole roles={["REQUESTER"]} message={REQUESTER_ONLY}>
              <MyTickets />
            </RequireRole>
          }
        />
        <Route
          path="/tickets/new"
          element={
            <RequireRole roles={["REQUESTER"]} message={REQUESTER_ONLY}>
              <CreateTicket />
            </RequireRole>
          }
        />
        <Route
          path="/tickets/:id"
          element={
            <RequireRole roles={["REQUESTER"]} message={REQUESTER_ONLY}>
              <TicketDetail />
            </RequireRole>
          }
        />
        <Route
          path="/staff/tickets"
          element={
            <RequireRole roles={["IT_STAFF", "ADMINISTRATOR"]} message="You do not have access to the Ticket Queue.">
              <StaffTicketQueue />
            </RequireRole>
          }
        />
        <Route
          path="/staff/tickets/:id"
          element={
            <RequireRole roles={["IT_STAFF", "ADMINISTRATOR"]} message="You do not have access to the Ticket Queue.">
              <StaffTicketDetail />
            </RequireRole>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireRole roles={["ADMINISTRATOR"]} message="You do not have access to User Management.">
              <UserManagement />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<FallbackRedirect />} />
    </Routes>
  );
}
