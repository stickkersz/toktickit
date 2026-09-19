import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { AuthUser, getCurrentUser, logout } from "./api.js";

interface AuthContextValue {
  user: AuthUser | null;
  // "checking" until GET /api/auth/me has answered once. Nothing role specific
  // is rendered while checking, so the wrong menu never flashes (ui-spec §3).
  status: "checking" | "resolved";
  signIn: (user: AuthUser) => void;
  signOut: () => Promise<void>;
}

// Exported so RequesterProvider can read it without requiring an AuthProvider:
// the Lab 2 screens and tests still mount it on its own.
export const AuthContext = createContext<AuthContextValue | null>(null);

// Identity comes from the server session, never from browser storage: nothing
// here reads or writes localStorage.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<"checking" | "resolved">("checking");

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((current) => {
        if (active) setUser(current);
      })
      // An unreachable API leaves the visitor signed out rather than stuck.
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setStatus("resolved");
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      signIn: (next) => {
        setUser(next);
        setStatus("resolved");
      },
      signOut: async () => {
        await logout();
        setUser(null);
      },
    }),
    [user, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
