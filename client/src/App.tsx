import { useState } from "react";
import { checkSystem } from "./api.js";

// UI states you must handle for Issue 4: idle, loading, success, error.
type UiState = "idle" | "loading" | "success" | "error";

export default function App() {
  const [state, setState] = useState<UiState>("idle");
  const [error, setError] = useState("");

  async function handleCheck() {
    setState("loading");
    try {
      await checkSystem();
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect to TokTickIT API");
      setState("error");
    }
  }

  return (
    <div className="container py-5" style={{ maxWidth: 640 }}>
      <h1 className="h3 mb-4">
        TokTickIT <span className="text-success">IT Service Desk</span>
      </h1>

      <button className="btn btn-success" onClick={handleCheck} disabled={state === "loading"}>
        {state === "loading" ? "Loading…" : "Check System"}
      </button>

      {state === "success" && (
        <p className="fw-bold text-success mt-4">System Status: Online</p>
      )}

      {state === "error" && (
        <div className="mt-4">
          <p className="fw-bold text-danger mb-1">System Status: Offline</p>
          <p className="text-danger">{error}</p>
        </div>
      )}

      {/* TODO(Issue 4): render the seeded category list on success. */}
    </div>
  );
}
