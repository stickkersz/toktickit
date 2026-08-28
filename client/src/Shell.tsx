import { Outlet, useNavigate } from "react-router-dom";
import { useRequester } from "./requesterContext.js";

// Minimal application shell: current-Requester display + Change Requester
// (FR-09). Full header nav (My Tickets/Create Ticket links, mobile menu,
// ui-spec.md §4) is built out once those screens have real content.
export default function Shell() {
  const { requester, clearRequester } = useRequester();
  const navigate = useNavigate();

  function handleChangeRequester() {
    clearRequester();
    navigate("/select-requester");
  }

  return (
    <div>
      <header className="zg-header d-flex justify-content-between align-items-center text-white px-3">
        <span className="fw-semibold">TokTickIT</span>
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
