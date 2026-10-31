import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError, type ActionItem, type StaffTicketDetail, type StaffTicketItem, type StatusHistory, type TicketDetail } from "../../src/api.js";
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

async function open(ticket: StaffTicketDetail, actions: ActionItem[] = []) {
  renderApp("/staff/tickets/42", STAFF);
  vi.mocked(api.getTicketActions).mockResolvedValue(actions);
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
    // A real link: Ctrl, Cmd or Shift click is left to the browser (a new tab or window), only a plain
    // click switches the tab in place (review on #89). The window listener runs after React's handler,
    // records whether the click was cancelled, then cancels it so jsdom does not try to navigate.
    const link = within(alert).getByRole("link", { name: "Go to Actions Taken" });
    expect(link).toHaveAttribute("href", "/staff/tickets/42?tab=actions");
    let cancelled: boolean | null = null;
    const record = (e: Event) => {
      cancelled = e.defaultPrevented;
      e.preventDefault();
    };
    window.addEventListener("click", record);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      fireEvent.click(link, modifier);
      expect(cancelled, JSON.stringify(modifier)).toBe(false);
      expect(screen.getByRole("alert")).toHaveTextContent("cannot be resolved yet");
    }
    window.removeEventListener("click", record);
    // History is the other tab that is not first; the link opens Actions Taken and focuses its tab.
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    await userEvent.click(within(alert).getByRole("link", { name: "Go to Actions Taken" }));
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
    // What the server reports once someone added a Planned Action after this page loaded.
    vi.mocked(api.getStaffTicketDetail).mockResolvedValue(detail({ resolutionGate: { plannedActions: 1, completedActions: 1, canResolve: false } }));
    await userEvent.selectOptions(statusSelect(), "Resolved");
    await userEvent.type(screen.getByLabelText(/Resolution Summary/), "Replaced the LAN cable; stable.");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and resolve" }));
    expect(await screen.findByText("This ticket cannot be resolved yet: 1 planned action is still open.")).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(api.getStaffTicketDetail).mock.calls.length).toBeGreaterThan(reloads));
  });
});

describe("the gate follows Action writes on the same screen (review on #85)", () => {
  const planned: ActionItem = {
    id: 7,
    ticketId: 42,
    status: "PLANNED",
    actionAt: "2026-09-12T02:00:00.000Z",
    description: "Replace the LAN cable at desk 4B.",
    result: null,
    followUpRequired: false,
    followUpNote: null,
    attachmentNotes: null,
    recordedBy: { id: STAFF.id, name: STAFF.name },
    recordedAt: "2026-09-12T01:00:00.000Z",
    responsibleStaff: { id: STAFF.id, name: STAFF.name, eligible: true },
    performedBy: null,
    completedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    lastEditedBy: null,
    version: 1,
    updatedAt: "2026-09-12T01:00:00.000Z",
  };

  // UI-20 / AC-19, AC-21: no reload between completing the last Planned Action and resolving
  it("opens Resolve once the last Planned Action is completed, without reloading the page", async () => {
    await open(detail({ resolutionGate: { plannedActions: 1, completedActions: 0, canResolve: false } }), [planned]);
    vi.mocked(api.getStaffTicketDetail).mockResolvedValue(detail({ resolutionGate: { plannedActions: 0, completedActions: 1, canResolve: true } }));
    vi.spyOn(api, "completeAction").mockResolvedValue({ ...planned, status: "COMPLETED", version: 2, result: "Done.", performedBy: { id: STAFF.id, name: STAFF.name }, completedAt: new Date().toISOString() });
    const panel = screen.getByRole("tabpanel");
    await userEvent.click(await within(panel).findByRole("button", { name: /Replace the LAN cable/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Complete" }));
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText(/Result/), "Cable replaced.");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as Completed" }));
    await screen.findByText("Action completed.");

    await waitFor(async () => {
      await userEvent.selectOptions(statusSelect(), "Resolved");
      expect(screen.getByLabelText(/Resolution Summary/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/cannot be resolved yet/)).not.toBeInTheDocument();
  });

  // UI-20 (sweep on #85): the gate sentence goes once the gate opens, however the Action was completed
  it("drops the 'cannot be resolved yet' sentence when the last Planned Action is completed from the tab itself", async () => {
    await open(detail({ resolutionGate: { plannedActions: 1, completedActions: 0, canResolve: false } }), [planned]);
    await userEvent.selectOptions(statusSelect(), "Resolved");
    expect(await screen.findByText(/cannot be resolved yet/)).toBeInTheDocument();
    vi.mocked(api.getStaffTicketDetail).mockResolvedValue(detail({ resolutionGate: { plannedActions: 0, completedActions: 1, canResolve: true } }));
    vi.spyOn(api, "completeAction").mockResolvedValue({ ...planned, status: "COMPLETED", version: 2, result: "Done.", performedBy: { id: STAFF.id, name: STAFF.name }, completedAt: new Date().toISOString() });
    const panel = screen.getByRole("tabpanel");
    await userEvent.click(await within(panel).findByRole("button", { name: /Replace the LAN cable/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Complete" }));
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText(/Result/), "Cable replaced.");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as Completed" }));
    await screen.findByText("Action completed.");
    await waitFor(() => expect(screen.queryByText(/cannot be resolved yet/)).not.toBeInTheDocument());
  });

  // UI-20 (sweep on #85): ACTION_FINAL whose list re-read fails still re-reads the gate
  it("re-reads the gate on ACTION_FINAL even when the list cannot be re-read", async () => {
    await open(detail({ resolutionGate: { plannedActions: 1, completedActions: 0, canResolve: false } }), [planned]);
    const detailCalls = vi.mocked(api.getStaffTicketDetail).mock.calls.length;
    vi.spyOn(api, "completeAction").mockRejectedValueOnce(new ApiError("x", 409, "ACTION_FINAL"));
    vi.mocked(api.getTicketActions).mockRejectedValue(new ApiError("down", 500));
    const panel = screen.getByRole("tabpanel");
    await userEvent.click(await within(panel).findByRole("button", { name: /Replace the LAN cable/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Complete" }));
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText(/Result/), "Cable replaced.");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as Completed" }));
    await waitFor(() => expect(vi.mocked(api.getStaffTicketDetail).mock.calls.length).toBeGreaterThan(detailCalls));
  });

  // UI-22 (sweep on #85, section 5 async UI): an older status re-read never overwrites a newer move
  it("keeps the newer status when the re-read after an Action write answers after a move's own re-read", async () => {
    await open(detail({ resolutionGate: { plannedActions: 0, completedActions: 0, canResolve: false } }));
    let releaseOld!: (d: StaffTicketDetail) => void;
    const old = new Promise<StaffTicketDetail>((r) => (releaseOld = r));
    vi.mocked(api.getStaffTicketDetail).mockReturnValueOnce(old).mockResolvedValue(detail({ currentStatus: "WAITING_FOR_REQUESTER" }));
    vi.spyOn(api, "createAction").mockResolvedValue(planned);
    vi.spyOn(api, "changeTicketStatus").mockResolvedValue({ ...detail({ currentStatus: "WAITING_FOR_REQUESTER" }) } as unknown as StaffTicketItem);
    const panel = screen.getByRole("tabpanel");
    await userEvent.click(within(panel).getByRole("button", { name: "Add Action" }));
    await userEvent.type(screen.getByLabelText(/Action Description/), "Replace the LAN cable at desk 4B.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    await screen.findByText("Action added.");
    // The re-read the Action started is still out; the move goes ahead and its own re-read answers first.
    await userEvent.selectOptions(statusSelect(), "Waiting for Requester");
    await screen.findByText("Status updated.");
    releaseOld(detail({ currentStatus: "IN_PROGRESS" }));
    await new Promise((r) => setTimeout(r, 30));
    expect((statusSelect() as HTMLSelectElement).value).toBe("WAITING_FOR_REQUESTER");
  });

  // UI-24 / BR-15: the count in the Cancel confirmation follows a new Planned Action
  it("counts a Planned Action added on the same screen in the Cancel confirmation", async () => {
    await open(detail({ currentStatus: "OPEN", resolutionGate: { plannedActions: 0, completedActions: 0, canResolve: false } }));
    vi.mocked(api.getStaffTicketDetail).mockResolvedValue(detail({ currentStatus: "OPEN", resolutionGate: { plannedActions: 1, completedActions: 0, canResolve: false } }));
    vi.spyOn(api, "createAction").mockResolvedValue(planned);
    const panel = screen.getByRole("tabpanel");
    await userEvent.click(within(panel).getByRole("button", { name: "Add Action" }));
    await userEvent.type(screen.getByLabelText(/Action Description/), "Replace the LAN cable at desk 4B.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    await screen.findByText("Action added.");
    await waitFor(async () => {
      await userEvent.selectOptions(statusSelect(), "Cancelled");
      expect(screen.getByRole("group", { name: "Confirm the status change" })).toHaveTextContent("Its 1 planned action will be cancelled too.");
    });
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
  it("reports neutrally when the Ticket is already in the status that was asked for", async () => {
    await open(detail({ currentStatus: "OPEN" }));
    vi.spyOn(api, "changeTicketStatus").mockRejectedValueOnce(Object.assign(new ApiError("x", 409, "STATUS_CHANGED"), { currentStatus: "IN_PROGRESS" }));
    vi.mocked(api.getStaffTicketDetail).mockResolvedValue(detail({ currentStatus: "IN_PROGRESS" }));
    await userEvent.selectOptions(statusSelect(), "In Progress");
    // It does not claim the move was this user's, nor blame someone else (spec section 11); History says who.
    expect(await screen.findByText("This ticket is already In Progress.")).toBeInTheDocument();
    expect(screen.queryByText("Status updated.")).not.toBeInTheDocument();
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

  // UI-22 / BR-43: right after a move the old permitted list can still contain the new status
  it("lists each status once, so no two options share a key", async () => {
    const errors = vi.spyOn(console, "error");
    await open(detail({ currentStatus: "OPEN", permittedNextStatuses: ["OPEN", "CANCELLED"] }));
    const options = within(statusSelect()).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Open", "Cancelled"]);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
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

  // UI-23 / BR-42: a History that cannot be loaded says so and offers Retry
  it("offers Retry when the History cannot be loaded, and shows it once it can", async () => {
    await open(detail());
    vi.mocked(api.getTicketHistory).mockRejectedValueOnce(new ApiError("down", 500)).mockResolvedValueOnce(history([{}]));
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    const panel = screen.getByRole("tabpanel");
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Unable to load the status history.");
    await userEvent.click(within(panel).getByRole("button", { name: "Retry" }));
    expect(await within(panel).findByText("Created as New")).toBeInTheDocument();
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
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
