import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError, type StaffTicketDetail, type StaffTicketItem, type StatusHistory, type TicketDetail } from "../../src/api.js";
import { REQUESTER, STAFF, renderApp } from "../lab-03/support.js";

// Lab 4 ui-spec.md sections 9 and 10: the status control with the resolution gate, conflicts, and the
// Status History on both Ticket Details.

afterEach(() => {
  vi.restoreAllMocks();
});

const MOVES: Record<string, string[]> = {
  NEW: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

function detail(overrides: Partial<StaffTicketDetail> = {}): StaffTicketDetail {
  const status = overrides.currentStatus ?? "IN_PROGRESS";
  return {
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
    currentStatus: status,
    resolutionSummary: null,
    requesterResolutionFlaggedAt: null,
    createdAt: "2026-09-10T09:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
    attachments: [],
    itPriority: "HIGH",
    ownerId: STAFF.id,
    ownerName: STAFF.name,
    ownerIsActive: true,
    ownerEligible: true,
    requesterIsActive: true,
    permittedNextStatuses: MOVES[status],
    resolutionGate: { plannedActions: 0, completedActions: 1, canResolve: true },
    ...overrides,
  };
}

const history = (entries: Partial<StatusHistory["entries"][number]>[], earlierChangesUnrecorded = false): StatusHistory => ({
  entries: entries.map((e, i) => ({
    id: i + 1,
    fromStatus: null,
    toStatus: "NEW",
    changedBy: { id: 3, name: "Kanokwan Srisuwan" },
    changedAt: "2026-09-10T09:00:00.000Z",
    resolutionSummary: null,
    ...e,
  })),
  earlierChangesUnrecorded,
});

async function open(ticket: StaffTicketDetail) {
  renderApp("/staff/tickets/42", STAFF);
  vi.mocked(api.getStaffTicketDetail).mockResolvedValue(ticket);
  vi.mocked(api.getStaffOwners).mockResolvedValue([{ id: STAFF.id, name: STAFF.name, role: "IT_STAFF" }]);
  await screen.findByRole("heading", { name: "TKT-2026-000042" });
}
const statusSelect = () => screen.getByLabelText("Current Status");

describe("the resolution gate on the status control", () => {
  // UI-20 / AC-19, AC-20, FR-07
  it("explains a blocked Resolve next to the control, sends nothing, and opens Actions Taken from the link", async () => {
    await open(detail({ resolutionGate: { plannedActions: 2, completedActions: 1, canResolve: false } }));
    const move = vi.spyOn(api, "changeTicketStatus");
    // Resolved stays in the list.
    expect(within(statusSelect()).getByRole("option", { name: "Resolved" })).toBeInTheDocument();
    await userEvent.selectOptions(statusSelect(), "Resolved");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This ticket cannot be resolved yet: 2 planned actions are still open.");
    expect(move).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Resolution Summary/)).not.toBeInTheDocument();
    // History is the other tab that is not first; the link opens Actions Taken and focuses its tab.
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    await userEvent.click(within(alert).getByRole("button", { name: "Go to Actions Taken" }));
    const actionsTab = screen.getByRole("tab", { name: /^Actions Taken/ });
    expect(actionsTab).toHaveAttribute("aria-selected", "true");
    expect(actionsTab).toHaveFocus();
  });

  // UI-20 / AC-20
  it("says to record and complete an Action when none is Completed", async () => {
    await open(detail({ resolutionGate: { plannedActions: 0, completedActions: 0, canResolve: false } }));
    await userEvent.selectOptions(statusSelect(), "Resolved");
    expect(await screen.findByRole("alert")).toHaveTextContent("Record and complete at least one action before resolving.");
  });

  // UI-20 / BR-21: the server still refuses
  it("shows the gate sentence from the server's counts when the move itself is refused, and reloads the Ticket", async () => {
    await open(detail());
    vi.spyOn(api, "changeTicketStatus").mockRejectedValueOnce(Object.assign(new ApiError("x", 409, "ACTIONS_INCOMPLETE"), { plannedActions: 1 }));
    const reloads = vi.mocked(api.getStaffTicketDetail).mock.calls.length;
    await userEvent.selectOptions(statusSelect(), "Resolved");
    await userEvent.type(screen.getByLabelText(/Resolution Summary/), "Replaced the LAN cable; stable.");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and resolve" }));
    expect(await screen.findByText("This ticket cannot be resolved yet: 1 planned action is still open.")).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(api.getStaffTicketDetail).mock.calls.length).toBeGreaterThan(reloads));
  });
});

describe("conflicts and success", () => {
  // UI-21 / AC-22, BR-41
  it("names the new status on STATUS_CHANGED, reloads the moves, and drops a pending confirmation", async () => {
    await open(detail({ currentStatus: "OPEN" }));
    const move = vi.spyOn(api, "changeTicketStatus").mockRejectedValueOnce(Object.assign(new ApiError("x", 409, "STATUS_CHANGED"), { currentStatus: "IN_PROGRESS" }));
    vi.mocked(api.getStaffTicketDetail).mockResolvedValue(detail({ currentStatus: "IN_PROGRESS" }));
    await userEvent.selectOptions(statusSelect(), "Cancelled");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and cancel" }));
    expect(move).toHaveBeenCalledWith(42, "CANCELLED", undefined, "OPEN");
    expect(await screen.findByText("This ticket moved to In Progress while you were viewing it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm and cancel" })).not.toBeInTheDocument();
    await waitFor(() => expect((statusSelect() as HTMLSelectElement).value).toBe("IN_PROGRESS"));
    expect(within(statusSelect()).getByRole("option", { name: "Waiting for Requester" })).toBeInTheDocument();
  });

  // UI-21 / ui-spec section 10: a retry after a lost response
  it("reports a move as done when the Ticket is already in the status that was asked for", async () => {
    await open(detail({ currentStatus: "OPEN" }));
    vi.spyOn(api, "changeTicketStatus").mockRejectedValueOnce(Object.assign(new ApiError("x", 409, "STATUS_CHANGED"), { currentStatus: "IN_PROGRESS" }));
    vi.mocked(api.getStaffTicketDetail).mockResolvedValue(detail({ currentStatus: "IN_PROGRESS" }));
    await userEvent.selectOptions(statusSelect(), "In Progress");
    expect(await screen.findByText("Status updated.")).toBeInTheDocument();
    expect(screen.queryByText(/while you were viewing it/)).not.toBeInTheDocument();
  });

  // UI-22 / AC-27
  it("refreshes the badge, the moves, and the History after a move, and announces Status updated.", async () => {
    await open(detail({ currentStatus: "OPEN" }));
    vi.spyOn(api, "changeTicketStatus").mockResolvedValue({ ...detail({ currentStatus: "WAITING_FOR_REQUESTER" }) } as unknown as StaffTicketItem);
    vi.mocked(api.getStaffTicketDetail).mockResolvedValue(detail({ currentStatus: "WAITING_FOR_REQUESTER" }));
    const historyCalls = () => vi.mocked(api.getTicketHistory).mock.calls.length;
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(0));
    const before = historyCalls();
    await userEvent.selectOptions(statusSelect(), "Waiting for Requester");
    const confirmation = await screen.findByText("Status updated.");
    expect(confirmation.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(within(screen.getByRole("heading", { name: "TKT-2026-000042" }).parentElement!).getByText("Waiting for Requester")).toBeInTheDocument();
    // Cancel is now offered from Waiting for Requester (BR-20).
    expect(within(statusSelect()).getByRole("option", { name: "Cancelled" })).toBeInTheDocument();
    await waitFor(() => expect(historyCalls()).toBeGreaterThan(before));
  });

  // UI-24 / AC-13, BR-15, BR-20
  it("offers Cancel from In Progress, Waiting for Requester, and Reopened, and says how many planned actions go with it", async () => {
    for (const [status, planned, sentence] of [
      ["IN_PROGRESS", 2, "Its 2 planned actions will be cancelled too."],
      ["WAITING_FOR_REQUESTER", 1, "Its 1 planned action will be cancelled too."],
      ["REOPENED", 0, null],
    ] as const) {
      const { unmount } = renderApp("/staff/tickets/42", STAFF);
      vi.mocked(api.getStaffTicketDetail).mockResolvedValue(detail({ currentStatus: status, resolutionGate: { plannedActions: planned, completedActions: 0, canResolve: false } }));
      await screen.findByRole("heading", { name: "TKT-2026-000042" });
      await userEvent.selectOptions(statusSelect(), "Cancelled");
      const group = screen.getByRole("group", { name: "Confirm the status change" });
      expect(group).toHaveTextContent("Cancel this Ticket? It cannot move to any other status afterwards.");
      if (sentence) expect(group).toHaveTextContent(sentence);
      else expect(group).not.toHaveTextContent(/planned action/);
      unmount();
    }
  });
});

describe("Status History", () => {
  // UI-23 / AC-24, BR-25
  it("shows a migrated Ticket's creation and then that earlier changes were not recorded, with no control", async () => {
    await open(detail());
    vi.mocked(api.getTicketHistory).mockResolvedValue(
      history([{}, { id: 9, fromStatus: "OPEN", toStatus: "IN_PROGRESS", changedBy: { id: STAFF.id, name: STAFF.name }, changedAt: "2026-10-01T03:00:00.000Z" }], true),
    );
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    const panel = screen.getByRole("tabpanel");
    const items = await within(panel).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Created as New");
    expect(items[0]).toHaveTextContent("Earlier status changes were not recorded.");
    expect(items[1]).toHaveTextContent("from Open");
    expect(items[1]).toHaveTextContent(STAFF.name);
    expect(within(panel).queryByRole("button")).not.toBeInTheDocument();
  });

  // UI-19 (History part) / AC-25: the Requester's read-only view
  it("shows the Requester the history after the conversation, with the Resolution Summary and no control", async () => {
    renderApp("/tickets/42", REQUESTER);
    const ticket: TicketDetail = { ...detail({ currentStatus: "RESOLVED" }), requesterId: REQUESTER.id };
    vi.mocked(api.getTicketDetail).mockResolvedValue(ticket);
    vi.mocked(api.getTicketHistory).mockResolvedValue(
      history([{}, { id: 2, fromStatus: "IN_PROGRESS", toStatus: "RESOLVED", changedBy: { id: STAFF.id, name: STAFF.name }, resolutionSummary: "Replaced the LAN cable; stable." }]),
    );
    const heading = await screen.findByRole("heading", { name: "History" });
    const section = heading.closest("section")!;
    expect(await within(section).findByText("Resolution Summary: Replaced the LAN cable; stable.")).toBeInTheDocument();
    expect(within(section).queryByText("Earlier status changes were not recorded.")).not.toBeInTheDocument();
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
    // After the conversation (ui-spec section 9).
    const comments = screen.getByRole("heading", { name: /^Public Comments/ });
    expect(comments.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
