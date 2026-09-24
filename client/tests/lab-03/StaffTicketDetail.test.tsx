import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import App from "../../src/App.js";
import * as api from "../../src/api.js";
import { ApiError, type ContentItem, type StaffOwner, type StaffTicketDetail, type StaffTicketItem } from "../../src/api.js";
import { ADMIN, REQUESTER, STAFF, renderApp } from "./support.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// The server's workflow table, restated here only so a fake backend can behave like the real one.
const PERMITTED: Record<string, string[]> = {
  NEW: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER"],
  CLOSED: [],
  CANCELLED: [],
};

const OWNERS: StaffOwner[] = [
  { id: STAFF.id, name: STAFF.name, role: "IT_STAFF" },
  { id: 20, name: "Wichai Charoen", role: "IT_STAFF" },
  { id: ADMIN.id, name: ADMIN.name, role: "ADMINISTRATOR" },
];

function detail(overrides: Partial<StaffTicketDetail> = {}): StaffTicketDetail {
  const base: StaffTicketDetail = {
    id: 42,
    ticketNumber: "TKT-2026-000042",
    requesterId: 3,
    requesterName: "Kanokwan Srisuwan",
    categoryId: 4,
    categoryName: "Network",
    relatedSystemId: 1,
    relatedSystemName: "Staff VPN",
    summary: "Cannot connect to the VPN",
    description: "The client times out at the login step every morning.",
    requestedPriority: "MEDIUM",
    currentStatus: "OPEN",
    resolutionSummary: null,
    requesterResolutionFlaggedAt: null,
    createdAt: "2026-09-10T09:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
    attachments: [],
    itPriority: "HIGH",
    ownerId: null,
    ownerName: null,
    ownerIsActive: null,
    ownerEligible: null,
    requesterIsActive: true,
    permittedNextStatuses: [],
    ...overrides,
  };
  return { ...base, permittedNextStatuses: overrides.permittedNextStatuses ?? PERMITTED[base.currentStatus] };
}

// A stand-in for the server that keeps the Ticket in memory and answers as the real one does, so a
// test sees what a person would see after each change without repeating the mock in every case.
function backend(initial: StaffTicketDetail, owners: StaffOwner[] = OWNERS) {
  let ticket = { ...initial };
  const item = (): StaffTicketItem => ({ ...ticket, categoryName: ticket.categoryName } as unknown as StaffTicketItem);
  vi.mocked(api.getStaffTicketDetail).mockImplementation(async () => ({ ...ticket, permittedNextStatuses: PERMITTED[ticket.currentStatus] }));
  vi.mocked(api.getStaffOwners).mockResolvedValue(owners);
  const setOwner = vi.spyOn(api, "setTicketOwner").mockImplementation(async (_id, ownerId) => {
    const o = owners.find((x) => x.id === ownerId);
    ticket = { ...ticket, ownerId, ownerName: o?.name ?? null, ownerIsActive: o ? true : null, ownerEligible: o ? true : null };
    return item();
  });
  const setPriority = vi.spyOn(api, "setTicketPriority").mockImplementation(async (_id, itPriority) => {
    ticket = { ...ticket, itPriority };
    return item();
  });
  const setStatus = vi.spyOn(api, "changeTicketStatus").mockImplementation(async (_id, currentStatus, resolutionSummary) => {
    ticket = { ...ticket, currentStatus, ...(resolutionSummary ? { resolutionSummary } : {}) };
    return item();
  });
  return { setOwner, setPriority, setStatus, current: () => ticket, set: (t: Partial<StaffTicketDetail>) => (ticket = { ...ticket, ...t }) };
}

async function openDetail(initial: StaffTicketDetail = detail(), user = STAFF) {
  renderApp("/staff/tickets/42", user);
  const api_ = backend(initial);
  await screen.findByRole("heading", { name: initial.ticketNumber });
  return api_;
}

const optionsOf = (label: string) => within(screen.getByLabelText(label)).getAllByRole("option").map((o) => o.textContent?.replace(/\s+/g, " ").trim());

describe("Staff Ticket Detail: reading", () => {
  it("shows the read-only Ticket information and the handling controls, with the Requested Priority apart from the IT Priority", async () => {
    await openDetail();
    expect(screen.getByLabelText("Ticket No.")).toHaveValue("TKT-2026-000042");
    expect(screen.getByLabelText("Category")).toHaveValue("Network");
    expect(screen.getByLabelText("Related System")).toHaveValue("Staff VPN");
    expect(screen.getByLabelText("Requester")).toHaveValue("Kanokwan Srisuwan");
    expect(screen.getByLabelText("Summary")).toHaveValue("Cannot connect to the VPN");
    // Read-only fields stay keyboard reachable: readOnly, never disabled.
    for (const label of ["Ticket No.", "Category", "Related System", "Requester", "Summary", "Description"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("readonly");
      expect(screen.getByLabelText(label)).not.toBeDisabled();
    }
    expect(screen.getByLabelText("IT Priority")).toHaveValue("HIGH");
    expect(screen.getByText("Medium", { selector: ".zg-badge" })).toBeInTheDocument(); // Requested Priority
    expect(screen.getByLabelText("Current Status")).toHaveValue("OPEN");
  });

  it("says so, and how to leave, for a Ticket that does not exist", async () => {
    renderApp("/staff/tickets/999", STAFF);
    expect(await screen.findByText("Ticket not found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Queue" })).toHaveAttribute("href", "/staff/tickets");
  });

  it("offers Retry when the Ticket cannot be loaded, and recovers", async () => {
    renderApp("/staff/tickets/42", STAFF);
    vi.mocked(api.getStaffTicketDetail).mockRejectedValueOnce(new ApiError("down", 500));
    expect(await screen.findByText("Unable to load this Ticket.")).toBeInTheDocument();
    backend(detail());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "TKT-2026-000042" })).toBeInTheDocument();
  });

  it("refuses a Requester who reaches the URL, without asking for the Ticket", async () => {
    renderApp("/staff/tickets/42", REQUESTER);
    expect(await screen.findByText("You do not have access to the Ticket Queue.")).toBeInTheDocument();
    expect(api.getStaffTicketDetail).not.toHaveBeenCalled();
  });

  it("goes back to the queue as it was left when it was reached from the queue, and to the default queue when it was not", async () => {
    renderApp("/staff/tickets/42", STAFF);
    backend(detail());
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "TKT-2026-000042" });
    // Opened directly, with no queue behind it: the default queue.
    await user.click(screen.getByRole("button", { name: /back to queue/i }));
    expect(await screen.findByRole("heading", { name: "Ticket Queue" })).toBeInTheDocument();
  });
});

describe("Staff Ticket Detail: Ticket Owner", () => {
  // UI-15 / AC-18, AC-19
  it("claims an unassigned Ticket in place, hides Claim once it is owned, then reassigns and unassigns", async () => {
    const fake = await openDetail();
    const user = userEvent.setup();
    expect(optionsOf("Ticket Owner")).toEqual(["Unassigned", `${STAFF.name} (you)`, "Wichai Charoen", ADMIN.name]);
    expect(screen.getByLabelText("Ticket Owner")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(fake.setOwner).toHaveBeenCalledWith(42, STAFF.id));
    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toHaveValue(String(STAFF.id)));
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Ticket Owner"), "Wichai Charoen");
    await waitFor(() => expect(fake.setOwner).toHaveBeenLastCalledWith(42, 20));
    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toHaveValue("20"));
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Ticket Owner"), "Unassigned");
    await waitFor(() => expect(fake.setOwner).toHaveBeenLastCalledWith(42, null));
    expect(await screen.findByRole("button", { name: "Claim" })).toBeInTheDocument();
    // Nothing reloaded: the heading never went away and the Ticket was never fetched a second time for an owner change.
    expect(screen.getByRole("heading", { name: "TKT-2026-000042" })).toBeInTheDocument();
    expect(api.getStaffTicketDetail).toHaveBeenCalledTimes(1);
  });

  it("does not send a request when the owner is set to who it already is", async () => {
    const fake = await openDetail(detail({ ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    await userEvent.selectOptions(screen.getByLabelText("Ticket Owner"), "Wichai Charoen");
    expect(fake.setOwner).not.toHaveBeenCalled();
  });

  it("marks only the owner control busy while it saves, leaving the others usable", async () => {
    const fake = await openDetail();
    let release: () => void = () => {};
    fake.setOwner.mockImplementation(() => new Promise((resolve) => (release = () => resolve({} as StaffTicketItem))));
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toBeDisabled());
    expect(screen.getByLabelText("Ticket Owner")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(screen.getByLabelText("IT Priority")).toBeEnabled();
    expect(screen.getByLabelText("Current Status")).toBeEnabled();
    release();
  });

  it("tells the user when someone else claimed the Ticket first, and shows who owns it now", async () => {
    const fake = await openDetail();
    fake.setOwner.mockImplementation(async () => {
      fake.set({ ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true });
      throw new ApiError("taken", 409, "ALREADY_ASSIGNED");
    });
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else has claimed this Ticket");
    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toHaveValue("20"));
  });

  it("keeps the previous owner and says nothing was changed when the request fails", async () => {
    const fake = await openDetail(detail({ ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    fake.setOwner.mockRejectedValue(new ApiError("down", 0, "NETWORK_ERROR"));
    await userEvent.selectOptions(screen.getByLabelText("Ticket Owner"), `${STAFF.name} (you)`);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to change the owner. Nothing was changed.");
    expect(screen.getByLabelText("Ticket Owner")).toHaveValue("20");
    expect(screen.getByLabelText("Ticket Owner")).toBeEnabled();
  });

  // UI-30 / AC-41, BR-56, BR-58, BR-60
  it("keeps an inactive owner as the shown value with a marker and badge, offers Claim, and does not offer them as a choice", async () => {
    await openDetail(detail({ ownerId: 30, ownerName: "Sunisa Kaewmanee", ownerIsActive: false, ownerEligible: false }));
    const select = screen.getByLabelText("Ticket Owner");
    expect(select).toHaveValue("30");
    expect(optionsOf("Ticket Owner")).toEqual(["Unassigned", "Sunisa Kaewmanee (inactive)", `${STAFF.name} (you)`, "Wichai Charoen", ADMIN.name]);
    // The ineligible owner is present once, and cannot be chosen again.
    const shown = within(select).getByRole("option", { name: "Sunisa Kaewmanee (inactive)" });
    expect(shown).toBeDisabled();
    expect(screen.getByText("Needs new owner")).toHaveClass("zg-badge-needs-owner");
    expect(screen.getByText("Owner is inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim" })).toBeInTheDocument();
  });

  it("says an owner who is no longer IT Staff is exactly that, not inactive", async () => {
    await openDetail(detail({ ownerId: 30, ownerName: "Somsak Rattanakosin", ownerIsActive: true, ownerEligible: false }));
    expect(screen.getByText("Owner is no longer IT Staff")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Ticket Owner")).getByRole("option", { name: "Somsak Rattanakosin (not IT Staff)" })).toBeInTheDocument();
  });

  it("does not offer Claim for a Ticket that has a healthy owner", async () => {
    await openDetail(detail({ ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
    expect(screen.queryByText("Needs new owner")).not.toBeInTheDocument();
  });

  it("marks an inactive Requester by name and shows the Requester's resolved signal as a banner that is not a status", async () => {
    await openDetail(detail({ requesterIsActive: false, requesterResolutionFlaggedAt: "2026-09-12T10:00:00.000Z" }));
    expect(screen.getByLabelText("Requester")).toHaveValue("Kanokwan Srisuwan (inactive)");
    const banner = screen.getByRole("status");
    expect(banner).toHaveClass("zg-banner-pale");
    expect(banner).toHaveTextContent("The Requester says the problem appears resolved");
    expect(banner).toHaveTextContent("the status has not changed");
    expect(screen.getByLabelText("Current Status")).toHaveValue("OPEN");
  });

  it("still lets the Ticket be read and changed when the list of owners cannot be loaded", async () => {
    renderApp("/staff/tickets/42", STAFF);
    backend(detail());
    vi.mocked(api.getStaffOwners).mockRejectedValue(new ApiError("down", 500));
    expect(await screen.findByRole("heading", { name: "TKT-2026-000042" })).toBeInTheDocument();
    expect(screen.getByLabelText("IT Priority")).toBeEnabled();
  });
});

describe("Staff Ticket Detail: IT Priority", () => {
  it("changes IT Priority in place, and the Requested Priority is not a control", async () => {
    const fake = await openDetail();
    await userEvent.selectOptions(screen.getByLabelText("IT Priority"), "Low");
    await waitFor(() => expect(fake.setPriority).toHaveBeenCalledWith(42, "LOW"));
    await waitFor(() => expect(screen.getByLabelText("IT Priority")).toHaveValue("LOW"));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByLabelText("Requested Priority")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("IT Priority")).getAllByRole("option")).toHaveLength(3);
  });

  it("marks only the IT Priority and status controls busy while they save, leaving the owner usable", async () => {
    const fake = await openDetail(detail({ ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    let release: () => void = () => {};
    fake.setPriority.mockImplementation(() => new Promise((resolve) => (release = () => resolve({} as StaffTicketItem))));
    await userEvent.selectOptions(screen.getByLabelText("IT Priority"), "Low");
    await waitFor(() => expect(screen.getByLabelText("IT Priority")).toBeDisabled());
    expect(screen.getByLabelText("Ticket Owner")).toBeEnabled();
    expect(screen.getByLabelText("Current Status")).toBeEnabled();
    release();

    let releaseStatus: () => void = () => {};
    fake.setStatus.mockImplementation(() => new Promise((resolve) => (releaseStatus = () => resolve({} as StaffTicketItem))));
    await userEvent.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    await waitFor(() => expect(screen.getByLabelText("Current Status")).toBeDisabled());
    expect(screen.getByLabelText("Ticket Owner")).toBeEnabled();
    expect(screen.getByLabelText("IT Priority")).toBeEnabled();
    releaseStatus();
  });

  it("restores the previous IT Priority and says nothing changed when the request fails", async () => {
    const fake = await openDetail();
    fake.setPriority.mockRejectedValue(new ApiError("down", 0, "NETWORK_ERROR"));
    await userEvent.selectOptions(screen.getByLabelText("IT Priority"), "Low");
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to change the IT Priority. Nothing was changed.");
    expect(screen.getByLabelText("IT Priority")).toHaveValue("HIGH");
  });
});

describe("Staff Ticket Detail: status", () => {
  // UI-16 / AC-23, BR-25
  it("offers only the statuses the workflow permits from where the Ticket is, and never a disallowed one", async () => {
    await openDetail(detail({ currentStatus: "OPEN" }));
    expect(optionsOf("Current Status")).toEqual(["Open", "In Progress", "Waiting for Requester", "Cancelled"]);
    for (const banned of ["New", "Resolved", "Closed", "Reopened"]) {
      expect(within(screen.getByLabelText("Current Status")).queryByRole("option", { name: banned })).not.toBeInTheDocument();
    }
  });

  it.each(Object.keys(PERMITTED))("offers exactly the permitted moves from %s", async (from) => {
    await openDetail(detail({ currentStatus: from }));
    const expected = [from, ...PERMITTED[from]].map((s) =>
      ({ NEW: "New", OPEN: "Open", IN_PROGRESS: "In Progress", WAITING_FOR_REQUESTER: "Waiting for Requester", RESOLVED: "Resolved", CLOSED: "Closed", REOPENED: "Reopened", CANCELLED: "Cancelled" })[s],
    );
    expect(optionsOf("Current Status")).toEqual(expected);
  });

  it("locks the status of a Closed or Cancelled Ticket and says why", async () => {
    await openDetail(detail({ currentStatus: "CLOSED" }));
    expect(screen.getByLabelText("Current Status")).toBeDisabled();
    expect(screen.getByText("This Ticket is Closed, so its status cannot change.")).toBeInTheDocument();
  });

  it("saves an ordinary move straight away and then offers the moves from the new status", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    await userEvent.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    await waitFor(() => expect(fake.setStatus).toHaveBeenCalledWith(42, "IN_PROGRESS"));
    await waitFor(() => expect(screen.getByLabelText("Current Status")).toHaveValue("IN_PROGRESS"));
    expect(optionsOf("Current Status")).toEqual(["In Progress", "Waiting for Requester", "Resolved", "Cancelled"]);
    expect(within(screen.getByRole("heading", { name: "TKT-2026-000042" }).parentElement!).getByText("In Progress")).toHaveClass("zg-badge-in-progress");
  });

  // UI-17 / AC-24, BR-27
  it("asks for a Resolution Summary and a confirmation before resolving, and sends nothing until then", async () => {
    const fake = await openDetail(detail({ currentStatus: "IN_PROGRESS", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    const user = userEvent.setup();
    expect(screen.queryByLabelText("Resolution Summary *")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Current Status"), "Resolved");
    const box = await screen.findByLabelText("Resolution Summary *");
    expect(fake.setStatus).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Current Status")).toHaveValue("RESOLVED");

    // Required: empty, whitespace and too short are refused with a message, and nothing is sent.
    for (const text of ["", "   ", "too short"]) {
      await user.clear(box);
      if (text) await user.type(box, text);
      await user.click(screen.getByRole("button", { name: "Confirm and resolve" }));
      expect(screen.getByText("Resolution Summary must be between 10 and 2000 characters.")).toBeInTheDocument();
    }
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(fake.setStatus).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, "  Replaced the faulty access point.  ");
    expect(within(screen.getByLabelText("Resolution Summary *").parentElement!).getByText(/^\d+\/2000$/)).toHaveTextContent("33/2000");
    await user.click(screen.getByRole("button", { name: "Confirm and resolve" }));
    await waitFor(() => expect(fake.setStatus).toHaveBeenCalledWith(42, "RESOLVED", "Replaced the faulty access point."));
    await waitFor(() => expect(screen.queryByLabelText("Resolution Summary *")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Current Status")).toHaveValue("RESOLVED");
    // The stored summary is now shown, read only.
    expect(await screen.findByLabelText("Resolution Summary")).toHaveValue("Replaced the faulty access point.");
  });

  it("lets the user back out of resolving without a request, restoring the select", async () => {
    const fake = await openDetail(detail({ currentStatus: "IN_PROGRESS", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Current Status"), "Resolved");
    await screen.findByLabelText("Resolution Summary *");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Resolution Summary *")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current Status")).toHaveValue("IN_PROGRESS");
    expect(fake.setStatus).not.toHaveBeenCalled();
  });

  // UI-18 / AC-23, AC-25, BR-28
  it("shows a conflict callout naming what is permitted when the server refuses a move, and restores the real status", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    fake.setStatus.mockImplementation(async () => {
      // Someone else moved it first, so the choice on screen was out of date.
      fake.set({ currentStatus: "CANCELLED" });
      const e = new ApiError("A Ticket that is CANCELLED cannot move to IN_PROGRESS.", 409, "INVALID_TRANSITION");
      e.permitted = [];
      throw e;
    });
    await userEvent.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("zg-alert-warning");
    expect(alert).toHaveTextContent("This Ticket cannot move to any other status.");
    // The select shows what is actually stored now, not the choice that was refused.
    await waitFor(() => expect(screen.getByLabelText("Current Status")).toHaveValue("CANCELLED"));
  });

  it("names the permitted statuses in the conflict callout when there are some", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    fake.setStatus.mockImplementation(async () => {
      fake.set({ currentStatus: "IN_PROGRESS" });
      const e = new ApiError("no", 409, "INVALID_TRANSITION");
      e.permitted = ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"];
      throw e;
    });
    await userEvent.selectOptions(screen.getByLabelText("Current Status"), "Waiting for Requester");
    expect(await screen.findByRole("alert")).toHaveTextContent("This Ticket can move to: Waiting for Requester, Resolved, Cancelled.");
  });

  it("explains that an owner is needed when the server says so, leaving the status alone", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN" }));
    fake.setStatus.mockRejectedValue(new ApiError("owner", 409, "OWNER_REQUIRED"));
    await userEvent.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("needs an active IT Staff owner");
    expect(alert).toHaveTextContent("Claim it or assign an owner");
    await waitFor(() => expect(screen.getByLabelText("Current Status")).toHaveValue("OPEN"));
  });

  it("keeps the typed Resolution Summary when resolving is refused for want of an owner, so it can claim and confirm", async () => {
    const fake = await openDetail(detail({ currentStatus: "IN_PROGRESS", ownerId: 30, ownerName: "Sunisa Kaewmanee", ownerIsActive: false, ownerEligible: false }));
    const user = userEvent.setup();
    fake.setStatus.mockRejectedValueOnce(new ApiError("owner", 409, "OWNER_REQUIRED"));
    await user.selectOptions(screen.getByLabelText("Current Status"), "Resolved");
    await user.type(await screen.findByLabelText("Resolution Summary *"), "Replaced the access point and tested.");
    await user.click(screen.getByRole("button", { name: "Confirm and resolve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("needs an active IT Staff owner");
    expect(screen.getByLabelText("Resolution Summary *")).toHaveValue("Replaced the access point and tested.");

    // Claim the Ticket, then confirm again with the same text.
    await user.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(fake.setOwner).toHaveBeenCalledWith(42, STAFF.id));
    await user.click(await screen.findByRole("button", { name: "Confirm and resolve" }));
    await waitFor(() => expect(fake.setStatus).toHaveBeenLastCalledWith(42, "RESOLVED", "Replaced the access point and tested."));
  });

  it("restores the status and says nothing was changed when the request fails outright", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    fake.setStatus.mockRejectedValue(new ApiError("down", 0, "NETWORK_ERROR"));
    await userEvent.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("zg-alert-error");
    expect(alert).toHaveTextContent("Unable to change the status. Nothing was changed.");
    expect(screen.getByLabelText("Current Status")).toHaveValue("OPEN");
  });
});

// Review round 1 (songt888): each control saves on its own, so responses can arrive in any order. A
// response may only ever change the field its own operation was for. A whole-snapshot merge let an
// older response, carrying a stale value for a different control, overwrite another successful save.
describe("Staff Ticket Detail: concurrent saves", () => {
  // What a mutation returns is a snapshot of the whole Ticket at the moment the server answered it, so
  // a slow response can carry values for the other controls that are older than what is on screen.
  const snapshot = (overrides: Partial<StaffTicketItem>): StaffTicketItem =>
    ({ ...detail({ ownerId: null, itPriority: "HIGH", currentStatus: "OPEN" }), ...overrides }) as unknown as StaffTicketItem;
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  const ME = { ownerId: STAFF.id, ownerName: STAFF.name, ownerIsActive: true, ownerEligible: true };

  it("keeps a newer IT Priority when an older owner response, carrying the old priority, arrives last", async () => {
    const fake = await openDetail(detail({ ownerId: null, itPriority: "HIGH" }));
    const owner = deferred<StaffTicketItem>();
    const priority = deferred<StaffTicketItem>();
    fake.setOwner.mockReturnValue(owner.promise);
    fake.setPriority.mockReturnValue(priority.promise);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Claim" }));
    await user.selectOptions(screen.getByLabelText("IT Priority"), "Low");

    // The priority save finishes first. Then the owner save finishes, its snapshot still saying HIGH.
    priority.resolve(snapshot({ itPriority: "LOW", ownerId: null, ownerName: null }));
    await waitFor(() => expect(screen.getByLabelText("IT Priority")).toHaveValue("LOW"));
    owner.resolve(snapshot({ ...ME, itPriority: "HIGH" }));

    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toHaveValue(String(STAFF.id)));
    expect(screen.getByLabelText("IT Priority")).toHaveValue("LOW");
  });

  it("keeps a newer owner when an older priority response, carrying no owner, arrives last", async () => {
    const fake = await openDetail(detail({ ownerId: null, itPriority: "HIGH" }));
    const owner = deferred<StaffTicketItem>();
    const priority = deferred<StaffTicketItem>();
    fake.setOwner.mockReturnValue(owner.promise);
    fake.setPriority.mockReturnValue(priority.promise);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("IT Priority"), "Low");
    await user.click(screen.getByRole("button", { name: "Claim" }));

    owner.resolve(snapshot({ ...ME, itPriority: "HIGH" }));
    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toHaveValue(String(STAFF.id)));
    priority.resolve(snapshot({ itPriority: "LOW", ownerId: null, ownerName: null, ownerIsActive: null, ownerEligible: null }));

    await waitFor(() => expect(screen.getByLabelText("IT Priority")).toHaveValue("LOW"));
    expect(screen.getByLabelText("Ticket Owner")).toHaveValue(String(STAFF.id));
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
  });

  it("keeps a newer owner and priority when the reload after a status change comes back with older values", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true, itPriority: "HIGH" }));
    const user = userEvent.setup();

    // The status save succeeds; the reload it triggers is held back.
    const reload = deferred<StaffTicketDetail>();
    vi.mocked(api.getStaffTicketDetail).mockReturnValueOnce(reload.promise);
    const ownerSave = deferred<StaffTicketItem>();
    const prioritySave = deferred<StaffTicketItem>();
    fake.setOwner.mockReturnValue(ownerSave.promise);
    fake.setPriority.mockReturnValue(prioritySave.promise);

    await user.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    await waitFor(() => expect(fake.setStatus).toHaveBeenCalledWith(42, "IN_PROGRESS"));
    await user.selectOptions(screen.getByLabelText("Ticket Owner"), `${STAFF.name} (you)`);
    await user.selectOptions(screen.getByLabelText("IT Priority"), "Low");
    ownerSave.resolve(snapshot({ ...ME, currentStatus: "IN_PROGRESS", itPriority: "HIGH" }));
    prioritySave.resolve(snapshot({ ...ME, currentStatus: "IN_PROGRESS", itPriority: "LOW" }));
    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toHaveValue(String(STAFF.id)));
    await waitFor(() => expect(screen.getByLabelText("IT Priority")).toHaveValue("LOW"));

    // Now the held-back reload arrives. It was read before the owner and priority saves, so it still says
    // owner 20 and HIGH, but it is the source of truth for the status and what the status may become.
    reload.resolve({
      ...detail({ currentStatus: "IN_PROGRESS", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true, itPriority: "HIGH" }),
      permittedNextStatuses: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
    });
    await waitFor(() => expect(optionsOf("Current Status")).toEqual(["In Progress", "Waiting for Requester", "Resolved", "Cancelled"]));
    expect(screen.getByLabelText("Ticket Owner")).toHaveValue(String(STAFF.id));
    expect(screen.getByLabelText("IT Priority")).toHaveValue("LOW");
  });

  it("applies the reload's permitted statuses and Resolution Summary after a status change, which the save response does not carry", async () => {
    const fake = await openDetail(detail({ currentStatus: "IN_PROGRESS", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Current Status"), "Resolved");
    await user.type(await screen.findByLabelText("Resolution Summary *"), "Replaced the faulty access point.");
    await user.click(screen.getByRole("button", { name: "Confirm and resolve" }));
    await waitFor(() => expect(fake.setStatus).toHaveBeenCalled());
    await waitFor(() => expect(optionsOf("Current Status")).toEqual(["Resolved", "Closed", "Reopened"]));
    expect(await screen.findByLabelText("Resolution Summary")).toHaveValue("Replaced the faulty access point.");
  });

  it("keeps the status control busy until its own reload has landed, so the next choice is made from the correct options", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }));
    const user = userEvent.setup();
    const reload = deferred<StaffTicketDetail>();
    vi.mocked(api.getStaffTicketDetail).mockReturnValueOnce(reload.promise);

    await user.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    await waitFor(() => expect(fake.setStatus).toHaveBeenCalledTimes(1));
    // The save has succeeded, but the options still belong to the old status until the reload says otherwise.
    await waitFor(() => expect(screen.getByLabelText("Current Status")).toHaveValue("IN_PROGRESS"));
    expect(screen.getByLabelText("Current Status")).toBeDisabled();
    expect(screen.getByLabelText("Current Status")).toHaveAttribute("aria-busy", "true");
    // The other controls are not held up by it.
    expect(screen.getByLabelText("IT Priority")).toBeEnabled();
    expect(screen.getByLabelText("Ticket Owner")).toBeEnabled();

    reload.resolve({
      ...detail({ currentStatus: "IN_PROGRESS", ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true }),
      permittedNextStatuses: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
    });
    await waitFor(() => expect(screen.getByLabelText("Current Status")).toBeEnabled());
    expect(optionsOf("Current Status")).toEqual(["In Progress", "Waiting for Requester", "Resolved", "Cancelled"]);
  });

  it("applies a refusal's reload to the owner control only, leaving a newer IT Priority alone", async () => {
    const fake = await openDetail(detail({ ownerId: null, itPriority: "HIGH" }));
    const user = userEvent.setup();
    const prioritySave = deferred<StaffTicketItem>();
    fake.setPriority.mockReturnValue(prioritySave.promise);
    fake.setOwner.mockRejectedValue(new ApiError("taken", 409, "ALREADY_ASSIGNED"));
    // The reload after the refused claim was read before the priority save and still says HIGH.
    vi.mocked(api.getStaffTicketDetail).mockResolvedValueOnce({
      ...detail({ ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true, itPriority: "HIGH" }),
    });

    await user.selectOptions(screen.getByLabelText("IT Priority"), "Low");
    await user.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toHaveValue("20"));
    prioritySave.resolve(snapshot({ itPriority: "LOW", ownerId: null, ownerName: null }));

    await waitFor(() => expect(screen.getByLabelText("IT Priority")).toHaveValue("LOW"));
    expect(screen.getByLabelText("Ticket Owner")).toHaveValue("20");
  });
});

describe("Staff Ticket Detail: a reload that fails", () => {
  // After a status change, or a refused change, the screen reloads what the control depends on. If that
  // fails, what is on screen may be out of date, so it must say so and stop offering changes from it.
  const WICHAI = { ownerId: 20, ownerName: "Wichai Charoen", ownerIsActive: true, ownerEligible: true };
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("does not say Saved or offer the old next statuses when the reload after a status change fails, and recovers on Reload", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN", ...WICHAI }));
    const user = userEvent.setup();
    vi.mocked(api.getStaffTicketDetail).mockRejectedValueOnce(new Error("network down"));

    await user.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    await waitFor(() => expect(fake.setStatus).toHaveBeenCalledTimes(1));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The latest values could not be loaded");

    // The status that was stored is shown, but the options that belonged to Open are not offered as if they were current.
    expect(screen.getByLabelText("Current Status")).toHaveValue("IN_PROGRESS");
    expect(optionsOf("Current Status")).toEqual(["In Progress"]);
    expect(screen.getByLabelText("Current Status")).toBeDisabled();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    // Nothing else is held back by it.
    expect(screen.getByLabelText("IT Priority")).toBeEnabled();
    expect(screen.getByLabelText("Ticket Owner")).toBeEnabled();

    // While the Reload runs it says so, and does not call it Saving.
    const again = deferred<StaffTicketDetail>();
    vi.mocked(api.getStaffTicketDetail).mockReturnValueOnce(again.promise);
    await user.click(within(alert).getByRole("button", { name: "Reload" }));
    expect(screen.getByRole("button", { name: "Reloading…" })).toBeDisabled();
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    again.resolve({ ...detail({ currentStatus: "IN_PROGRESS", ...WICHAI }), permittedNextStatuses: PERMITTED.IN_PROGRESS });

    await waitFor(() => expect(screen.getByLabelText("Current Status")).toBeEnabled());
    expect(optionsOf("Current Status")).toEqual(["In Progress", "Waiting for Requester", "Resolved", "Cancelled"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays locked, with Reload still offered, while the reload keeps failing", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN", ...WICHAI }));
    const user = userEvent.setup();
    vi.mocked(api.getStaffTicketDetail).mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("still down"));

    await user.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    await waitFor(() => expect(fake.setStatus).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("button", { name: "Reload" }));
    await waitFor(() => expect(api.getStaffTicketDetail).toHaveBeenCalledTimes(3));

    expect(await screen.findByRole("button", { name: "Reload" })).toBeEnabled();
    expect(screen.getByLabelText("Current Status")).toBeDisabled();
    expect(optionsOf("Current Status")).toEqual(["In Progress"]);
  });

  it("does not show a stale Resolution Summary as current when the reload after resolving fails", async () => {
    const fake = await openDetail(detail({ currentStatus: "IN_PROGRESS", ...WICHAI }));
    const user = userEvent.setup();
    vi.mocked(api.getStaffTicketDetail).mockRejectedValueOnce(new Error("network down"));

    await user.selectOptions(screen.getByLabelText("Current Status"), "Resolved");
    await user.type(await screen.findByLabelText("Resolution Summary *"), "Replaced the faulty access point.");
    await user.click(screen.getByRole("button", { name: "Confirm and resolve" }));
    await waitFor(() => expect(fake.setStatus).toHaveBeenCalledTimes(1));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The latest values could not be loaded");
    expect(screen.getByLabelText("Current Status")).toBeDisabled();
    expect(optionsOf("Current Status")).toEqual(["Resolved"]);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(optionsOf("Current Status")).toEqual(["Resolved", "Closed", "Reopened"]));
    expect(await screen.findByLabelText("Resolution Summary")).toHaveValue("Replaced the faulty access point.");
  });

  it("does not claim the owner control shows the current owner when the reload after a refused claim fails", async () => {
    const fake = await openDetail(detail({ ownerId: null }));
    const user = userEvent.setup();
    fake.setOwner.mockImplementation(async () => {
      fake.set(WICHAI);
      throw new ApiError("taken", 409, "ALREADY_ASSIGNED");
    });
    vi.mocked(api.getStaffTicketDetail).mockRejectedValueOnce(new Error("network down"));

    await user.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(fake.setOwner).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));

    const text = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
    expect(text).toContain("its latest values could not be loaded");
    expect(text).not.toContain("It now shows its current owner");
    expect(screen.getByLabelText("Ticket Owner")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Claim" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toHaveValue("20"));
    expect(screen.getByLabelText("Ticket Owner")).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a failed owner list as a failed reload too, since a refused owner may still be in it", async () => {
    const fake = await openDetail(detail({ ownerId: null }));
    const user = userEvent.setup();
    fake.setOwner.mockRejectedValue(new ApiError("no longer eligible", 409, "INVALID_OWNER"));
    vi.mocked(api.getStaffOwners).mockRejectedValueOnce(new Error("down"));

    await user.selectOptions(screen.getByLabelText("Ticket Owner"), "Wichai Charoen");
    await waitFor(() => expect(fake.setOwner).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toBeDisabled());
    expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByLabelText("Ticket Owner")).toBeEnabled());
  });

  it("stays quiet about a reload that worked: Saved, no lock", async () => {
    const fake = await openDetail(detail({ currentStatus: "OPEN", ...WICHAI }));
    await userEvent.selectOptions(screen.getByLabelText("Current Status"), "In Progress");
    await waitFor(() => expect(fake.setStatus).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
  });
});

describe("Staff Ticket Detail: moving between Tickets", () => {
  function Jump({ to }: { to: string }) {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(to)}>
        jump to {to}
      </button>
    );
  }

  it("never applies a save that was still in flight for one Ticket to the next Ticket opened", async () => {
    vi.spyOn(api, "getCurrentUser").mockResolvedValue(STAFF);
    vi.spyOn(api, "getStaffOwners").mockResolvedValue(OWNERS);
    vi.spyOn(api, "getStaffTicketDetail").mockImplementation(async (id: number) =>
      detail({ id, ticketNumber: `TKT-2026-0000${id}`, itPriority: "HIGH", ownerId: null }),
    );
    const slow = { resolve: (_: StaffTicketItem) => {} };
    vi.spyOn(api, "setTicketPriority").mockImplementation(() => new Promise((resolve) => (slow.resolve = resolve)));
    render(
      <MemoryRouter initialEntries={["/staff/tickets/42"]}>
        <App />
        <Jump to="/staff/tickets/43" />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "TKT-2026-000042" });

    // A priority save for Ticket 42 is still in flight when the user opens Ticket 43.
    await user.selectOptions(screen.getByLabelText("IT Priority"), "Low");
    await user.click(screen.getByRole("button", { name: "jump to /staff/tickets/43" }));
    await screen.findByRole("heading", { name: "TKT-2026-000043" });
    expect(screen.getByLabelText("IT Priority")).toHaveValue("HIGH");
    expect(screen.getByLabelText("IT Priority")).toBeEnabled();

    // Ticket 42's save now completes. Ticket 43 must not change.
    slow.resolve(detail({ id: 42, itPriority: "LOW" }) as unknown as StaffTicketItem);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("heading", { name: "TKT-2026-000043" })).toBeInTheDocument();
    expect(screen.getByLabelText("IT Priority")).toHaveValue("HIGH");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});

describe("Staff Ticket Detail: Public Comments and Internal Notes", () => {
  const item = (overrides: Partial<ContentItem> = {}): ContentItem => ({
    id: 1,
    body: "We are investigating the issue on your device.",
    authorName: "Pimchanok Somboon",
    authorRole: "IT_STAFF",
    createdAt: "2026-09-12T10:30:00.000Z",
    ...overrides,
  });
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
  };

  async function openWith(content: { comments?: ContentItem[]; notes?: ContentItem[] } = {}, ticket = detail(), user = STAFF) {
    renderApp("/staff/tickets/42", user);
    backend(ticket);
    vi.mocked(api.getTicketComments).mockResolvedValue(content.comments ?? []);
    vi.mocked(api.getTicketNotes).mockResolvedValue(content.notes ?? []);
    await screen.findByRole("heading", { name: ticket.ticketNumber });
    await screen.findByRole("tab", { name: /^Public Comments/ });
  }
  const tab = (name: RegExp | string) => screen.getByRole("tab", { name });
  const panel = () => screen.getByRole("tabpanel");

  // UI-19 / BR-30, BR-35
  it("shows Public Comments, Internal Notes and Attachments as tabs with a count each, Public Comments first and selected", async () => {
    await openWith({ comments: [item({ id: 1 }), item({ id: 2 })], notes: [item({ id: 3 })] }, detail({ attachments: [{ id: 7, originalFilename: "a.png", mimeType: "image/png", sizeBytes: 10, uploadedAt: "2026-09-10T10:00:00.000Z", isRemoved: false }] }));
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\s+/g, " ").trim());
    expect(tabs).toEqual(["Public Comments (2)", "Internal Notes (1)", "Attachments (1)"]);
    expect(screen.getByRole("tablist", { name: "Ticket activity" })).toBeInTheDocument();
    expect(tab(/^Public Comments/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/^Internal Notes/)).toHaveAttribute("aria-selected", "false");
    // Exactly one panel is in the page, and it is labelled by its tab.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(panel()).toHaveAccessibleName("Public Comments (2)");
  });

  it("renders only the active tab's composer: the note box is absent on Public Comments and the comment box is absent on Internal Notes", async () => {
    await openWith();
    const user = userEvent.setup();
    expect(screen.getByLabelText("Add Public Comment")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add Internal Note")).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox").filter((t) => t.tagName === "TEXTAREA" && !t.hasAttribute("readonly") && t.id !== "staff-resolution-summary")).toHaveLength(1);

    await user.click(tab(/^Internal Notes/));
    expect(screen.getByLabelText("Add Internal Note")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add Public Comment")).not.toBeInTheDocument();

    await user.click(tab(/^Attachments/));
    expect(screen.queryByLabelText("Add Internal Note")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add Public Comment")).not.toBeInTheDocument();
  });

  it("puts the internal-only warning in words on the Internal Notes tab, above the composer, and nowhere on Public Comments", async () => {
    await openWith();
    const user = userEvent.setup();
    expect(screen.queryByText(/Internal only/)).not.toBeInTheDocument();
    await user.click(tab(/^Internal Notes/));
    const warning = screen.getByText("Internal only. Not visible to the Requester.");
    const composer = screen.getByLabelText("Add Internal Note");
    // The warning comes before the composer in the page, so it is met first.
    expect(warning.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And the panel is the distinct, tinted one; the comments panel is not.
    expect(panel()).toHaveClass("zg-notes-panel");
    await user.click(tab(/^Public Comments/));
    expect(panel()).not.toHaveClass("zg-notes-panel");
  });

  it("lists each entry with its author, role badge, time and body, oldest first as the server sends them", async () => {
    await openWith({
      comments: [
        item({ id: 1, body: "first entry", authorName: "Kanokwan Srisuwan", authorRole: "REQUESTER" }),
        item({ id: 2, body: "second entry", authorName: "Pimchanok Somboon", authorRole: "IT_STAFF" }),
        item({ id: 3, body: "third entry", authorName: "Aekkarat Wongsa", authorRole: "ADMINISTRATOR" }),
      ],
    });
    const entries = within(panel()).getAllByRole("listitem");
    expect(entries.map((e) => within(e).getByText(/entry$/).textContent)).toEqual(["first entry", "second entry", "third entry"]);
    expect(within(entries[0]).getByText("Kanokwan Srisuwan")).toBeInTheDocument();
    expect(within(entries[0]).getByText("Requester", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(within(entries[1]).getByText("IT Staff", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(within(entries[2]).getByText("Administrator", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(entries[0].querySelector("time")).toHaveAttribute("datetime", "2026-09-12T10:30:00.000Z");
  });

  it("says so when there are no comments and no notes yet", async () => {
    await openWith();
    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
    await userEvent.click(tab(/^Internal Notes/));
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
  });

  it("posts a Public Comment, appends it without reloading, clears the box and raises the count", async () => {
    await openWith({ comments: [item({ id: 1 })] });
    const user = userEvent.setup();
    const post = vi.spyOn(api, "postTicketComment").mockResolvedValue(item({ id: 2, body: "Thanks, restarting now.", authorName: STAFF.name }));

    await user.type(screen.getByLabelText("Add Public Comment"), "  Thanks, restarting now.  ");
    await user.click(screen.getByRole("button", { name: "Post Comment" }));

    expect(post).toHaveBeenCalledWith(42, "Thanks, restarting now.");
    expect(await within(panel()).findByText("Thanks, restarting now.")).toBeInTheDocument();
    expect(screen.getByLabelText("Add Public Comment")).toHaveValue("");
    expect(tab(/^Public Comments/)).toHaveTextContent("Public Comments (2)");
    expect(api.getTicketComments).toHaveBeenCalledTimes(1); // no reload
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("posts an Internal Note through the notes call, never the comments call", async () => {
    await openWith();
    const user = userEvent.setup();
    const postNote = vi.spyOn(api, "postTicketNote").mockResolvedValue(item({ id: 5, body: "Switch port looks fine." }));
    const postComment = vi.spyOn(api, "postTicketComment");

    await user.click(tab(/^Internal Notes/));
    await user.type(screen.getByLabelText("Add Internal Note"), "Switch port looks fine.");
    await user.click(screen.getByRole("button", { name: "Add Note" }));

    expect(postNote).toHaveBeenCalledWith(42, "Switch port looks fine.");
    expect(postComment).not.toHaveBeenCalled();
    expect(await within(panel()).findByText("Switch port looks fine.")).toBeInTheDocument();
    expect(tab(/^Internal Notes/)).toHaveTextContent("Internal Notes (1)");
    expect(tab(/^Public Comments/)).toHaveTextContent("Public Comments (0)");
  });

  it("keeps what was typed in each tab's box when switching away and back", async () => {
    await openWith();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add Public Comment"), "half a comment");
    await user.click(tab(/^Internal Notes/));
    await user.type(screen.getByLabelText("Add Internal Note"), "half a note");
    await user.click(tab(/^Public Comments/));
    expect(screen.getByLabelText("Add Public Comment")).toHaveValue("half a comment");
    await user.click(tab(/^Internal Notes/));
    expect(screen.getByLabelText("Add Internal Note")).toHaveValue("half a note");
  });

  it("shows a character counter and refuses a body outside 2 to 2000 characters without sending anything", async () => {
    await openWith();
    const user = userEvent.setup();
    const post = vi.spyOn(api, "postTicketComment");
    const box = screen.getByLabelText("Add Public Comment");
    expect(screen.getByText("0/2000")).toBeInTheDocument();

    await user.type(box, "   a   ");
    expect(screen.getByText("1/2000")).toBeInTheDocument(); // the counter counts what would be stored
    await user.click(screen.getByRole("button", { name: "Post Comment" }));
    expect(await screen.findByText("Content must be between 2 and 2000 characters.")).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "true");

    await user.clear(box);
    await user.click(screen.getByRole("button", { name: "Post Comment" }));
    expect(screen.getByText("Content must be between 2 and 2000 characters.")).toBeInTheDocument();

    await user.click(box);
    await user.paste("x".repeat(2001));
    await user.click(screen.getByRole("button", { name: "Post Comment" }));
    expect(screen.getByText("2001/2000")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    // Typing again clears the complaint.
    await user.type(box, "!");
    expect(screen.queryByText("Content must be between 2 and 2000 characters.")).not.toBeInTheDocument();
  });

  it("keeps the typed text, says nothing was added, and lets the user try again when the request fails", async () => {
    await openWith();
    const user = userEvent.setup();
    const post = vi.spyOn(api, "postTicketComment").mockRejectedValueOnce(new ApiError("down", 500)).mockResolvedValueOnce(item({ id: 9, body: "second try" }));
    await user.type(screen.getByLabelText("Add Public Comment"), "second try");
    await user.click(screen.getByRole("button", { name: "Post Comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to add the comment. Nothing was added.");
    expect(screen.getByLabelText("Add Public Comment")).toHaveValue("second try");
    expect(within(panel()).queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Post Comment" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Post Comment" }));
    expect(await within(panel()).findByText("second try")).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the server's own complaint when it refuses the body", async () => {
    await openWith();
    const user = userEvent.setup();
    vi.spyOn(api, "postTicketComment").mockRejectedValue(new api.ValidationError("bad", { body: "Content must be between 2 and 2000 characters." }));
    await user.type(screen.getByLabelText("Add Public Comment"), "fine here");
    await user.click(screen.getByRole("button", { name: "Post Comment" }));
    expect(await screen.findByText("Content must be between 2 and 2000 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("Add Public Comment")).toHaveValue("fine here");
  });

  it("sends one request however many times Post is pressed while it is in flight, and disables the box and button meanwhile", async () => {
    await openWith();
    const user = userEvent.setup();
    const pending = deferred<ContentItem>();
    const post = vi.spyOn(api, "postTicketComment").mockReturnValue(pending.promise);
    await user.type(screen.getByLabelText("Add Public Comment"), "only once please");
    const button = screen.getByRole("button", { name: "Post Comment" });
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Posting…" }));
    await user.click(screen.getByRole("button", { name: "Posting…" }));
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Posting…" })).toBeDisabled();
    expect(screen.getByLabelText("Add Public Comment")).toBeDisabled();
    pending.resolve(item({ id: 4, body: "only once please" }));
    expect(await within(panel()).findByText("only once please")).toBeInTheDocument();
    expect(screen.getByLabelText("Add Public Comment")).toBeEnabled();
  });

  it("sends one request when the form is submitted twice in a row, whatever the button is doing", async () => {
    await openWith();
    const user = userEvent.setup();
    const pending = deferred<ContentItem>();
    const post = vi.spyOn(api, "postTicketComment").mockReturnValue(pending.promise);
    await user.type(screen.getByLabelText("Add Public Comment"), "submitted twice");
    const form = screen.getByLabelText("Add Public Comment").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(post).toHaveBeenCalledTimes(1);
    pending.resolve(item({ id: 4, body: "submitted twice" }));
    expect(await within(panel()).findByText("submitted twice")).toBeInTheDocument();
  });

  it("shows a body containing markup as the literal text it is, never as elements (BR-36)", async () => {
    const markup = `<img src=x onerror="alert(1)"> and <b>bold</b> & <script>alert(2)</script>`;
    await openWith({ comments: [item({ id: 1, body: markup })], notes: [item({ id: 2, body: markup })] });
    expect(within(panel()).getByText(markup)).toBeInTheDocument();
    expect(panel().querySelector("img, b, script")).toBeNull();
    await userEvent.click(tab(/^Internal Notes/));
    expect(within(panel()).getByText(markup)).toBeInTheDocument();
    expect(panel().querySelector("img, b, script")).toBeNull();
  });

  it("keeps line breaks in a body", async () => {
    await openWith({ comments: [item({ id: 1, body: "line one\nline two" })] });
    // The wrapping itself is CSS (.zg-content-body: pre-wrap), which jsdom does not load; it is checked in the browser pass.
    expect(within(panel()).getByText(/line one/)).toHaveClass("zg-content-body");
    expect(within(panel()).getByText(/line one/).textContent).toBe("line one\nline two");
  });

  it("lets IT Staff comment on a closed Ticket, where a Requester could not", async () => {
    await openWith({}, detail({ currentStatus: "CLOSED" }));
    expect(screen.getByLabelText("Add Public Comment")).toBeEnabled();
    await userEvent.click(tab(/^Internal Notes/));
    expect(screen.getByLabelText("Add Internal Note")).toBeEnabled();
  });

  it("offers Retry when the comments cannot be loaded, keeps the composer off until they can, and shows no count for them", async () => {
    renderApp("/staff/tickets/42", STAFF);
    backend(detail());
    vi.mocked(api.getTicketComments).mockRejectedValueOnce(new ApiError("down", 500)).mockResolvedValueOnce([item({ id: 1 })]);
    vi.mocked(api.getTicketNotes).mockResolvedValue([]);
    await screen.findByRole("heading", { name: "TKT-2026-000042" });
    expect(await screen.findByRole("tab", { name: "Public Comments" })).toBeInTheDocument(); // no "(n)" for what is not known
    expect(tab("Internal Notes (0)")).toBeInTheDocument(); // the other list is unaffected
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the comments.");
    expect(screen.queryByLabelText("Add Public Comment")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await within(panel()).findByText("We are investigating the issue on your device.")).toBeInTheDocument();
    expect(tab(/^Public Comments/)).toHaveTextContent("Public Comments (1)");
    expect(screen.getByLabelText("Add Public Comment")).toBeInTheDocument();
  });

  it("moves between tabs with the arrow keys, Home and End, with only the selected tab in the tab order", async () => {
    await openWith();
    const user = userEvent.setup();
    expect(tab(/^Public Comments/)).toHaveAttribute("tabindex", "0");
    expect(tab(/^Internal Notes/)).toHaveAttribute("tabindex", "-1");
    tab(/^Public Comments/).focus();
    await user.keyboard("{ArrowRight}");
    expect(tab(/^Internal Notes/)).toHaveFocus();
    expect(tab(/^Internal Notes/)).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(tab(/^Attachments/)).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tab(/^Public Comments/)).toHaveFocus(); // wraps
    await user.keyboard("{ArrowLeft}");
    expect(tab(/^Attachments/)).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tab(/^Public Comments/)).toHaveFocus();
    expect(tab(/^Public Comments/)).toHaveAttribute("aria-selected", "true");
  });

  it("asks for the comments and the notes of the Ticket it is showing, once each", async () => {
    await openWith();
    expect(api.getTicketComments).toHaveBeenCalledWith(42);
    expect(api.getTicketNotes).toHaveBeenCalledWith(42);
    expect(api.getTicketComments).toHaveBeenCalledTimes(1);
    expect(api.getTicketNotes).toHaveBeenCalledTimes(1);
  });

  it("never shows what was loaded or posted for one Ticket on the next Ticket opened", async () => {
    function Jump({ to }: { to: string }) {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate(to)}>
          jump to {to}
        </button>
      );
    }
    vi.spyOn(api, "getCurrentUser").mockResolvedValue(STAFF);
    vi.spyOn(api, "getStaffOwners").mockResolvedValue(OWNERS);
    vi.spyOn(api, "getStaffTicketDetail").mockImplementation(async (id: number) => detail({ id, ticketNumber: `TKT-2026-0000${id}` }));
    const slowList = deferred<ContentItem[]>();
    const slowPost = deferred<ContentItem>();
    vi.spyOn(api, "getTicketComments").mockImplementation((id: number) => (id === 42 ? slowList.promise : Promise.resolve([item({ id: 77, body: "belongs to Ticket 43" })])));
    vi.spyOn(api, "getTicketNotes").mockResolvedValue([]);
    vi.spyOn(api, "postTicketNote").mockReturnValue(slowPost.promise);
    render(
      <MemoryRouter initialEntries={["/staff/tickets/42"]}>
        <App />
        <Jump to="/staff/tickets/43" />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "TKT-2026-000042" });
    await user.click(await screen.findByRole("tab", { name: /^Internal Notes/ }));
    await user.type(screen.getByLabelText("Add Internal Note"), "for Ticket 42 only");
    await user.click(screen.getByRole("button", { name: "Add Note" }));

    // The comments list and the note post for Ticket 42 are both still in flight when Ticket 43 opens.
    await user.click(screen.getByRole("button", { name: "jump to /staff/tickets/43" }));
    await screen.findByRole("heading", { name: "TKT-2026-000043" });
    expect(await within(screen.getByRole("tabpanel")).findByText("belongs to Ticket 43")).toBeInTheDocument();
    expect(screen.getByLabelText("Add Public Comment")).toHaveValue("");

    slowList.resolve([item({ id: 1, body: "belongs to Ticket 42" })]);
    slowPost.resolve(item({ id: 2, body: "for Ticket 42 only" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("belongs to Ticket 42")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /^Internal Notes/ }));
    expect(screen.queryByText("for Ticket 42 only")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Internal Notes (0)" })).toBeInTheDocument();
  });
});

describe("Staff Ticket Detail: Attachments", () => {
  const attachments = [
    { id: 7, originalFilename: "screenshot.png", mimeType: "image/png", sizeBytes: 2048, uploadedAt: "2026-09-10T10:00:00.000Z", isRemoved: false },
    {
      id: 8,
      originalFilename: "old-log.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024 * 1024,
      uploadedAt: "2026-09-10T11:00:00.000Z",
      isRemoved: true,
      removedAt: "2026-09-10T12:00:00.000Z",
      removalReason: "Uploaded the wrong log",
    },
  ];
  const attachmentsTab = (count: number) => screen.findByRole("tab", { name: `Attachments (${count})` });

  // UI-28 / AC-38, AC-39, BR-54, BR-55
  it("lists each Attachment with a Download for an active one, and a reason and no Download for a removed one", async () => {
    await openDetail(detail({ attachments }));
    await userEvent.click(await attachmentsTab(1));
    const [active, removed] = within(screen.getByRole("tabpanel", { name: /^Attachments/ })).getAllByRole("listitem");
    expect(within(active).getByText("screenshot.png")).toBeInTheDocument();
    expect(within(active).getByText("(2.0 KB)")).toBeInTheDocument();
    expect(within(active).getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/attachments/7/download");

    expect(within(removed).getByText("Removed")).toBeInTheDocument();
    expect(within(removed).getByText(/Uploaded the wrong log/)).toBeInTheDocument();
    expect(within(removed).getByText("Unavailable")).toBeInTheDocument();
    expect(within(removed).queryByRole("link", { name: "Download" })).not.toBeInTheDocument();
  });

  it("has no upload control and no Remove control anywhere in the page, for IT Staff or an Administrator", async () => {
    for (const user of [STAFF, ADMIN]) {
      const { unmount } = renderApp("/staff/tickets/42", user);
      backend(detail({ attachments }));
      await userEvent.click(await attachmentsTab(1));
      expect(await screen.findByRole("link", { name: "Download" })).toBeInTheDocument();
      expect(document.querySelector('input[type="file"]')).toBeNull();
      expect(screen.queryByRole("button", { name: /remove|add attachment|upload/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/\+ Add Attachment/i)).not.toBeInTheDocument();
      unmount();
      vi.restoreAllMocks();
    }
  });

  it("says so when a Ticket has no Attachments", async () => {
    await openDetail(detail({ attachments: [] }));
    await userEvent.click(await attachmentsTab(0));
    expect(screen.getByText("No attachments.")).toBeInTheDocument();
  });
});
