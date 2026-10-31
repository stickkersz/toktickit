import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError, ValidationError, type ActionItem, type StaffOwner, type StaffTicketDetail, type TicketDetail } from "../../src/api.js";
import { ADMIN, REQUESTER, STAFF, renderApp } from "../lab-03/support.js";

// Lab 4 ui-spec.md sections 7 and 8: Actions Taken on both Ticket Details.

afterEach(() => {
  vi.restoreAllMocks();
});

const OWNERS: StaffOwner[] = [
  { id: STAFF.id, name: STAFF.name, role: "IT_STAFF" },
  { id: 20, name: "Wichai Charoen", role: "IT_STAFF" },
  { id: ADMIN.id, name: ADMIN.name, role: "ADMINISTRATOR" },
];

function staffDetail(overrides: Partial<StaffTicketDetail> = {}): StaffTicketDetail {
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
    currentStatus: "IN_PROGRESS",
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
    permittedNextStatuses: [],
    resolutionGate: { plannedActions: 0, completedActions: 0, canResolve: false },
    ...overrides,
  };
}

let nextId = 100;
function action(overrides: Partial<ActionItem> = {}): ActionItem {
  nextId += 1;
  return {
    id: nextId,
    ticketId: 42,
    status: "PLANNED",
    actionAt: "2026-09-12T02:00:00.000Z",
    description: "Replace the LAN cable at desk 4B and retest the link.",
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
    ...overrides,
  };
}

async function openStaff(actions: ActionItem[] = [], ticket: Partial<StaffTicketDetail> = {}, user = STAFF) {
  renderApp("/staff/tickets/42?tab=actions", user);
  vi.mocked(api.getStaffTicketDetail).mockResolvedValue(staffDetail(ticket));
  vi.mocked(api.getStaffOwners).mockResolvedValue(OWNERS);
  vi.mocked(api.getTicketActions).mockResolvedValue(actions);
  await screen.findByRole("heading", { name: "TKT-2026-000042" });
  await screen.findByRole("tab", { name: `Actions Taken (${actions.length})` });
}

const panel = () => screen.getByRole("tabpanel");
const fill = async (label: RegExp, text: string) => {
  const box = screen.getByLabelText(label);
  await userEvent.clear(box);
  if (text) await userEvent.type(box, text);
};

describe("Actions Taken list (IT Staff)", () => {
  // UI-10 / AC-14, BR-14, BR-16
  it("opens from ?tab=actions as the first tab, lists Actions in date order with badges, and offers Add only on a workable Ticket", async () => {
    const late = action({ actionAt: "2026-09-12T05:00:00.000Z", description: "Swap the switch port.", status: "COMPLETED", performedBy: { id: 20, name: "Wichai Charoen" }, completedAt: "2026-09-12T05:10:00.000Z", result: "Done and tested." });
    const early = action({ actionAt: "2026-09-12T02:00:00.000Z", followUpRequired: true, followUpNote: "Check again tomorrow." });
    const cancelled = action({ actionAt: "2026-09-12T03:00:00.000Z", status: "CANCELLED", description: "Clear the cache.", cancelledBy: { id: STAFF.id, name: STAFF.name }, cancelledAt: "2026-09-12T03:05:00.000Z", cancelReason: "Not needed." });
    await openStaff([late, cancelled, early]);

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\s+/g, " ").trim());
    expect(tabs[0]).toBe("Actions Taken (3)");
    expect(screen.getByRole("tab", { name: "Actions Taken (3)" })).toHaveAttribute("aria-selected", "true");
    expect(within(panel()).getByText("Actions Taken are visible to the Requester. Use an Internal Note for anything private.")).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Add Action" })).toBeInTheDocument();

    const table = within(panel()).getByRole("table");
    const rows = within(table).getAllByRole("button");
    // The server's order is not trusted: Action Date/Time, then creation order.
    expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual([early.description, "Clear the cache.", "Swap the switch port."]);
    expect(within(rows[0]).getByText("Planned")).toHaveClass("zg-badge", "zg-badge-action-planned");
    expect(within(rows[0]).getByText("Follow-up needed")).toHaveClass("zg-badge-followup");
    expect(within(rows[1]).getByText("Cancelled")).toHaveClass("zg-badge-action-cancelled");
    expect(within(rows[2]).getByText("Completed")).toHaveClass("zg-badge-action-completed");
    expect(within(rows[2]).getByText("Wichai Charoen")).toBeInTheDocument();
  });

  // UI-10 / BR-14
  it("replaces Add with the reason on a Resolved, Closed, or Cancelled Ticket, and says when there are none", async () => {
    await openStaff([], { currentStatus: "RESOLVED" });
    expect(within(panel()).queryByRole("button", { name: "Add Action" })).not.toBeInTheDocument();
    expect(within(panel()).getByText("Actions cannot be added to a Resolved, Closed, or Cancelled ticket. Reopen it to add work.")).toBeInTheDocument();
    expect(within(panel()).getByText("No actions recorded yet.")).toBeInTheDocument();
  });

  // UI-10, A11Y (rows): Enter and Space open the detail
  it("opens an Action's detail by click, Enter, or Space, with every field and who recorded it", async () => {
    const a = action({ attachmentNotes: "See photo desk-4b-port.jpg." });
    await openStaff([a]);
    const row = within(within(panel()).getByRole("table")).getByRole("button");
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(within(panel()).getByText("See photo desk-4b-port.jpg.")).toBeInTheDocument();
    expect(within(panel()).getByText(/^Pimchanok Somboon, /)).toBeInTheDocument();
    await userEvent.keyboard(" ");
    expect(row).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Add Action", () => {
  // UI-11, STYLE-02 (Actions Taken form) / AC-05, AC-50, BR-04
  it("validates under each field, and shows the Follow-Up Note with its red asterisk only while follow-up is required", async () => {
    await openStaff();
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    // Focus moves to the first field.
    expect(screen.getByLabelText(/Action Date\/Time/)).toHaveFocus();
    expect(screen.queryByLabelText(/Follow-Up Note/)).not.toBeInTheDocument();

    const create = vi.spyOn(api, "createAction");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    expect(create).not.toHaveBeenCalled();
    const description = screen.getByLabelText(/Action Description/);
    expect(description).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Description must be between 5 and 2000 characters.")).toHaveAttribute("id", description.getAttribute("aria-describedby"));

    await userEvent.click(screen.getByLabelText("Follow-Up Required"));
    const note = screen.getByLabelText(/Follow-Up Note/);
    expect(note.closest("div")!.parentElement!.querySelector(".zg-required")).not.toBeNull();
    expect(screen.getByText("Follow-up note must be between 5 and 1000 characters.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Follow-Up Required"));
    expect(screen.queryByLabelText(/Follow-Up Note/)).not.toBeInTheDocument();

    // Responsible Staff defaults to the current user and offers only active staff.
    const responsible = screen.getByLabelText(/Responsible Staff/) as HTMLSelectElement;
    expect(responsible.value).toBe(String(STAFF.id));
    expect([...responsible.options].map((o) => o.textContent)).toEqual(OWNERS.map((o) => o.name));
  });

  // STYLE-02 / AC-50: every required label on the Lab 4 form and both dialogs ends with the red asterisk
  it("ends every required label on the Action form and the Complete and Cancel dialogs with the red asterisk", async () => {
    const endsMarked = (field: HTMLElement) => {
      const label = (field as HTMLInputElement).labels![0];
      expect(label.lastElementChild, label.textContent!).toHaveClass("zg-required");
    };
    await openStaff([action()]);
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    for (const name of [/Action Date\/Time/, /Action Description/, /Responsible Staff/]) endsMarked(screen.getByLabelText(name));
    // Optional fields carry no mark.
    expect((screen.getByLabelText(/Attachment Notes/) as HTMLInputElement).labels![0].querySelector(".zg-required")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await userEvent.click(within(panel()).getAllByRole("button", { name: /Replace the LAN cable/ })[0]);
    for (const [opener, fields] of [["Complete", [/Result/, /Action Date\/Time/]], ["Cancel Action", [/Reason/]]] as const) {
      await userEvent.click(within(panel()).getByRole("button", { name: opener }));
      const dialog = screen.getByRole("dialog");
      for (const name of fields) endsMarked(within(dialog).getByLabelText(name));
      await userEvent.keyboard("{Escape}");
    }
  });

  // UI-27 / AC-40, BR-39 (Add Action; the comment half is in Hardening.test.tsx)
  it("on IDEMPOTENCY_KEY_REUSED keeps the typed text, shows the server's message, and sends the next save with a new key", async () => {
    await openStaff();
    const message = "This request was already submitted with different content. Refresh and try again.";
    const create = vi.spyOn(api, "createAction").mockRejectedValueOnce(new ApiError(message, 409, "IDEMPOTENCY_KEY_REUSED")).mockResolvedValueOnce(action());
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    await fill(/Action Description/, "Replace the cable at desk 4B.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(/Action Description/)).toHaveValue("Replace the cable at desk 4B.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    expect(await screen.findByText("Action added.")).toBeInTheDocument();
    expect(create.mock.calls[1][2]).not.toBe(create.mock.calls[0][2]);
  });

  // UI-12 / AC-39, AC-41
  it("sends one request for a double click, and retries a lost response with the same Idempotency-Key", async () => {
    await openStaff();
    const created = action({ description: "Replace the cable at desk 4B." });
    let resolve!: (a: ActionItem) => void;
    const create = vi
      .spyOn(api, "createAction")
      .mockRejectedValueOnce(new ApiError("Unable to reach the TokTickIT API. Check your connection and try again.", 0, "NETWORK_ERROR"))
      .mockImplementationOnce(() => new Promise<ActionItem>((r) => (resolve = r)));
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    await fill(/Action Description/, "Replace the cable at desk 4B.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    expect(await screen.findByText("Unable to reach the TokTickIT API. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Action Description/)).toHaveValue("Replace the cable at desk 4B.");

    const save = screen.getByRole("button", { name: "Save Action" });
    await userEvent.dblClick(save);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(2);
    const [firstKey, secondKey] = create.mock.calls.map((c) => c[2]);
    expect(secondKey).toBe(firstKey);
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);

    resolve(created);
    expect(await screen.findByText("Action added.")).toHaveAttribute("role", "status");
    expect(screen.getByRole("tab", { name: "Actions Taken (1)" })).toBeInTheDocument();
    await waitFor(() => expect(within(within(panel()).getByRole("table")).getByRole("button")).toHaveFocus());

    // A new submission gets a new key.
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    vi.mocked(api.createAction).mockResolvedValueOnce(action());
    await fill(/Action Description/, "Another action entirely.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    await screen.findByRole("tab", { name: "Actions Taken (2)" });
    expect(create.mock.calls[2][2]).not.toBe(firstKey);
  });

  // UI-12 / AC-41: whatever the button is doing
  it("sends one request when the form is submitted twice in the same moment", async () => {
    await openStaff();
    const create = vi.spyOn(api, "createAction").mockImplementation(() => new Promise<ActionItem>(() => undefined));
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    await fill(/Action Description/, "Replace the cable at desk 4B.");
    const form = screen.getByRole("form", { name: "Add Action" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  // UI-13 / AC-42, BR-41
  it("keeps everything typed after a 500 and after a 409 key reuse, and the next submit carries a new key", async () => {
    await openStaff();
    const create = vi
      .spyOn(api, "createAction")
      .mockRejectedValueOnce(new ApiError("Unable to add the action.", 500, "INTERNAL_ERROR"))
      .mockRejectedValueOnce(new ApiError("This request was already submitted with different content. Refresh and try again.", 409, "IDEMPOTENCY_KEY_REUSED"));
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    await fill(/Action Description/, "Replace the cable at desk 4B.");
    await userEvent.click(screen.getByLabelText("Follow-Up Required"));
    await fill(/Follow-Up Note/, "Check the port again.");
    await fill(/Attachment Notes/, "Photo in Attachments.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to add the action.");
    for (const [label, value] of [[/Action Description/, "Replace the cable at desk 4B."], [/Follow-Up Note/, "Check the port again."], [/Attachment Notes/, "Photo in Attachments."]] as const)
      expect(screen.getByLabelText(label)).toHaveValue(value);

    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    expect(await screen.findByText("This request was already submitted with different content. Refresh and try again.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Action Description/)).toHaveValue("Replace the cable at desk 4B.");
    vi.mocked(api.createAction).mockResolvedValueOnce(action());
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    await screen.findByText("Action added.");
    const keys = create.mock.calls.map((c) => c[2]);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  // UI-11 / BR-05 (found by E2E-01): a Ticket filed earlier in the current minute
  it("never sends a default time earlier than the Ticket's creation, and refuses an earlier minute under the field", async () => {
    const createdAt = new Date(Date.now() - 1000);
    await openStaff([], { createdAt: createdAt.toISOString() });
    const create = vi.spyOn(api, "createAction").mockResolvedValue(action());
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    await fill(/Action Description/, "Replace the cable at desk 4B.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(Date.parse(create.mock.calls[0][1].actionAt)).toBeGreaterThanOrEqual(createdAt.getTime());

    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    const at = screen.getByLabelText(/Action Date\/Time/);
    const earlier = new Date(createdAt.getTime() - 2 * 60_000 + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
    fireEvent.change(at, { target: { value: earlier } });
    await fill(/Action Description/, "Replace the cable at desk 4C.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    expect(screen.getByText("Action date/time cannot be earlier than when the Ticket was created.")).toHaveAttribute("id", "action-create-actionAt-error");
    expect(create).toHaveBeenCalledTimes(1);
  });

  // UI-13 / ui-spec section 7: Cancel asks first when something was typed
  it("asks before discarding a started Action and returns focus to Add Action", async () => {
    await openStaff();
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    await fill(/Action Description/, "Half typed");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard the action you started? What you typed will be lost.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText(/Action Description/)).toHaveValue("Half typed");
    // The confirmation and its button are gone, so focus goes back to the form's Cancel (review on #84 sweep).
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByLabelText(/Action Description/)).not.toBeInTheDocument();
    await waitFor(() => expect(within(panel()).getByRole("button", { name: "Add Action" })).toHaveFocus());
  });
});

describe("Edit, conflicts, and finished Actions", () => {
  async function openEdit(a: ActionItem) {
    await openStaff([a]);
    await userEvent.click(within(within(panel()).getByRole("table")).getByRole("button"));
    await userEvent.click(within(panel()).getByRole("button", { name: "Edit" }));
  }

  // UI-14 / AC-11, BR-13
  it("shows a stale edit's server values beside the form, resends against the new version, or discards", async () => {
    const a = action({ description: "Original description text." });
    await openEdit(a);
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    await fill(/Action Description/, "My new description text.");
    const theirs = { ...a, version: 2, description: "Their newer description.", lastEditedBy: { id: 20, name: "Wichai Charoen" } };
    const stale = new ApiError("Someone else changed this action. Reload it and try again.", 409, "STALE_ACTION");
    stale.action = theirs;
    const update = vi.spyOn(api, "updateAction").mockRejectedValueOnce(stale).mockResolvedValueOnce({ ...theirs, version: 3, description: "My new description text." });
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    const callout = await screen.findByRole("alert");
    expect(callout).toHaveTextContent("Someone else changed this action. The latest version is shown below; your changes are still in the form.");
    expect(within(callout).getByText("Their newer description.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Action Description/)).toHaveValue("My new description text.");

    await userEvent.click(within(callout).getByRole("button", { name: "Use my changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[0][1]).toBe(1);
    expect(update.mock.calls[1][1]).toBe(2);
    expect(update.mock.calls[1][2]).toEqual({ description: "My new description text." });
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
  });

  // UI-14 / AC-11
  it("drops my changes and shows theirs on Discard my changes", async () => {
    const a = action({ description: "Original description text." });
    await openEdit(a);
    await fill(/Action Description/, "My new description text.");
    const stale = new ApiError("x", 409, "STALE_ACTION");
    stale.action = { ...a, version: 2, description: "Their newer description." };
    vi.spyOn(api, "updateAction").mockRejectedValueOnce(stale);
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Discard my changes" }));
    expect(screen.queryByLabelText(/Action Description/)).not.toBeInTheDocument();
    expect(within(panel()).getAllByText("Their newer description.").length).toBeGreaterThan(0);
  });

  // UI-18 / AC-04, AC-17
  it("marks an ineligible Responsible Staff member, keeps them as the current value only, and shows a refused reassignment under the field", async () => {
    const a = action({ responsibleStaff: { id: 55, name: "Sunisa Kaewmanee", eligible: false } });
    await openStaff([a]);
    const row = within(within(panel()).getByRole("table")).getByRole("button");
    expect(within(row).getByText("Not active")).toHaveClass("zg-badge-not-active");
    await userEvent.click(row);
    await userEvent.click(within(panel()).getByRole("button", { name: "Edit" }));
    const select = screen.getByLabelText(/Responsible Staff/) as HTMLSelectElement;
    expect(select.value).toBe("55");
    const current = [...select.options].find((o) => o.value === "55")!;
    expect(current.textContent).toBe("Sunisa Kaewmanee (Not active)");
    expect(current.disabled).toBe(true);

    const refused = new ApiError("Choose an active IT Staff member.", 409, "INVALID_RESPONSIBLE");
    vi.spyOn(api, "updateAction").mockRejectedValueOnce(refused);
    const owners = vi.mocked(api.getStaffOwners);
    const before = owners.mock.calls.length;
    await userEvent.selectOptions(select, "20");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    const error = await screen.findByText("Choose an active IT Staff member.");
    expect(error).toHaveAttribute("id", select.getAttribute("aria-describedby"));
    // The staff list reloads.
    await waitFor(() => expect(owners.mock.calls.length).toBeGreaterThan(before));
  });

  // UI-13 / BR-41 (found by E2E-01): a tablet rotated mid-edit swaps the table for cards
  it("keeps what was typed in an open edit when the layout switches between table and cards", async () => {
    let wide = true;
    const listeners: (() => void)[] = [];
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return wide;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => undefined,
    }));
    try {
      await openEdit(action({ description: "Original description text." }));
      await fill(/Action Description/, "Typed before the rotation.");
      wide = false;
      await act(async () => listeners.forEach((fn) => fn()));
      expect(within(panel()).queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Action Description/)).toHaveValue("Typed before the rotation.");
      wide = true;
      await act(async () => listeners.forEach((fn) => fn()));
      expect(screen.getByLabelText(/Action Description/)).toHaveValue("Typed before the rotation.");
      expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // UI-17 / AC-09, BR-12
  it("shows a Completed and a Cancelled Action read-only, with no control and the final sentence", async () => {
    const done = action({ status: "COMPLETED", result: "Cable replaced.", performedBy: { id: 20, name: "Wichai Charoen" }, completedAt: "2026-09-12T02:30:00.000Z", version: 2 });
    const gone = action({ actionAt: "2026-09-12T04:00:00.000Z", status: "CANCELLED", cancelledBy: { id: 20, name: "Wichai Charoen" }, cancelledAt: "2026-09-12T04:10:00.000Z", cancelReason: "Duplicate.", version: 2 });
    await openStaff([done, gone]);
    for (const [index, label] of [[0, "Result"], [1, "Reason"]] as const) {
      const rows = within(within(panel()).getByRole("table")).getAllByRole("button");
      await userEvent.click(rows[index]);
      expect(within(panel()).getByText(label)).toBeInTheDocument();
      expect(within(panel()).getByText("This action is final and cannot be changed.")).toBeInTheDocument();
      expect(within(panel()).queryByRole("button", { name: /^(Edit|Complete|Cancel Action)$/ })).not.toBeInTheDocument();
      await userEvent.click(rows[index]);
    }
  });

  // UI-17 / AC-10: a write to an Action someone already finished
  it("closes the form and says who finished an Action when the server answers ACTION_FINAL", async () => {
    const a = action();
    await openEdit(a);
    await fill(/Action Description/, "Changed too late.");
    vi.spyOn(api, "updateAction").mockRejectedValueOnce(new ApiError("This action is already completed or cancelled.", 409, "ACTION_FINAL"));
    vi.mocked(api.getTicketActions).mockResolvedValue([{ ...a, status: "COMPLETED", version: 2, performedBy: { id: 20, name: "Wichai Charoen" }, completedAt: "2026-09-12T02:30:00.000Z", result: "Done." }]);
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^This action is already completed or cancelled\. Completed by Wichai Charoen, /);
    expect(screen.queryByLabelText(/Action Description/)).not.toBeInTheDocument();
    // The form and its Save button are gone, so focus goes to the Action's row (review on #84 sweep).
    await waitFor(() => expect(within(within(panel()).getByRole("table")).getAllByRole("button")[0]).toHaveFocus());
  });

  // UI-14 / BR-13: a refused resend after Use my changes
  it("keeps focus in the form when the resend after Use my changes is refused", async () => {
    const a = action({ description: "Original description text." });
    await openEdit(a);
    await fill(/Action Description/, "My new description text.");
    const stale = new ApiError("x", 409, "STALE_ACTION");
    stale.action = { ...a, version: 2, description: "Their newer description." };
    vi.spyOn(api, "updateAction").mockRejectedValueOnce(stale).mockRejectedValueOnce(new ApiError("Unable to save the action.", 500, "INTERNAL_ERROR"));
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use my changes" }));
    expect(await screen.findByText("Unable to save the action.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Changes" })).toHaveFocus());
    expect(screen.getByLabelText(/Action Description/)).toHaveValue("My new description text.");
  });
});

describe("Complete and Cancel dialogs", () => {
  async function openDialog(a: ActionItem, button: "Complete" | "Cancel Action") {
    await openStaff([a]);
    await userEvent.click(within(within(panel()).getByRole("table")).getByRole("button"));
    const opener = within(panel()).getByRole("button", { name: button });
    await userEvent.click(opener);
    return opener;
  }

  // UI-15 / AC-09, AC-49
  it("traps focus, closes on Escape, returns focus, and always sends actionAt and the version, using now for a future-dated Action", async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const a = action({ actionAt: future, version: 4 });
    const opener = await openDialog(a, "Complete");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(/^Complete Action: Replace the LAN cable/);
    expect(within(dialog).getByLabelText(/Result/)).toHaveFocus();
    expect(within(dialog).getByText("Once completed, this action cannot be changed.")).toBeInTheDocument();
    // Pre-filled with now, not the future date.
    const at = within(dialog).getByLabelText(/Action Date\/Time/) as HTMLInputElement;
    expect(Math.abs(new Date(`${at.value}:00+07:00`).getTime() - Date.now())).toBeLessThan(2 * 60 * 1000);

    // Tab from the last control wraps to the first, Shift+Tab from the first to the last.
    // Moving focus blurs Result, whose blur handler sets state, so it runs inside act (UI-26).
    act(() => within(dialog).getByRole("button", { name: "Mark as Completed" }).focus());
    await userEvent.tab();
    expect(within(dialog).getByLabelText(/Result/)).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Mark as Completed" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await userEvent.click(opener);
    const complete = vi.spyOn(api, "completeAction").mockResolvedValue({ ...a, status: "COMPLETED", version: 5, result: "Cable replaced.", performedBy: { id: STAFF.id, name: STAFF.name }, completedAt: new Date().toISOString() });
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as Completed" }));
    expect(complete).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByText("Result must be between 5 and 2000 characters.")).toBeInTheDocument();
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText(/Result/), "Cable replaced.");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as Completed" }));
    expect(complete).toHaveBeenCalledWith(a.id, 4, "Cable replaced.", expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(await screen.findByText("Action completed.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The Complete button is gone now the Action is final, so focus goes to the Action's row, never the body (review on #84).
    await waitFor(() => expect(within(within(panel()).getByRole("table")).getAllByRole("button")[0]).toHaveFocus());
    const row = within(within(panel()).getByRole("table")).getAllByRole("button")[0];
    expect(within(row).getByText("Completed")).toBeInTheDocument();
  });

  // UI-16 / AC-10
  it("requires a reason, sends the version, and labels the Action Cancelled with its reason", async () => {
    const a = action({ version: 2 });
    await openDialog(a, "Cancel Action");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/Reason/)).toHaveFocus();
    const cancel = vi.spyOn(api, "cancelAction").mockResolvedValue({ ...a, status: "CANCELLED", version: 3, cancelReason: "Duplicate of another action.", cancelledBy: { id: STAFF.id, name: STAFF.name }, cancelledAt: new Date().toISOString() });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel Action" }));
    expect(cancel).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Reason must be between 5 and 500 characters.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Duplicate of another action.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel Action" }));
    expect(cancel).toHaveBeenCalledWith(a.id, 2, "Duplicate of another action.");
    expect(await screen.findByText("Action cancelled.")).toBeInTheDocument();
    const row = within(within(panel()).getByRole("table")).getByRole("button");
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
    // Cancel Action is gone now, so focus goes to the row (review on #84).
    await waitFor(() => expect(row).toHaveFocus());
  });

  // UI-15 / BR-13: a stale complete keeps the dialog and what was typed
  it("keeps the dialog and the typed Result when the Action changed meanwhile, against the latest version", async () => {
    const a = action({ version: 1 });
    await openDialog(a, "Complete");
    const stale = new ApiError("x", 409, "STALE_ACTION");
    stale.action = { ...a, version: 2, description: "Edited by someone else." };
    const complete = vi.spyOn(api, "completeAction").mockRejectedValueOnce(stale).mockResolvedValueOnce({ ...a, status: "COMPLETED", version: 3, result: "Cable replaced.", performedBy: { id: STAFF.id, name: STAFF.name }, completedAt: new Date().toISOString() });
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText(/Result/), "Cable replaced.");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as Completed" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Someone else changed this action. The latest version is now loaded; check it and try again.");
    expect(within(screen.getByRole("dialog")).getByLabelText(/Result/)).toHaveValue("Cable replaced.");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as Completed" }));
    expect(complete.mock.calls[1][1]).toBe(2);
  });

  // UI-15 / BR-14: the Ticket was finished meanwhile
  it("closes the dialog, reloads the status, and explains when the Ticket is no longer workable", async () => {
    const a = action();
    await openDialog(a, "Complete");
    vi.spyOn(api, "completeAction").mockRejectedValueOnce(new ApiError("x", 409, "TICKET_NOT_WORKABLE"));
    const detail = vi.mocked(api.getStaffTicketDetail);
    const before = detail.mock.calls.length;
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText(/Result/), "Cable replaced.");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as Completed" }));
    expect(await screen.findByText(/This ticket's status changed, so its actions can no longer be changed/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(detail.mock.calls.length).toBeGreaterThan(before));
    // Its Complete button is gone, so focus goes to the Action's row (review on #84 sweep).
    await waitFor(() => expect(within(within(panel()).getByRole("table")).getAllByRole("button")[0]).toHaveFocus());
  });

  // UI-15 / AC-10: the Action was finished by someone else while the dialog was open
  it("sends focus to the Action's row when Complete is answered ACTION_FINAL", async () => {
    const a = action();
    await openDialog(a, "Complete");
    vi.spyOn(api, "completeAction").mockRejectedValueOnce(new ApiError("x", 409, "ACTION_FINAL"));
    vi.mocked(api.getTicketActions).mockResolvedValue([{ ...a, status: "COMPLETED", version: 2, performedBy: { id: 20, name: "Wichai Charoen" }, completedAt: "2026-09-12T02:30:00.000Z", result: "Done." }]);
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText(/Result/), "Cable replaced.");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark as Completed" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Completed by Wichai Charoen/);
    const row = within(within(panel()).getByRole("table")).getAllByRole("button")[0];
    await waitFor(() => expect(within(row).getByText("Completed")).toBeInTheDocument());
    expect(row).toHaveFocus();
  });

  // BR-14: the create form, when the Ticket stopped being workable, has no row and no Add Action left
  it("sends focus to the explanation when a create is answered TICKET_NOT_WORKABLE", async () => {
    await openStaff();
    vi.spyOn(api, "createAction").mockRejectedValueOnce(new ApiError("x", 409, "TICKET_NOT_WORKABLE"));
    vi.mocked(api.getStaffTicketDetail).mockResolvedValue(staffDetail({ currentStatus: "RESOLVED" }));
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    await fill(/Action Description/, "Replace the cable at desk 4B.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    const notice = await screen.findByText(/This ticket's status changed, so its actions can no longer be changed/);
    await waitFor(() => expect(notice).toHaveFocus());
    // BR-41, AC-42: what was typed is still there to copy (pre-release review).
    expect(screen.getByLabelText(/Action Description/)).toHaveValue("Replace the cable at desk 4B.");
  });
});

describe("Requester Ticket Detail", () => {
  const requesterTicket = (): TicketDetail => ({
    id: 42,
    ticketNumber: "TKT-2026-000042",
    requesterId: REQUESTER.id,
    requesterName: REQUESTER.name,
    categoryId: 4,
    categoryName: "Network",
    relatedSystemId: 1,
    relatedSystemName: "Staff VPN",
    summary: "Cannot connect to the VPN",
    description: "The client times out at the login step every morning.",
    requestedPriority: "MEDIUM",
    currentStatus: "IN_PROGRESS",
    resolutionSummary: null,
    requesterResolutionFlaggedAt: null,
    createdAt: "2026-09-10T09:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
    attachments: [],
  });

  // UI-19 (Actions part) / AC-15, BR-17
  it("shows every Action read-only, Cancelled ones with their reason, and no control to change one", async () => {
    renderApp("/tickets/42", REQUESTER);
    vi.mocked(api.getTicketDetail).mockResolvedValue(requesterTicket());
    vi.mocked(api.getTicketActions).mockResolvedValue([
      action({ status: "CANCELLED", cancelReason: "Not needed.", cancelledBy: { id: STAFF.id, name: STAFF.name }, cancelledAt: "2026-09-12T02:10:00.000Z" }),
      action({ actionAt: "2026-09-12T03:00:00.000Z", followUpRequired: true, followUpNote: "Check again tomorrow." }),
    ]);
    const heading = await screen.findByRole("heading", { name: "Actions Taken (2)" });
    const section = heading.closest("section")!;
    const rows = within(within(section).getByRole("table")).getAllByRole("button");
    await userEvent.click(rows[0]);
    expect(within(section).getByText("Not needed.")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /add action|^edit$|^complete$|cancel action/i })).not.toBeInTheDocument();
    expect(within(section).queryByRole("textbox")).not.toBeInTheDocument();
  });

  // UI-19 (Actions part)
  it("says when IT has recorded nothing yet", async () => {
    renderApp("/tickets/42", REQUESTER);
    vi.mocked(api.getTicketDetail).mockResolvedValue(requesterTicket());
    expect(await screen.findByText("IT has not recorded any actions yet.")).toBeInTheDocument();
  });
});

describe("Badges", () => {
  // STYLE-01 / AC-51
  it("gives every Action Status, the follow-up flag, and the eligibility marker fixed text and a token class", async () => {
    await openStaff([
      action({ followUpRequired: true, followUpNote: "Later.", responsibleStaff: { id: 55, name: "Sunisa Kaewmanee", eligible: false } }),
      action({ status: "COMPLETED", result: "Done.", performedBy: { id: 20, name: "Wichai Charoen" }, completedAt: "2026-09-12T02:30:00.000Z" }),
      action({ status: "CANCELLED", cancelReason: "No.", cancelledBy: { id: 20, name: "Wichai Charoen" }, cancelledAt: "2026-09-12T02:30:00.000Z" }),
    ]);
    const table = within(panel()).getByRole("table");
    for (const [text, cls] of [["Planned", "zg-badge-action-planned"], ["Completed", "zg-badge-action-completed"], ["Cancelled", "zg-badge-action-cancelled"], ["Follow-up needed", "zg-badge-followup"], ["Not active", "zg-badge-not-active"]])
      expect(within(table).getByText(text)).toHaveClass("zg-badge", cls);
  });
});

// The ValidationError path: the server's field message lands under the field.
describe("server validation", () => {
  it("shows a field the server refused under that field", async () => {
    await openStaff();
    vi.spyOn(api, "createAction").mockRejectedValueOnce(new ValidationError("Action date/time cannot be earlier than when the Ticket was created.", { actionAt: "Action date/time cannot be earlier than when the Ticket was created." }));
    await userEvent.click(within(panel()).getByRole("button", { name: "Add Action" }));
    await fill(/Action Description/, "Replace the cable at desk 4B.");
    await userEvent.click(screen.getByRole("button", { name: "Save Action" }));
    const error = await screen.findAllByText("Action date/time cannot be earlier than when the Ticket was created.");
    expect(error.some((e) => e.id === "action-create-actionAt-error")).toBe(true);
  });
});
