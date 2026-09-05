import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRequesters, Requester } from "./api.js";
import { useRequester } from "./requesterContext.js";

type LoadState = "loading" | "empty" | "error" | "ready";

// ui-spec.md §5 — Development Requester Selection screen.
export default function RequesterSelection() {
  const [state, setState] = useState<LoadState>("loading");
  const [requesters, setRequesters] = useState<Requester[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const { selectRequester } = useRequester();
  const navigate = useNavigate();

  function load() {
    setState("loading");
    getRequesters()
      .then((result) => {
        setRequesters(result);
        setState(result.length === 0 ? "empty" : "ready");
      })
      .catch(() => setState("error"));
  }

  useEffect(load, []);

  function handleContinue() {
    const chosen = requesters.find((r) => String(r.id) === selectedId);
    if (!chosen) return;
    selectRequester(chosen);
    navigate("/tickets");
  }

  return (
    <div className="container py-5" style={{ maxWidth: 420 }}>
      <h1 className="h4 mb-3">TokTickIT</h1>
      <h2 className="h5 mb-3">Select Development Requester</h2>
      <p className="text-muted small">
        Select a Development Requester to test requester-specific ticket behavior. This is not a
        login screen. Authentication and role-based access will be introduced in Lab 3.
      </p>

      {state === "loading" && (
        <select
          className="form-select mb-3"
          disabled
          aria-label="Development Requester (loading)"
        >
          <option>Loading Requesters…</option>
        </select>
      )}

      {state === "empty" && (
        <p className="text-muted" role="status">
          No active Development Requesters are available. Contact your instructor.
        </p>
      )}

      {state === "error" && (
        <div className="zg-alert-error rounded p-3" role="alert">
          <p className="mb-2">Unable to load Development Requesters.</p>
          <button type="button" className="btn zg-btn-primary btn-sm" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {state === "ready" && (
        <>
          <label htmlFor="requester-select" className="form-label fw-semibold">
            Development Requester *
          </label>
          <select
            id="requester-select"
            className="form-select mb-2"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="" disabled>
              Choose a Requester…
            </option>
            {requesters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <p className="text-muted small">Only active development requesters are shown.</p>
        </>
      )}

      <div className="alert alert-secondary small">
        Authentication coming in Lab 3: this selection will be replaced with secure
        authentication.
      </div>

      <div className="d-flex justify-content-end gap-2 mt-4">
        <button
          type="button"
          className="btn zg-btn-primary"
          disabled={state !== "ready" || selectedId === ""}
          onClick={handleContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
