import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../src/api.js";
import { ApiError, type ContentItem, type TicketDetail } from "../../src/api.js";
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

describe("Requester Ticket Detail: Public Comments", () => {
  const comment = (overrides: Partial<ContentItem> = {}): ContentItem => ({
    id: 1,
    body: "We are investigating the issue on your device.",
    authorName: "Pimchanok Somboon",
    authorRole: "IT_STAFF",
    createdAt: "2026-09-12T10:30:00.000Z",
    ...overrides,
  });
  const panel = () => screen.getByRole("region", { name: /^Public Comments/ });

  async function openWith(comments: ContentItem[], t: TicketDetail = ticket()) {
    renderApp("/tickets/42", REQUESTER);
    vi.mocked(api.getTicketDetail).mockResolvedValue(t);
    vi.mocked(api.getTicketComments).mockResolvedValue(comments);
    await screen.findByLabelText("Ticket No.");
    await screen.findByRole("heading", { name: /^Public Comments/ });
  }

  // UI-21 / AC-27
  it("lists the comments oldest first with each author and role, and posting appends one without a reload", async () => {
    await openWith([comment({ id: 1 }), comment({ id: 2, body: "Any update?", authorName: REQUESTER.name, authorRole: "REQUESTER" })]);
    expect(screen.getByRole("heading", { name: "Public Comments (2)" })).toBeInTheDocument();
    const entries = within(panel()).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(within(entries[0]).getByText("Pimchanok Somboon")).toBeInTheDocument();
    expect(within(entries[0]).getByText("IT Staff", { selector: ".zg-badge" })).toBeInTheDocument();
    expect(within(entries[0]).getByText("We are investigating the issue on your device.")).toBeInTheDocument();
    expect(within(entries[1]).getByText("Requester", { selector: ".zg-badge" })).toBeInTheDocument();

    const post = vi.spyOn(api, "postTicketComment").mockResolvedValue(comment({ id: 3, body: "Thank you for the update.", authorName: REQUESTER.name, authorRole: "REQUESTER" }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add Public Comment"), "Thank you for the update.");
    await user.click(screen.getByRole("button", { name: "Post Comment" }));
    expect(post).toHaveBeenCalledWith(42, "Thank you for the update.");
    expect(await within(panel()).findByText("Thank you for the update.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Public Comments (3)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Add Public Comment")).toHaveValue("");
    expect(api.getTicketComments).toHaveBeenCalledTimes(1);
  });

  it("says so when there are no comments yet", async () => {
    await openWith([]);
    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Public Comments (0)" })).toBeInTheDocument();
  });

  it("keeps the typed text and says nothing was added when posting fails", async () => {
    await openWith([]);
    vi.spyOn(api, "postTicketComment").mockRejectedValue(new ApiError("down", 500));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add Public Comment"), "please keep this");
    await user.click(screen.getByRole("button", { name: "Post Comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to add the comment. Nothing was added.");
    expect(screen.getByLabelText("Add Public Comment")).toHaveValue("please keep this");
  });

  it("refuses a body outside 2 to 2000 characters before sending anything", async () => {
    await openWith([]);
    const post = vi.spyOn(api, "postTicketComment");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add Public Comment"), "   ");
    await user.click(screen.getByRole("button", { name: "Post Comment" }));
    expect(await screen.findByText("Content must be between 2 and 2000 characters.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("swaps the composer for an explanation on a closed or cancelled Ticket, and still shows what was said", async () => {
    for (const currentStatus of ["CLOSED", "CANCELLED"]) {
      const { unmount } = renderApp("/tickets/42", REQUESTER);
      vi.mocked(api.getTicketDetail).mockResolvedValue(ticket({ currentStatus }));
      vi.mocked(api.getTicketComments).mockResolvedValue([comment()]);
      await screen.findByRole("heading", { name: "Public Comments (1)" });
      expect(screen.queryByLabelText("Add Public Comment")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Post Comment" })).not.toBeInTheDocument();
      expect(within(panel()).getByText("This Ticket is closed, so comments can no longer be added.")).toBeInTheDocument();
      expect(within(panel()).getByText("We are investigating the issue on your device.")).toBeInTheDocument();
      unmount();
      vi.restoreAllMocks();
    }
  });

  it("explains it when the server refuses a comment because the Ticket was closed in the meantime", async () => {
    await openWith([]);
    vi.spyOn(api, "postTicketComment").mockRejectedValue(new ApiError("closed", 409, "TICKET_TERMINAL"));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add Public Comment"), "one more thing");
    await user.click(screen.getByRole("button", { name: "Post Comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This Ticket is closed, so comments can no longer be added.");
    expect(screen.getByLabelText("Add Public Comment")).toHaveValue("one more thing");
  });

  it("offers Retry when the comments cannot be loaded, and keeps the Ticket itself readable", async () => {
    renderApp("/tickets/42", REQUESTER);
    vi.mocked(api.getTicketDetail).mockResolvedValue(ticket());
    vi.mocked(api.getTicketComments).mockRejectedValueOnce(new ApiError("down", 500)).mockResolvedValueOnce([comment()]);
    await screen.findByLabelText("Ticket No.");
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the comments.");
    expect(screen.getByLabelText("Summary")).toHaveValue("Cannot connect to the VPN");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await within(panel()).findByText("We are investigating the issue on your device.")).toBeInTheDocument();
  });

  it("shows a body containing markup as literal text", async () => {
    const markup = `<img src=x onerror="alert(1)"> <b>bold</b>`;
    await openWith([comment({ body: markup })]);
    expect(within(panel()).getByText(markup)).toBeInTheDocument();
    expect(panel().querySelector("img, b")).toBeNull();
  });

  // UI-22 / AC-04
  it("has no Internal Notes anywhere: no tab, no heading, no composer, and no request for notes", async () => {
    await openWith([comment()]);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText(/internal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/notes?\b/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/note/i)).not.toBeInTheDocument();
    expect(api.getTicketNotes).not.toHaveBeenCalled();
    expect(vi.spyOn(api, "postTicketNote")).not.toHaveBeenCalled();
  });
});
