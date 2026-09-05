import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { getRequesters, Requester } from "./api.js";

const STORAGE_KEY = "toktickit.currentRequesterId";

interface RequesterContextValue {
  requester: Requester | null;
  status: "checking" | "resolved";
  selectRequester: (requester: Requester) => void;
  clearRequester: () => void;
}

const RequesterContext = createContext<RequesterContextValue | null>(null);

function readStoredId(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const id = raw ? Number(raw) : NaN;
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

// BR-05/BR-06: only the id is trusted client-side. The full Requester record
// (name/email) is never read from storage as-is; it is re-fetched and
// re-validated against the active Requesters list on every load, and the
// stored id is cleared if that Requester is now missing or inactive.
export function RequesterProvider({ children }: { children: ReactNode }) {
  const [requester, setRequester] = useState<Requester | null>(null);
  const [status, setStatus] = useState<"checking" | "resolved">("checking");

  useEffect(() => {
    const storedId = readStoredId();
    if (storedId === null) {
      setStatus("resolved");
      return;
    }

    getRequesters()
      .then((active) => {
        const match = active.find((r) => r.id === storedId) ?? null;
        if (!match) {
          localStorage.removeItem(STORAGE_KEY);
        }
        setRequester(match);
        setStatus("resolved");
      })
      .catch(() => {
        // Can't confirm the stored id is still active: treat it as invalid
        // rather than trusting stale storage (BR-05).
        localStorage.removeItem(STORAGE_KEY);
        setRequester(null);
        setStatus("resolved");
      });
  }, []);

  const value = useMemo<RequesterContextValue>(
    () => ({
      requester,
      status,
      selectRequester: (next: Requester) => {
        localStorage.setItem(STORAGE_KEY, String(next.id));
        setRequester(next);
      },
      // FR-09/BR-06: switching clears all previously loaded requester-scoped data.
      clearRequester: () => {
        localStorage.removeItem(STORAGE_KEY);
        setRequester(null);
      },
    }),
    [requester, status],
  );

  return <RequesterContext.Provider value={value}>{children}</RequesterContext.Provider>;
}

export function useRequester(): RequesterContextValue {
  const ctx = useContext(RequesterContext);
  if (!ctx) {
    throw new Error("useRequester must be used within a RequesterProvider");
  }
  return ctx;
}
