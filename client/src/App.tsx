import { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequesterProvider, useRequester } from "./requesterContext.js";
import RequesterSelection from "./RequesterSelection.js";
import Shell from "./Shell.js";
import MyTickets from "./screens/MyTickets.js";
import CreateTicket from "./screens/CreateTicket.js";
import TicketDetail from "./screens/TicketDetail.js";

// BR-07/AC-02: no ticket screen renders without a current Requester. While
// the stored id is still being revalidated against active Requesters
// (BR-05), render nothing rather than redirecting prematurely.
function RequireRequester({ children }: { children: ReactNode }) {
  const { requester, status } = useRequester();
  if (status === "checking") return <p className="container py-4">Loading…</p>;
  if (!requester) return <Navigate to="/select-requester" replace />;
  return children;
}

export default function App() {
  return (
    <RequesterProvider>
      <Routes>
        <Route path="/select-requester" element={<RequesterSelection />} />
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
    </RequesterProvider>
  );
}
