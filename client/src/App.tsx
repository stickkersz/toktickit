import { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./authContext.js";
import { RequesterProvider, useRequester } from "./requesterContext.js";
import { landingPathFor } from "./roles.js";
import RequesterSelection from "./RequesterSelection.js";
import Shell from "./Shell.js";
import MyTickets from "./screens/MyTickets.js";
import CreateTicket from "./screens/CreateTicket.js";
import TicketDetail from "./screens/TicketDetail.js";
import Login from "./screens/Login.js";
import ChangePassword from "./screens/ChangePassword.js";
import RoleLanding from "./screens/RoleLanding.js";

// BR-07/AC-02: no ticket screen renders without a current Requester. While
// the stored id is still being revalidated against active Requesters
// (BR-05), render nothing rather than redirecting prematurely.
function RequireRequester({ children }: { children: ReactNode }) {
  const { requester, status } = useRequester();
  if (status === "checking") return <p className="container py-4">Loading…</p>;
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
          <RequireAuth>
            <RoleLanding destination="IT Staff Ticket Queue" />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/users"
        element={
          <RequireAuth>
            <RoleLanding destination="Administrator User Management" />
          </RequireAuth>
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
      <Route path="*" element={<Navigate to="/tickets" replace />} />
    </Routes>
  );
}
