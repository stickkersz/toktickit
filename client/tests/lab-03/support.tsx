import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import App from "../../src/App.js";
import * as api from "../../src/api.js";
import type { AuthUser } from "../../src/api.js";
import { ROUTER_FUTURE } from "../../src/routerFuture.js";

export const REQUESTER: AuthUser = {
  id: 7,
  name: "Kanokwan Srisuwan",
  email: "kanokwan.srisuwan@toktickit.test",
  role: "REQUESTER",
  mustChangePassword: false,
};
export const STAFF: AuthUser = { ...REQUESTER, id: 8, name: "Pimchanok Somboon", role: "IT_STAFF" };
export const ADMIN: AuthUser = { ...REQUESTER, id: 9, name: "Aekkarat Wongsa", role: "ADMINISTRATOR" };
export const TEMPORARY: AuthUser = { ...REQUESTER, mustChangePassword: true };

// The whole application at a route, with the identity request answered as given.
// Anything a landing screen would fetch is stubbed so no test reaches a network.
export function renderApp(
  path: string,
  currentUser: AuthUser | null = null,
) {
  vi.spyOn(api, "getCurrentUser").mockResolvedValue(currentUser);
  vi.spyOn(api, "getCategories").mockResolvedValue([]);
  vi.spyOn(api, "getRelatedSystems").mockResolvedValue([]);
  // The staff queue, which IT Staff and Administrators now land on.
  vi.spyOn(api, "getStaffTickets").mockResolvedValue({
    tickets: [],
    pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
  });
  vi.spyOn(api, "getStaffOwners").mockResolvedValue([]);
  vi.spyOn(api, "getStaffTicketDetail").mockRejectedValue(new api.NotFoundError("Ticket not found."));
  // Public Comments and Internal Notes: empty unless a test says otherwise.
  vi.spyOn(api, "getTicketComments").mockResolvedValue([]);
  vi.spyOn(api, "getTicketNotes").mockResolvedValue([]);
  // Lab 4 Actions Taken: none unless a test says otherwise.
  vi.spyOn(api, "getTicketActions").mockResolvedValue([]);
  // User Management: no users unless a test says otherwise.
  vi.spyOn(api, "getAdminUsers").mockResolvedValue([]);
  vi.spyOn(api, "getTicketDetail").mockRejectedValue(new api.NotFoundError("Ticket not found."));
  vi.spyOn(api, "getTickets").mockResolvedValue({
    data: [],
    pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
  });
  // Lab 4: every role now lands on its Dashboard (ui-spec section 3).
  stubDashboards();
  return render(
    <MemoryRouter future={ROUTER_FUTURE} initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const figure = (count: number, link: string) => ({ count, link });
export const EMPTY_STAFF_DASHBOARD: api.StaffDashboard = {
  generatedAt: "2026-10-30T03:00:00.000Z",
  timeZone: "Asia/Bangkok",
  metrics: {
    unassigned: figure(0, "/staff/tickets?owner=needs-owner"),
    myTickets: figure(0, "/staff/tickets?owner=me&statusGroup=active"),
    urgent: figure(0, "/staff/tickets?itPriority=HIGH&statusGroup=active"),
    byStatus: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"].map((status) => ({ status, ...figure(0, `/staff/tickets?status=${status}`) })),
  },
  myPlannedActions: { count: 0, items: [] },
  recentlyUpdated: [],
};
export const EMPTY_REQUESTER_DASHBOARD: api.RequesterDashboard = {
  generatedAt: "2026-10-30T03:00:00.000Z",
  timeZone: "Asia/Bangkok",
  metrics: {
    open: figure(0, "/tickets?statusGroup=active"),
    waitingForYou: figure(0, "/tickets?status=WAITING_FOR_REQUESTER"),
    recentlyUpdated: { ...figure(0, "/tickets?updatedWithinDays=7&sort=-updatedAt"), windowDays: 7 },
    recentlyResolved: { ...figure(0, "/tickets?resolvedWithinDays=30&sort=-updatedAt"), windowDays: 30 },
  },
  recentlyUpdated: [],
  recentlyResolved: [],
};
// A test that set its own dashboard answer before rendering keeps it.
export function stubDashboards() {
  if (!vi.isMockFunction(api.getStaffDashboard)) vi.spyOn(api, "getStaffDashboard").mockResolvedValue(EMPTY_STAFF_DASHBOARD);
  if (!vi.isMockFunction(api.getRequesterDashboard)) vi.spyOn(api, "getRequesterDashboard").mockResolvedValue(EMPTY_REQUESTER_DASHBOARD);
}
