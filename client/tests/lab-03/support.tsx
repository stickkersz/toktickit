import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import App from "../../src/App.js";
import * as api from "../../src/api.js";
import type { AuthUser } from "../../src/api.js";

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
  vi.spyOn(api, "getTicketDetail").mockRejectedValue(new api.NotFoundError("Ticket not found."));
  vi.spyOn(api, "getTickets").mockResolvedValue({
    data: [],
    pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
