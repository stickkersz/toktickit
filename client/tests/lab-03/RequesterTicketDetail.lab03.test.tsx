import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError, type TicketDetail } from "../../src/api.js";
import { REQUESTER, renderApp } from "./support.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
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
    ...overrides,
  };
}

async function open(t: TicketDetail = ticket()) {
  renderApp("/tickets/42", REQUESTER);
  vi.mocked(api.getTicketDetail).mockResolvedValue(t);
  await screen.findByLabelText("Ticket No.");
}

const button = () => screen.getByRole("button", { name: "Problem appears resolved" });
const statusValue = () => within(screen.getByText("Current Status").parentElement!).getByText("In Progress");

describe("Requester Ticket Detail: problem appears resolved", () => {
  // UI-20 / AC-26, FR-09, BR-29
  it("asks for confirmation, sends the signal, confirms it inline, and leaves the status badge exactly as it was", async () => {
    const flag = vi.spyOn(api, "flagProblemResolved").mockResolvedValue({
      id: 42,
      requesterResolutionFlaggedAt: "2026-09-12T10:30:00.000Z",
      currentStatus: "IN_PROGRESS",
    });
    await open();
    const user = userEvent.setup();
    expect(statusValue()).toHaveClass("zg-badge-in-progress");

    await user.click(button());
    // A confirmation step first: nothing has been sent yet.
    const group = screen.getByRole("group", { name: "Confirm the problem appears resolved" });
    expect(group).toHaveTextContent("Tell IT the problem appears resolved?");
    expect(flag).not.toHaveBeenCalled();

    await user.click(within(group).getByRole("button", { name: "Yes, tell IT" }));
    expect(flag).toHaveBeenCalledWith(42);
    expect(await screen.findByText(/IT has been told the problem appears resolved/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("The status has not changed");
    // The point of the interaction: the status is visibly unchanged.
    expect(statusValue()).toHaveClass("zg-badge-in-progress");
    expect(screen.queryByText("Resolved", { selector: ".zg-badge" })).not.toBeInTheDocument();
    // The button is back, so it can be used again.
    expect(button()).toBeEnabled();
  });

  it("can be cancelled at the confirmation step without sending anything", async () => {
    const flag = vi.spyOn(api, "flagProblemResolved");
    await open();
    const user = userEvent.setup();
    await user.click(button());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm the problem appears resolved" })).not.toBeInTheDocument();
    expect(button()).toBeInTheDocument();
    expect(flag).not.toHaveBeenCalled();
  });

  it.each(["CLOSED", "CANCELLED"])("is disabled with an explanation on a %s Ticket", async (currentStatus) => {
    await open(ticket({ currentStatus }));
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute("title", "This Ticket is closed, so it can no longer be flagged.");
  });

  it.each(["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "REOPENED"])("is available on a %s Ticket", async (currentStatus) => {
    await open(ticket({ currentStatus }));
    expect(button()).toBeEnabled();
  });

  it("reminds the Requester when they have already sent the signal", async () => {
    await open(ticket({ requesterResolutionFlaggedAt: "2026-09-12T10:30:00.000Z" }));
    expect(screen.getByText(/You told IT the problem appears resolved on/)).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it("keeps the confirmation open state clear, and shows a message with the button still usable, when the request fails", async () => {
    vi.spyOn(api, "flagProblemResolved").mockRejectedValue(new ApiError("down", 0, "NETWORK_ERROR"));
    await open();
    const user = userEvent.setup();
    await user.click(button());
    await user.click(screen.getByRole("button", { name: "Yes, tell IT" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to tell IT right now. Please try again.");
    expect(screen.queryByText(/IT has been told/)).not.toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it("says the Ticket is closed when the server reports it became terminal in the meantime", async () => {
    vi.spyOn(api, "flagProblemResolved").mockRejectedValue(new ApiError("closed", 409, "TICKET_TERMINAL"));
    await open();
    const user = userEvent.setup();
    await user.click(button());
    await user.click(screen.getByRole("button", { name: "Yes, tell IT" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This Ticket is closed, so it can no longer be flagged.");
  });

  it("shows the Resolution Summary, read only, once IT has written one, and not before", async () => {
    await open(ticket({ currentStatus: "RESOLVED", resolutionSummary: "Replaced the faulty access point." }));
    const field = screen.getByLabelText("Resolution Summary");
    expect(field).toHaveValue("Replaced the faulty access point.");
    expect(field).toHaveAttribute("readonly");
  });

  it("shows no Resolution Summary field when there is none, and offers no status, owner or IT Priority control (BR-22, BR-24)", async () => {
    await open();
    expect(screen.queryByLabelText("Resolution Summary")).not.toBeInTheDocument();
    for (const label of ["Current Status", "Ticket Owner", "IT Priority"]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
