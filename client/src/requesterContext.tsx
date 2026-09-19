import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { getRequesters, Requester } from "./api.js";
import { AuthContext } from "./authContext.js";

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
//
// Lab 3 bridge, removed with the selector in Issue 04: a signed-in Requester
// (no pending password change) is presented to the Lab 2 screens as the current
// Requester. It is derived from the auth user on every render rather than stored,
// so it can never outlive the session and never touches localStorage. An
// AuthProvider is optional so the Lab 2 screens and tests can mount this alone.
export function RequesterProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Requester | null>(null);
  const [localStatus, setStatus] = useState<"checking" | "resolved">("checking");
  const auth = useContext(AuthContext);
  const authUser = auth?.user ?? null;
  const signedInRequester: Requester | null =
    authUser && authUser.role === "REQUESTER" && !authUser.mustChangePassword
      ? { id: authUser.id, name: authUser.name, email: authUser.email }
      : null;
  // BR-63: once anyone is signed in, the identity is the session's and nothing
  // else. The legacy Development Requester selection is honoured only while
  // nobody is signed in, so IT Staff and Administrators can never act as a
  // Requester through a selection left in browser storage.
  const requester = authUser ? signedInRequester : selected;
  const status = localStatus === "checking" || auth?.status === "checking" ? "checking" : "resolved";

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
        setSelected(match);
        setStatus("resolved");
      })
      .catch(() => {
        // Can't confirm the stored id is still active: treat it as invalid
        // rather than trusting stale storage (BR-05).
        localStorage.removeItem(STORAGE_KEY);
        setSelected(null);
        setStatus("resolved");
      });
  }, []);

  const value = useMemo<RequesterContextValue>(
    () => ({
      requester,
      status,
      selectRequester: (next: Requester) => {
        localStorage.setItem(STORAGE_KEY, String(next.id));
        setSelected(next);
      },
      // FR-09/BR-06: switching clears all previously loaded requester-scoped data.
      clearRequester: () => {
        localStorage.removeItem(STORAGE_KEY);
        setSelected(null);
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
