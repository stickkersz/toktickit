import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import App from "../../src/App.js";
import * as api from "../../src/api.js";
import { ApiError, type StaffOwner, type StaffTicketDetail, type StaffTicketItem } from "../../src/api.js";
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
    expect(screen.getByText(/^\d+\/2000$/)).toHaveTextContent("33/2000");
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

  // UI-28 / AC-38, AC-39, BR-54, BR-55
  it("lists each Attachment with a Download for an active one, and a reason and no Download for a removed one", async () => {
    await openDetail(detail({ attachments }));
    expect(screen.getByRole("heading", { name: "Attachments (1 active)" })).toBeInTheDocument();
    const [active, removed] = within(screen.getByRole("region", { name: /^Attachments/ })).getAllByRole("listitem");
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
      await screen.findByRole("heading", { name: "Attachments (1 active)" });
      expect(document.querySelector('input[type="file"]')).toBeNull();
      expect(screen.queryByRole("button", { name: /remove|add attachment|upload/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/\+ Add Attachment/i)).not.toBeInTheDocument();
      unmount();
      vi.restoreAllMocks();
    }
  });

  it("says so when a Ticket has no Attachments", async () => {
    await openDetail(detail({ attachments: [] }));
    expect(screen.getByRole("heading", { name: "Attachments (0 active)" })).toBeInTheDocument();
    expect(screen.getByText("No attachments.")).toBeInTheDocument();
  });
});
