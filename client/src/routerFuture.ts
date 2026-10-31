// React Router 6 warns once per flag it has not been told about (Lab 4 BR-43: no console warnings).
// v7_relativeSplatPath is taken up now; this app has no splat routes, so it changes nothing here.
// v7_startTransition is declined on purpose: with it, a URL-driven search box shows its old value for a
// moment and drops what was just typed, and a filter change can rebuild the URL from a stale copy.
// Revisit when upgrading to v7, with the search boxes given their own state.
export const ROUTER_FUTURE = { v7_startTransition: false, v7_relativeSplatPath: true } as const;
