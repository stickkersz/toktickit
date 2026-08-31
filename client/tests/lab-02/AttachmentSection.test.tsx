import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function renderAtDetail() {
  localStorage.setItem(STORAGE_KEY, String(ARI.id));
  return render(
    <MemoryRouter initialEntries={["/tickets/42"]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Attachments — add flow", () => {
  // UI-11
  it("adds a valid attachment to the active list once the upload resolves", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getTicketDetail").mockResolvedValue(ticketDetail());
    vi.spyOn(api, "uploadAttachments").mockResolvedValue({
      uploaded: [
        {
          id: 9,
          originalFilename: "receipt.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1024,
          uploadedAt: new Date().toISOString(),
          isRemoved: false,
        },
      ],
      failed: [],
    });

    const user = userEvent.setup();
    renderAtDetail();
    await screen.findByDisplayValue("Laptop battery drains quickly");

    const file = new File(["x"], "receipt.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText("Add Attachment");
    await user.upload(input, file);

    expect(await screen.findByText("receipt.jpg")).toBeInTheDocument();
    expect(screen.getByText("Attachments (1 active)")).toBeInTheDocument();
  });

  it("shows an inline error for a rejected file and never uploads it", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getTicketDetail").mockResolvedValue(ticketDetail());
    const uploadSpy = vi.spyOn(api, "uploadAttachments");

    const user = userEvent.setup();
    renderAtDetail();
    await screen.findByDisplayValue("Laptop battery drains quickly");

    const file = new File(["x"], "notes.docx", { type: "application/msword" });
    const input = screen.getByLabelText("Add Attachment");
    await user.upload(input, file);

    expect(await screen.findByText("notes.docx")).toBeInTheDocument();
    expect(screen.getByText(/only jpg, jpeg, png, webp, and pdf/i)).toBeInTheDocument();
    expect(uploadSpy).not.toHaveBeenCalled();
  });
});

describe("Attachments — remove flow", () => {
  // UI-12
  it("requires a valid reason before Confirm is enabled, then removes the row without a reload", async () => {
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
        ],
      }),
    );
    vi.spyOn(api, "removeAttachment").mockResolvedValue({
      id: 7,
      originalFilename: "battery-report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 204800,
      uploadedAt: new Date().toISOString(),
      isRemoved: true,
      removedAt: new Date().toISOString(),
      removalReason: "Duplicate of another attachment",
    });

    const user = userEvent.setup();
    renderAtDetail();
    await screen.findByText("battery-report.pdf");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    expect(confirmButton).toBeDisabled();

    const reasonField = screen.getByLabelText(/reason for removal/i);
    fireEvent.change(reasonField, { target: { value: "hi" } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(reasonField, { target: { value: "Duplicate of another attachment" } });
    await waitFor(() => expect(confirmButton).not.toBeDisabled());

    await user.click(confirmButton);

    expect(await screen.findByText("Removed")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });
});
