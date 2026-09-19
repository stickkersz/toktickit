import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import type { StaffQueueResult, StaffTicketItem } from "../../src/api.js";
import { ADMIN, STAFF, renderApp } from "./support.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function row(overrides: Partial<StaffTicketItem> = {}): StaffTicketItem {
  return {
    id: 1,
    ticketNumber: "TKT-2026-000001",
    summary: "Cannot connect to the VPN",
    categoryName: "Network",
    requesterName: "Kanokwan Srisuwan",
    requesterIsActive: true,
    requestedPriority: "MEDIUM",
    itPriority: "HIGH",
    currentStatus: "OPEN",
    ownerId: 8,
    ownerName: "Pimchanok Somboon",
    ownerIsActive: true,
    ownerEligible: true,
    requesterResolutionFlaggedAt: null,
    createdAt: "2026-09-10T09:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
    ...overrides,
  };
}

function result(tickets: StaffTicketItem[], pagination: Partial<StaffQueueResult["pagination"]> = {}): StaffQueueResult {
  return {
    tickets,
    pagination: {
      page: 1,
      pageSize: 10,
      total: tickets.length,
      totalPages: tickets.length > 0 ? 1 : 0,
      ...pagination,
    },
  };
}

// Opens the queue and lets the caller decide what the API answers before the first request.
function openQueue(path = "/staff/tickets", answer: (params: api.StaffQueueParams) => Promise<StaffQueueResult> = () => Promise.resolve(result([row()]))) {
  const view = renderApp(path, STAFF);
  vi.mocked(api.getStaffTickets).mockImplementation(answer);
  return view;
}

const lastCall = () => vi.mocked(api.getStaffTickets).mock.calls.at(-1)![0];
const table = () => screen.getByRole("table");

describe("Staff Ticket Queue: rows", () => {
  // UI-11 / AC-16
  it("renders ticket number, status, IT Priority and owner for each row, and shows Unassigned explicitly", async () => {
    openQueue("/staff/tickets", () =>
      Promise.resolve(
        result([
          row(),
          row({ id: 2, ticketNumber: "TKT-2026-000002", summary: "Printer is offline", currentStatus: "NEW", itPriority: "LOW", ownerId: null, ownerName: null, ownerIsActive: null, ownerEligible: null }),
        ]),
      ),
    );

    const rows = await within(await screen.findByRole("table")).findAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("TKT-2026-000001")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Open")).toHaveClass("zg-badge-open");
    expect(within(rows[0]).getByText("High", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(within(rows[0]).getByText("Pimchanok Somboon")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Cannot connect to the VPN")).toBeInTheDocument();
    // Unassigned is words in muted text, never an empty cell.
    expect(within(rows[1]).getByText("Unassigned")).toHaveClass("text-muted");
    expect(within(rows[1]).getByText("New")).toHaveClass("zg-badge-new");
  });

  it("reports the visible range and total, and shows the requested and IT priorities as separate columns", async () => {
    openQueue("/staff/tickets", () => Promise.resolve(result([row()], { total: 87, totalPages: 9 })));
    expect(await screen.findByText("Showing 1 to 10 of 87 tickets")).toBeInTheDocument();
    const headers = within(table()).getAllByRole("columnheader").map((h) => h.textContent?.replace(/ [▲▼]$/, ""));
    expect(headers).toEqual(["Ticket No.", "Created Date", "Summary", "Category", "Req. Priority", "IT Priority", "Status", "Owner"]);
    // The desktop table never lists Requester, Related System or Last Updated: eight columns, no more.
    expect(headers).toHaveLength(8);
  });

  it("gives a small screen a card list that leads with Ticket No. and Status", async () => {
    openQueue();
    const cards = await screen.findByLabelText("Tickets");
    const card = within(cards).getByRole("button");
    expect(within(card).getByText("TKT-2026-000001")).toBeInTheDocument();
    expect(within(card).getByText("Open")).toBeInTheDocument();
    expect(within(card).getByText("Category")).toBeInTheDocument();
    expect(within(card).getByText("Network")).toBeInTheDocument();
    expect(within(card).getByText("IT Priority")).toBeInTheDocument();
    expect(within(card).getByText("Owner")).toBeInTheDocument();
  });

  it("opens the Ticket Detail by click, by Enter, and by Space", async () => {
    openQueue();
    const user = userEvent.setup();
    let rows = await within(await screen.findByRole("table")).findAllByRole("button");
    await user.click(rows[0]);
    expect(await screen.findByRole("heading", { name: "Ticket Detail" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ticket Queue" })).toHaveAttribute("aria-current", "page");

    for (const key of ["{Enter}", " "]) {
      await user.click(screen.getByRole("link", { name: "Back to Queue" }));
      rows = await within(await screen.findByRole("table")).findAllByRole("button");
      rows[0].focus();
      await user.keyboard(key);
      expect(await screen.findByRole("heading", { name: "Ticket Detail" })).toBeInTheDocument();
    }
  });

  it("is available to an Administrator as well", async () => {
    renderApp("/staff/tickets", ADMIN);
    vi.mocked(api.getStaffTickets).mockResolvedValue(result([row()]));
    expect(await screen.findByRole("heading", { name: "Ticket Queue" })).toBeInTheDocument();
    expect(await screen.findByText("TKT-2026-000001", { selector: "td" })).toBeInTheDocument();
  });
});

describe("Staff Ticket Queue: search, filters, sort and paging", () => {
  // UI-12 / AC-17
  it("issues the right query for a search, each filter, and a page change, resetting to page 1", async () => {
    openQueue("/staff/tickets?page=3", () => Promise.resolve(result([row()], { page: 3, total: 40, totalPages: 4 })));
    const user = userEvent.setup();
    await screen.findByRole("table");
    expect(lastCall()).toMatchObject({ page: 3, pageSize: 10, sort: "-createdAt" });

    await user.type(screen.getByLabelText("Search tickets"), "vpn");
    await waitFor(() => expect(lastCall()).toMatchObject({ search: "vpn" }));
    expect(lastCall().page).toBe(1);

    await user.selectOptions(screen.getByLabelText("Status"), "IN_PROGRESS");
    await waitFor(() => expect(lastCall()).toMatchObject({ search: "vpn", status: "IN_PROGRESS" }));

    await user.selectOptions(screen.getByLabelText("IT Priority"), "HIGH");
    await waitFor(() => expect(lastCall()).toMatchObject({ itPriority: "HIGH", status: "IN_PROGRESS" }));

    await user.selectOptions(screen.getByLabelText("Owner"), "needs-owner");
    await waitFor(() => expect(lastCall()).toMatchObject({ owner: "needs-owner" }));
    await user.selectOptions(screen.getByLabelText("Owner"), "me");
    await waitFor(() => expect(lastCall()).toMatchObject({ owner: "me" }));
    await user.selectOptions(screen.getByLabelText("Owner"), "unassigned");
    await waitFor(() => expect(lastCall()).toMatchObject({ owner: "unassigned" }));
    await user.selectOptions(screen.getByLabelText("Owner"), "");
    await waitFor(() => expect(lastCall().owner).toBeUndefined());
  });

  it("filters by Category using the ids the API provides", async () => {
    openQueue();
    vi.mocked(api.getCategories).mockResolvedValue([{ id: 4, name: "Network" }, { id: 2, name: "Hardware" }]);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.selectOptions(await screen.findByRole("option", { name: "Hardware" }).then(() => screen.getByLabelText("Category")), "2");
    await waitFor(() => expect(lastCall()).toMatchObject({ category: 2 }));
  });

  it("offers the four owner choices and all eight statuses, and the three IT Priorities", async () => {
    openQueue();
    await screen.findByRole("table");
    expect(within(screen.getByLabelText("Owner")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Anyone",
      "Unassigned",
      "Assigned to me",
      "Needs an owner",
    ]);
    expect(within(screen.getByLabelText("Status")).getAllByRole("option")).toHaveLength(9);
    expect(within(screen.getByLabelText("IT Priority")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All IT Priorities",
      "Low",
      "Medium",
      "High",
    ]);
  });

  it("toggles sort on the four sortable headers, and aria-sort reflects the state", async () => {
    openQueue();
    const user = userEvent.setup();
    await screen.findByRole("table");
    const header = (name: string) => within(table()).getByRole("columnheader", { name: new RegExp(`^${name}`) });

    // Default: newest first, so Created Date is descending and the rest are unsorted.
    expect(header("Created Date")).toHaveAttribute("aria-sort", "descending");
    expect(header("Created Date")).toHaveTextContent("▼");
    for (const name of ["Ticket No.", "IT Priority", "Status"]) expect(header(name)).toHaveAttribute("aria-sort", "none");

    await user.click(header("IT Priority"));
    await waitFor(() => expect(lastCall().sort).toBe("itPriority"));
    expect(header("IT Priority")).toHaveAttribute("aria-sort", "ascending");
    expect(header("IT Priority")).toHaveTextContent("▲");
    expect(header("Created Date")).toHaveAttribute("aria-sort", "none");

    await user.click(header("IT Priority"));
    await waitFor(() => expect(lastCall().sort).toBe("-itPriority"));
    expect(header("IT Priority")).toHaveAttribute("aria-sort", "descending");

    await user.click(header("Status"));
    await waitFor(() => expect(lastCall().sort).toBe("currentStatus"));
    await user.click(header("Ticket No."));
    await waitFor(() => expect(lastCall().sort).toBe("ticketNumber"));
    await user.click(header("Created Date"));
    await waitFor(() => expect(lastCall().sort).toBe("createdAt"));
    // Summary, Category, Req. Priority and Owner are not sortable.
    for (const name of ["Summary", "Category", "Req. Priority", "Owner"]) expect(header(name)).not.toHaveAttribute("aria-sort");
  });

  it("sorts from the keyboard with Enter and Space, without giving a header a button role", async () => {
    openQueue();
    const user = userEvent.setup();
    await screen.findByRole("table");
    const status = within(table()).getByRole("columnheader", { name: /^Status/ });
    expect(status).toHaveAttribute("tabindex", "0");
    status.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(lastCall().sort).toBe("currentStatus"));
    await user.keyboard(" ");
    await waitFor(() => expect(lastCall().sort).toBe("-currentStatus"));
  });

  it("pages with Previous, Next and numbered pages, keeping the rest of the query", async () => {
    openQueue("/staff/tickets?status=OPEN", (p) => Promise.resolve(result([row()], { page: p.page ?? 1, total: 87, totalPages: 9 })));
    const user = userEvent.setup();
    await screen.findByRole("table");
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(within(pager).getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    // Nine pages: the first, the last and a window around the current one, with a gap between.
    expect(within(pager).getByRole("button", { name: "Page 9" })).toBeInTheDocument();
    expect(within(pager).queryByRole("button", { name: "Page 5" })).not.toBeInTheDocument();

    await user.click(within(pager).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastCall()).toMatchObject({ page: 2, status: "OPEN" }));
    await user.click(within(pager).getByRole("button", { name: "Page 9" }));
    await waitFor(() => expect(lastCall().page).toBe(9));
    expect(await within(pager).findByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(within(pager).getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(lastCall().page).toBe(8));
  });

  it("keeps the whole view in the URL, so returning to the queue restores it", async () => {
    openQueue("/staff/tickets?search=vpn&status=OPEN&itPriority=HIGH&category=4&owner=me&sort=-itPriority&page=2", () =>
      Promise.resolve(result([row()], { page: 2, total: 30, totalPages: 3 })),
    );
    await screen.findByRole("table");
    expect(lastCall()).toEqual({ search: "vpn", status: "OPEN", itPriority: "HIGH", category: 4, owner: "me", sort: "-itPriority", page: 2, pageSize: 10 });
    expect(screen.getByLabelText("Search tickets")).toHaveValue("vpn");
    expect(screen.getByLabelText("Status")).toHaveValue("OPEN");
    expect(screen.getByLabelText("IT Priority")).toHaveValue("HIGH");
    expect(screen.getByLabelText("Owner")).toHaveValue("me");
    expect(within(table()).getByRole("columnheader", { name: /^IT Priority/ })).toHaveAttribute("aria-sort", "descending");
  });
});

describe("Staff Ticket Queue: stale responses", () => {
  // UI-13 / the Lab 2 race defect
  it("never renders an older request's rows after a newer request has answered", async () => {
    const pending: Record<string, (r: StaffQueueResult) => void> = {};
    openQueue("/staff/tickets", (p) => {
      if (!p.search) return Promise.resolve(result([row({ summary: "Initial list" })]));
      return new Promise((resolve) => {
        pending[p.search!] = resolve;
      });
    });
    const user = userEvent.setup();
    await screen.findByText("Initial list", { selector: "td" });

    await user.type(screen.getByLabelText("Search tickets"), "ab");
    await waitFor(() => expect(Object.keys(pending).sort()).toEqual(["a", "ab"]));

    // The newer request ("ab") answers first, then the older one ("a") answers late.
    pending["ab"](result([row({ id: 2, summary: "Result for ab" })]));
    expect(await screen.findByText("Result for ab", { selector: "td" })).toBeInTheDocument();
    pending["a"](result([row({ id: 3, summary: "Stale result for a" })]));
    await new Promise((r) => setTimeout(r, 30));

    expect(screen.queryByText("Stale result for a")).not.toBeInTheDocument();
    expect(screen.getByText("Result for ab", { selector: "td" })).toBeInTheDocument();
  });

  it("does not let an older failure replace newer rows either", async () => {
    let failOlder: (e: Error) => void = () => {};
    openQueue("/staff/tickets", (p) => {
      if (p.search === "a") return new Promise((_, reject) => (failOlder = reject));
      if (p.search === "ab") return Promise.resolve(result([row({ summary: "Newer rows" })]));
      return Promise.resolve(result([row({ summary: "Initial list" })]));
    });
    const user = userEvent.setup();
    await screen.findByText("Initial list", { selector: "td" });
    await user.type(screen.getByLabelText("Search tickets"), "ab");
    expect(await screen.findByText("Newer rows", { selector: "td" })).toBeInTheDocument();
    failOlder(new Error("late failure"));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText("Newer rows", { selector: "td" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Staff Ticket Queue: states", () => {
  // UI-14 / FR-10
  it("shows loading before the first load only, then keeps the toolbar mounted while later requests are in flight", async () => {
    let release: (r: StaffQueueResult) => void = () => {};
    openQueue("/staff/tickets", (p) =>
      p.search ? new Promise((resolve) => (release = resolve)) : Promise.resolve(result([row()])),
    );
    const user = userEvent.setup();
    const search = await screen.findByLabelText("Search tickets");
    await screen.findByRole("table");

    await user.type(search, "x");
    // Loading again, but it is the same input element: it was never unmounted, so focus and
    // the text being typed survive a reload.
    expect(await screen.findByRole("status")).toHaveTextContent("Loading");
    expect(screen.getByLabelText("Search tickets")).toBe(search);
    expect(search).toHaveValue("x");
    release(result([row()]));
    await screen.findByRole("table");
    expect(screen.getByLabelText("Search tickets")).toBe(search);
  });

  it("shows only Loading, with no toolbar, before the very first response", async () => {
    let release: (r: StaffQueueResult) => void = () => {};
    openQueue("/staff/tickets", () => new Promise((resolve) => (release = resolve)));
    expect(await screen.findByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByLabelText("Search tickets")).not.toBeInTheDocument();
    release(result([row()]));
    expect(await screen.findByLabelText("Search tickets")).toBeInTheDocument();
  });

  it("shows a distinct empty state when the queue has no Tickets at all, still with the toolbar", async () => {
    openQueue("/staff/tickets", () => Promise.resolve(result([])));
    expect(await screen.findByText("No tickets in the queue yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Search tickets")).toBeInTheDocument();
    expect(screen.queryByText("No tickets match these filters.")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
  });

  it("shows a no-results state with Clear filters when a search or filter matches nothing", async () => {
    openQueue("/staff/tickets", (p) => Promise.resolve(p.search || p.status ? result([]) : result([row()])));
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.type(screen.getByLabelText("Search tickets"), "zzz");
    expect(await screen.findByText("No tickets match these filters.")).toBeInTheDocument();
    expect(screen.queryByText("No tickets in the queue yet.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search tickets")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByLabelText("Search tickets")).toHaveValue("");
    expect(lastCall().search).toBeUndefined();
  });

  it("clears every filter but keeps the chosen sort", async () => {
    openQueue("/staff/tickets?status=OPEN&owner=me&sort=itPriority&page=2");
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(lastCall()).toEqual({ sort: "itPriority", page: 1, pageSize: 10 }));
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("shows a failure with Retry and no stale rows, the toolbar still mounted, and recovers on Retry", async () => {
    let fail = false;
    openQueue("/staff/tickets", (p) => (fail && p.search ? Promise.reject(new Error("down")) : Promise.resolve(result([row()]))));
    const user = userEvent.setup();
    await screen.findByRole("table");

    fail = true;
    await user.type(screen.getByLabelText("Search tickets"), "x");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load the ticket queue.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("TKT-2026-000001")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search tickets")).toHaveValue("x");

    fail = false;
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failure with Retry, and no toolbar, when the very first load fails", async () => {
    let calls = 0;
    openQueue("/staff/tickets", () => (++calls === 1 ? Promise.reject(new Error("down")) : Promise.resolve(result([row()]))));
    const alert = await screen.findByRole("alert");
    expect(screen.queryByLabelText("Search tickets")).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("Staff Ticket Queue: owner markers", () => {
  // UI-29 / AC-40, AC-41, BR-56, BR-59
  it("keeps an inactive owner's name, marks them in words and with a badge, and leaves a healthy owner unmarked", async () => {
    openQueue("/staff/tickets", () =>
      Promise.resolve(
        result([
          row({ id: 1, summary: "Healthy assignment" }),
          row({ id: 2, summary: "Inactive owner", ownerId: 9, ownerName: "Sunisa Kaewmanee", ownerIsActive: false, ownerEligible: false }),
          row({ id: 3, summary: "Demoted owner", ownerId: 10, ownerName: "Somsak Rattanakosin", ownerIsActive: true, ownerEligible: false }),
          row({ id: 4, summary: "Nobody", ownerId: null, ownerName: null, ownerIsActive: null, ownerEligible: null }),
        ]),
      ),
    );
    const rows = await within(await screen.findByRole("table")).findAllByRole("button");

    const healthy = within(rows[0]);
    expect(healthy.getByText("Pimchanok Somboon")).toBeInTheDocument();
    expect(healthy.queryByText("Needs new owner")).not.toBeInTheDocument();
    expect(healthy.queryByText(/inactive|not IT Staff/)).not.toBeInTheDocument();

    const inactive = within(rows[1]);
    expect(inactive.getByText(/Sunisa Kaewmanee/)).toBeInTheDocument();
    expect(inactive.getByText("(inactive)")).toBeInTheDocument();
    expect(inactive.getByText("Needs new owner")).toHaveClass("zg-badge", "zg-badge-needs-owner");

    const demoted = within(rows[2]);
    expect(demoted.getByText(/Somsak Rattanakosin/)).toBeInTheDocument();
    expect(demoted.getByText("(not IT Staff)")).toBeInTheDocument();
    expect(demoted.getByText("Needs new owner")).toBeInTheDocument();

    // A Ticket with no owner is Unassigned, not "Needs new owner": that badge is for an owner
    // who is no longer eligible.
    expect(within(rows[3]).getByText("Unassigned")).toBeInTheDocument();
    expect(within(rows[3]).queryByText("Needs new owner")).not.toBeInTheDocument();
  });

  it("marks an ineligible owner on the card list too", async () => {
    openQueue("/staff/tickets", () =>
      Promise.resolve(result([row({ ownerId: 9, ownerName: "Sunisa Kaewmanee", ownerIsActive: false, ownerEligible: false })])),
    );
    const card = within(await screen.findByLabelText("Tickets")).getByRole("button");
    expect(within(card).getByText("(inactive)")).toBeInTheDocument();
    expect(within(card).getByText("Needs new owner")).toBeInTheDocument();
  });

  it("offers Needs an owner and sends owner=needs-owner when it is chosen", async () => {
    openQueue();
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("Owner"), "Needs an owner");
    await waitFor(() => expect(lastCall().owner).toBe("needs-owner"));
    expect(screen.getByLabelText("Owner")).toHaveValue("needs-owner");
  });
});
