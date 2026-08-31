import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import * as api from "../../src/api.js";
import type { Requester, TicketDetail } from "../../src/api.js";

const STORAGE_KEY = "toktickit.currentRequesterId";
const ARI: Requester = { id: 1, name: "Ari Anan", email: "ari.anan@example.com" };

function ticketDetail(): TicketDetail {
  return {
    id: 42,
    ticketNumber: "TKT-2026-000042",
    requesterId: 1,
    requesterName: "Ari Anan",
    categoryId: 3,
    categoryName: "Hardware",
    relatedSystemId: 5,
    relatedSystemName: "Corporate Laptop",
    summary: "Laptop battery drains quickly",
    description: "Battery drains fast.",
    requestedPriority: "MEDIUM",
    currentStatus: "NEW",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachments: [],
  };
}

function renderAt(path: string) {
  localStorage.setItem(STORAGE_KEY, String(ARI.id));
  vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
  vi.spyOn(api, "getCategories").mockResolvedValue([]);
  vi.spyOn(api, "getTickets").mockResolvedValue({
    data: [],
    pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
  });
  vi.spyOn(api, "getTicketDetail").mockResolvedValue(ticketDetail());
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Application shell navigation", () => {
  // ui-spec.md §11 — the active nav item is marked with aria-current="page".
  it("marks My Tickets as the current page on the list screen", async () => {
    renderAt("/tickets");

    const myTickets = await screen.findByRole("link", { name: "My Tickets" });
    expect(myTickets).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Create Ticket" })).not.toHaveAttribute("aria-current");
  });

  it("keeps My Tickets current on Ticket Detail, which belongs to that section", async () => {
    renderAt("/tickets/42");

    const myTickets = await screen.findByRole("link", { name: "My Tickets" });
    expect(myTickets).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Create Ticket" })).not.toHaveAttribute("aria-current");
  });

  it("marks only Create Ticket as current on the create screen", async () => {
    renderAt("/tickets/new");

    const createTicket = await screen.findByRole("link", { name: "Create Ticket" });
    expect(createTicket).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "My Tickets" })).not.toHaveAttribute("aria-current");
  });

  // ui-spec.md §10 — the nav collapses to a toggleable menu below 768px.
  it("exposes a labelled nav toggle that opens and closes the collapsed menu", async () => {
    renderAt("/tickets");

    const toggle = await screen.findByRole("button", { name: "Toggle navigation" });
    const menu = document.getElementById("main-nav");

    expect(toggle).toHaveAttribute("aria-controls", "main-nav");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(menu).not.toHaveClass("show");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(menu).toHaveClass("show");

    // Following a link closes the menu again so it never covers the screen.
    await userEvent.click(screen.getByRole("link", { name: "Create Ticket" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(menu).not.toHaveClass("show");
  });
});
