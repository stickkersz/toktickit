import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError, type StaffDashboard } from "../../src/api.js";
import { ADMIN, EMPTY_STAFF_DASHBOARD, REQUESTER, STAFF, renderApp } from "../lab-03/support.js";

// Lab 4 ui-spec section 4: the IT Staff Dashboard, and the forbidden state of section 3.

afterEach(() => {
  vi.restoreAllMocks();
});

const STATUSES = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"];
const PAST = new Date(Date.now() - 2 * 3_600_000).toISOString();
const FUTURE = new Date(Date.now() + 26 * 3_600_000).toISOString();

const FULL: StaffDashboard = {
  ...EMPTY_STAFF_DASHBOARD,
  metrics: {
    unassigned: { count: 4, link: "/staff/tickets?owner=needs-owner" },
    myTickets: { count: 1, link: "/staff/tickets?owner=me&statusGroup=active" },
    urgent: { count: 3, link: "/staff/tickets?itPriority=HIGH&statusGroup=active" },
    byStatus: STATUSES.map((status, i) => ({ status, count: i === 7 ? 0 : i + 2, link: `/staff/tickets?status=${status}` })),
  },
  myPlannedActions: {
    count: 7,
    items: [
      { actionId: 11, ticketId: 42, ticketNumber: "TKT-2026-000042", description: "Replace the switch port on floor 2", actionAt: PAST, link: "/staff/tickets/42?tab=actions" },
      { actionId: 12, ticketId: 43, ticketNumber: "TKT-2026-000043", description: "Call the vendor about the licence", actionAt: FUTURE, link: "/staff/tickets/43?tab=actions" },
    ],
  },
  recentlyUpdated: [
    { id: 42, ticketNumber: "TKT-2026-000042", summary: "Cannot connect to VPN", currentStatus: "IN_PROGRESS", updatedAt: PAST, link: "/staff/tickets/42" },
  ],
};

function open(user = STAFF, body: StaffDashboard = FULL) {
  vi.spyOn(api, "getStaffDashboard").mockResolvedValue(body);
  return renderApp("/staff/dashboard", user);
}

describe("IT Staff Dashboard", () => {
  // UI-02 / AC-28, AC-31, BR-36
  it("shows every card with its label and value as one link to the matching queue", async () => {
    open();
    const card = await screen.findByRole("link", { name: "Unassigned: 4 tickets. View in the Ticket Queue" });
    expect(card).toHaveAttribute("href", "/staff/tickets?owner=needs-owner");
    expect(within(card).getByText("4")).toBeInTheDocument();
    expect(within(card).getByText("Tickets not yet closed or cancelled that have no active owner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Tickets: 1 ticket. View in the Ticket Queue" })).toHaveAttribute("href", "/staff/tickets?owner=me&statusGroup=active");
    expect(screen.getByRole("link", { name: "Urgent: 3 tickets. View in the Ticket Queue" })).toHaveAttribute("href", "/staff/tickets?itPriority=HIGH&statusGroup=active");

    // All eight statuses in BR-20 order, zeros kept, each opening the queue at that status.
    const chips = within(screen.getByRole("region", { name: "By status" })).getAllByRole("link");
    expect(chips.map((c) => c.getAttribute("href"))).toEqual(STATUSES.map((s) => `/staff/tickets?status=${s}`));
    expect(chips[3]).toHaveAccessibleName("Waiting for Requester: 5 tickets. View in the Ticket Queue");
    expect(chips[7]).toHaveAccessibleName("Cancelled: 0 tickets. View in the Ticket Queue");

    const planned = screen.getByRole("region", { name: "My Planned Actions" });
    expect(within(planned).getByText("(7)")).toBeInTheDocument();
    const rows = within(planned).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/staff/tickets/42?tab=actions", "/staff/tickets/43?tab=actions"]);
    // Overdue in words, only on the one whose time has passed.
    expect(within(rows[0]).getByText("Overdue")).toBeInTheDocument();
    expect(within(rows[1]).queryByText("Overdue")).not.toBeInTheDocument();

    const recent = within(screen.getByRole("region", { name: "Recently updated" })).getByRole("link");
    expect(recent).toHaveAttribute("href", "/staff/tickets/42");
    expect(within(recent).getByText("In Progress")).toBeInTheDocument();
    expect(within(recent).getByText("Updated 2 hours ago")).toBeInTheDocument();
  });

  // UI-03 / AC-30, BR-34
  it("keeps every card at 0 with its empty sentence, and shows each list's empty sentence", async () => {
    open(STAFF, EMPTY_STAFF_DASHBOARD);
    expect(await screen.findByRole("link", { name: "Unassigned: 0 tickets. View in the Ticket Queue" })).toHaveTextContent("No tickets need an owner");
    expect(screen.getByRole("link", { name: "My Tickets: 0 tickets. View in the Ticket Queue" })).toHaveTextContent("You own no active tickets");
    expect(screen.getByRole("link", { name: "Urgent: 0 tickets. View in the Ticket Queue" })).toHaveTextContent("No active tickets with IT Priority High");
    expect(within(screen.getByRole("region", { name: "By status" })).getAllByRole("link")).toHaveLength(8);
    expect(screen.getByText("You have no planned actions.")).toBeInTheDocument();
    expect(screen.getByText("No ticket activity yet.")).toBeInTheDocument();
  });

  // UI-04 / AC-29
  it("shows a busy skeleton, then on failure a callout with Retry and no numbers, and Retry loads", async () => {
    let fail: (e: Error) => void = () => {};
    const get = vi.spyOn(api, "getStaffDashboard").mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    renderApp("/staff/dashboard", STAFF);

    const loading = await screen.findByRole("status", { name: "Loading the dashboard" });
    expect(within(loading).getByText("Unassigned")).toBeInTheDocument();
    expect(loading.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("link", { name: /tickets\. View in/ })).not.toBeInTheDocument();

    fail(new ApiError("down", 500));
    expect(await screen.findByText("The dashboard could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();

    get.mockResolvedValueOnce(FULL);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: /^Unassigned: 4 tickets/ })).toBeInTheDocument();
    // Focus is not lost with the Retry button: it moved to the heading.
    expect(screen.getByRole("heading", { name: "Dashboard" })).toHaveFocus();
    expect(get).toHaveBeenCalledTimes(2);
  });

  // UI-05 / AC-34, L3-BR-63
  it.each([
    ["a Requester on the staff dashboard", REQUESTER, "/staff/dashboard"],
    ["IT Staff on the Requester dashboard", STAFF, "/dashboard"],
    ["an Administrator on the Requester dashboard", ADMIN, "/dashboard"],
  ] as const)("gives %s the forbidden state and requests no dashboard", async (_who, user, path) => {
    renderApp(path, user);
    expect(await screen.findByText("You do not have access to this dashboard.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your home screen" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument());
    expect(api.getStaffDashboard).not.toHaveBeenCalled();
    expect(api.getRequesterDashboard).not.toHaveBeenCalled();
  });

  // UI-06 / AC-33, BR-32
  it("shows the Accounts card with counts and a Users link to an Administrator only", async () => {
    const admin = open(ADMIN, { ...FULL, accounts: { active: { REQUESTER: 5, IT_STAFF: 3, ADMINISTRATOR: 1 }, inactive: 2, link: "/admin/users" } });
    const accounts = await screen.findByRole("link", {
      name: "Accounts: 5 active Requesters, 3 active IT Staff, 1 active Administrators, 2 inactive. View in User Management",
    });
    expect(accounts).toHaveAttribute("href", "/admin/users");

    admin.unmount();
    vi.restoreAllMocks();
    open(STAFF);
    await screen.findByRole("link", { name: /^Unassigned/ });
    expect(screen.queryByRole("link", { name: /^Accounts/ })).not.toBeInTheDocument();
  });
});
