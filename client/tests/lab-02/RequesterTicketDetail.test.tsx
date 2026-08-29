import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import * as api from "../../src/api.js";
import type { Requester, TicketDetail } from "../../src/api.js";

const STORAGE_KEY = "toktickit.currentRequesterId";
const ARI: Requester = { id: 1, name: "Ari Anan", email: "ari.anan@example.com" };

function ticketDetail(overrides: Partial<TicketDetail> = {}): TicketDetail {
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
    description: "My laptop battery is draining much faster than usual.",
    requestedPriority: "MEDIUM",
    currentStatus: "NEW",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachments: [],
    ...overrides,
  };
}

function renderAtDetail(ticketId = 42, requester: Requester = ARI) {
  localStorage.setItem(STORAGE_KEY, String(requester.id));
  return render(
    <MemoryRouter initialEntries={[`/tickets/${ticketId}`]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Requester Ticket Detail", () => {
  // UI-10
  it("renders read-only Ticket detail with no Comments/Notes/Actions/status controls (handout §8.5)", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getTicketDetail").mockResolvedValue(ticketDetail());

    renderAtDetail();

    expect(await screen.findByDisplayValue("Laptop battery drains quickly")).toBeInTheDocument();
    expect(screen.queryByText(/public comment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/internal note/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/actions taken/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /status/i })).not.toBeInTheDocument();
  });

  it("shows a full-page not-found message for a nonexistent or unowned Ticket (BR-35)", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getTicketDetail").mockRejectedValue(new api.NotFoundError("Ticket not found."));

    renderAtDetail(999);

    expect(await screen.findByText(/ticket not found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to my tickets/i })).toBeInTheDocument();
  });

  it("shows the active attachment count and both active and removed rows", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getTicketDetail").mockResolvedValue(
      ticketDetail({
        attachments: [
          {
            id: 7,
            originalFilename: "battery-report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 204800,
            uploadedAt: new Date().toISOString(),
            isRemoved: false,
          },
          {
            id: 6,
            originalFilename: "old-screenshot.png",
            mimeType: "image/png",
            sizeBytes: 51200,
            uploadedAt: new Date().toISOString(),
            isRemoved: true,
            removedAt: new Date().toISOString(),
            removalReason: "Wrong file attached by mistake",
          },
        ],
      }),
    );

    renderAtDetail();

    expect(await screen.findByText("Attachments (1 active)")).toBeInTheDocument();
    expect(screen.getByText("battery-report.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByText("old-screenshot.png")).toBeInTheDocument();
    expect(screen.getByText(/wrong file attached by mistake/i)).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });
});
