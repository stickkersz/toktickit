import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError, type RequesterDashboard } from "../../src/api.js";
import { formatBangkok } from "../../src/ActionsTaken.js";
import { EMPTY_REQUESTER_DASHBOARD, REQUESTER, STAFF, renderApp } from "../lab-03/support.js";

// Lab 4 ui-spec section 5 (the Requester Dashboard) and section 6 (the drill-down targets).

afterEach(() => {
  vi.restoreAllMocks();
});

const HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString();
const FULL: RequesterDashboard = {
  ...EMPTY_REQUESTER_DASHBOARD,
  metrics: {
    open: { count: 3, link: "/tickets?statusGroup=active" },
    waitingForYou: { count: 1, link: "/tickets?status=WAITING_FOR_REQUESTER" },
    recentlyUpdated: { count: 2, windowDays: 7, link: "/tickets?updatedWithinDays=7&sort=-updatedAt" },
    recentlyResolved: { count: 1, windowDays: 30, link: "/tickets?resolvedWithinDays=30&sort=-updatedAt" },
  },
  recentlyUpdated: [
    { id: 42, ticketNumber: "TKT-2026-000042", summary: "Cannot connect to VPN", currentStatus: "WAITING_FOR_REQUESTER", updatedAt: HOUR_AGO, link: "/tickets/42" },
  ],
  recentlyResolved: [
    { id: 40, ticketNumber: "TKT-2026-000040", summary: "Printer jam on floor 3", currentStatus: "RESOLVED", resolvedAt: HOUR_AGO, link: "/tickets/40" },
  ],
};

function open(body: RequesterDashboard = FULL) {
  vi.spyOn(api, "getRequesterDashboard").mockResolvedValue(body);
  return renderApp("/dashboard", REQUESTER);
}

describe("Requester Dashboard", () => {
  // UI-07 / AC-32, BR-33, BR-36, BR-37
  it("shows four cards linking to My Tickets filters, tints Waiting for you, and links both lists to Ticket Detail", async () => {
    open();
    const cards: [string, string][] = [
      ["Open: 3 tickets. View in My Tickets", "/tickets?statusGroup=active"],
      ["Waiting for you: 1 ticket. View in My Tickets", "/tickets?status=WAITING_FOR_REQUESTER"],
      ["Recently updated: 2 tickets. View in My Tickets", "/tickets?updatedWithinDays=7&sort=-updatedAt"],
      ["Recently resolved: 1 ticket. View in My Tickets", "/tickets?resolvedWithinDays=30&sort=-updatedAt"],
    ];
    for (const [name, href] of cards) expect(await screen.findByRole("link", { name })).toHaveAttribute("href", href);

    const waiting = screen.getByRole("link", { name: /^Waiting for you/ });
    expect(waiting).toHaveClass("zg-metric-card-attention");
    expect(within(waiting).getByText("Needs your attention")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Open:/ })).not.toHaveClass("zg-metric-card-attention");

    const updated = within(screen.getByRole("region", { name: "Recently updated" })).getByRole("link");
    expect(updated).toHaveAttribute("href", "/tickets/42");
    expect(within(updated).getByText("Waiting for Requester")).toBeInTheDocument();
    expect(within(updated).getByText("Updated 1 hour ago")).toBeInTheDocument();
    const resolved = within(screen.getByRole("region", { name: "Recently resolved" })).getByRole("link");
    expect(resolved).toHaveAttribute("href", "/tickets/40");
    // ui-spec section 5: the resolution date itself, in Asia/Bangkok time.
    expect(within(resolved).getByText(`Resolved ${formatBangkok(HOUR_AGO)}`)).toBeInTheDocument();

    // The next step is one click away, and the full My Tickets table is not repeated.
    expect(screen.getByRole("main").querySelector('a[href="/tickets/new"]')).not.toBeNull();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // UI-08 / AC-30, BR-34
  it("keeps every card with its empty sentence and no tint when there is nothing", async () => {
    open(EMPTY_REQUESTER_DASHBOARD);
    expect(await screen.findByRole("link", { name: "Open: 0 tickets. View in My Tickets" })).toHaveTextContent("You have no open tickets.");
    const waiting = screen.getByRole("link", { name: "Waiting for you: 0 tickets. View in My Tickets" });
    expect(waiting).toHaveTextContent("Nothing is waiting for you.");
    expect(waiting).not.toHaveClass("zg-metric-card-attention");
    expect(within(screen.getByRole("region", { name: "Recently updated" })).getByText("No updates in the last 7 days.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recently resolved" })).getByText("Nothing resolved in the last 30 days.")).toBeInTheDocument();
  });

  // UI-08 / AC-29
  it("shows a busy skeleton, then a failure callout with Retry and no numbers, and Retry loads", async () => {
    let fail: (e: Error) => void = () => {};
    const get = vi.spyOn(api, "getRequesterDashboard").mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    renderApp("/dashboard", REQUESTER);
    const loading = await screen.findByRole("status", { name: "Loading the dashboard" });
    expect(within(loading).getByText("Waiting for you")).toBeInTheDocument();
    expect(loading.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");

    fail(new ApiError("down", 500));
    expect(await screen.findByText("The dashboard could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for you")).not.toBeInTheDocument();

    get.mockResolvedValueOnce(FULL);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: /^Open: 3 tickets/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toHaveFocus();
  });
});

describe("drill-down targets read the dashboard query string", () => {
  // UI-09 / AC-31, AC-32, BR-36
  it("opens My Tickets with the window chip and sort from the URL, sends them, and removes the chip", async () => {
    renderApp("/tickets?updatedWithinDays=7&sort=-updatedAt", REQUESTER);
    // One row, so the table and its sortable headers are drawn (set before the session resolves).
    vi.mocked(api.getTickets).mockResolvedValue({
      data: [{ id: 42, ticketNumber: "TKT-2026-000042", summary: "Cannot connect to VPN", categoryName: "Network", requestedPriority: "MEDIUM", currentStatus: "OPEN", createdAt: HOUR_AGO, updatedAt: HOUR_AGO }],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
    const chip = await screen.findByText("Updated in the last 7 days");
    await waitFor(() => expect(api.getTickets).toHaveBeenCalledWith(expect.objectContaining({ updatedWithinDays: 7, sort: "-updatedAt" })));
    expect(screen.getByRole("columnheader", { name: /Last Updated/ })).toHaveAttribute("aria-sort", "descending");
    // The phone layout's sort select shows the same choice.
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("-updatedAt");

    await userEvent.click(within(chip).getByRole("button", { name: "Remove filter: Updated in the last 7 days" }));
    await waitFor(() => expect(api.getTickets).toHaveBeenLastCalledWith(expect.objectContaining({ updatedWithinDays: undefined, sort: "-updatedAt" })));
    expect(screen.queryByText("Updated in the last 7 days")).not.toBeInTheDocument();
  });

  // UI-09 / BR-36: the route's `status` becomes My Tickets' `currentStatus`, and a group is pre-selected.
  it("pre-selects a single status or a status group on My Tickets", async () => {
    const first = renderApp("/tickets?status=WAITING_FOR_REQUESTER", REQUESTER);
    await waitFor(() => expect(api.getTickets).toHaveBeenCalledWith(expect.objectContaining({ currentStatus: "WAITING_FOR_REQUESTER" })));
    vi.mocked(api.getTickets).mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
    first.unmount();
    vi.restoreAllMocks();

    renderApp("/tickets?statusGroup=active", REQUESTER);
    await waitFor(() => expect(api.getTickets).toHaveBeenCalledWith(expect.objectContaining({ statusGroup: "active", currentStatus: undefined })));
    expect(await screen.findByText("Active tickets only")).toBeInTheDocument();
  });

  // UI-09 / AC-31: the queue shows the "Active tickets only" chip; removing it and Clear filters both drop it.
  it("opens the queue with its filters and the removable Active tickets only chip", async () => {
    renderApp("/staff/tickets?itPriority=HIGH&statusGroup=active", STAFF);
    const chip = await screen.findByText("Active tickets only");
    await waitFor(() => expect(api.getStaffTickets).toHaveBeenCalledWith(expect.objectContaining({ itPriority: "HIGH", statusGroup: "active" })));
    expect(screen.getByRole("combobox", { name: "IT Priority" })).toHaveValue("HIGH");

    await userEvent.click(within(chip).getByRole("button", { name: "Remove filter: Active tickets only" }));
    await waitFor(() => expect(api.getStaffTickets).toHaveBeenLastCalledWith(expect.objectContaining({ itPriority: "HIGH", statusGroup: undefined })));
    expect(screen.queryByText("Active tickets only")).not.toBeInTheDocument();
  });

  it("drops the Active tickets only chip with Clear filters", async () => {
    renderApp("/staff/tickets?owner=me&statusGroup=active", STAFF);
    await screen.findByText("Active tickets only");
    // The empty result offers Clear filters too; the one beside the chip is first.
    await userEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await waitFor(() => expect(api.getStaffTickets).toHaveBeenLastCalledWith(expect.objectContaining({ owner: undefined, statusGroup: undefined })));
    expect(screen.queryByText("Active tickets only")).not.toBeInTheDocument();
  });
});
