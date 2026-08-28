import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import type { Requester } from "./api.js";

const STORAGE_KEY = "toktickit.currentRequester";

interface RequesterContextValue {
  requester: Requester | null;
  selectRequester: (requester: Requester) => void;
  clearRequester: () => void;
}

const RequesterContext = createContext<RequesterContextValue | null>(null);

function readStoredRequester(): Requester | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Requester) : null;
  } catch {
    return null;
  }
}

// BR-06: the frontend keeps the selected Requester client-side (localStorage)
// and sends it explicitly as requesterId on every request; it is not a session.
export function RequesterProvider({ children }: { children: ReactNode }) {
  const [requester, setRequester] = useState<Requester | null>(readStoredRequester);

  const value = useMemo<RequesterContextValue>(
    () => ({
      requester,
      selectRequester: (next: Requester) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setRequester(next);
      },
      // FR-09/BR-06: switching clears all previously loaded requester-scoped data.
      clearRequester: () => {
        localStorage.removeItem(STORAGE_KEY);
        setRequester(null);
      },
    }),
    [requester],
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
