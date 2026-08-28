import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CreateTicket from "../../src/screens/CreateTicket.js";
import { RequesterProvider } from "../../src/requesterContext.js";
import * as api from "../../src/api.js";
import type { Category, RelatedSystem, Requester, Ticket } from "../../src/api.js";

const STORAGE_KEY = "toktickit.currentRequesterId";
const REQUESTER: Requester = { id: 1, name: "Ari Anan", email: "ari.anan@example.com" };
const CATEGORY: Category = { id: 1, name: "Hardware" };
const RELATED_SYSTEM: RelatedSystem = { id: 1, name: "Staff VPN" };
const VALID_SUMMARY = "Laptop battery drains quickly";
const VALID_DESCRIPTION =
  "The battery falls below 20 percent after a short session, every single day this week.";

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/tickets/new"]}>
      <RequesterProvider>
        <CreateTicket />
      </RequesterProvider>
    </MemoryRouter>,
  );
}

function mockReferenceData() {
  localStorage.setItem(STORAGE_KEY, String(REQUESTER.id));
  vi.spyOn(api, "getRequesters").mockResolvedValue([REQUESTER]);
  vi.spyOn(api, "getCategories").mockResolvedValue([CATEGORY]);
  vi.spyOn(api, "getRelatedSystems").mockResolvedValue([RELATED_SYSTEM]);
}

async function fillValidForm() {
  await userEvent.selectOptions(await screen.findByLabelText(/category \*/i), String(CATEGORY.id));
  await userEvent.selectOptions(
    screen.getByLabelText(/related system \*/i),
    String(RELATED_SYSTEM.id),
  );
  await userEvent.selectOptions(screen.getByLabelText(/requested priority \*/i), "MEDIUM");
  await userEvent.type(screen.getByLabelText(/summary \*/i), VALID_SUMMARY);
  await userEvent.type(screen.getByLabelText(/description \*/i), VALID_DESCRIPTION);
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Create Ticket", () => {
  // UI-01
  it("shows required-field asterisks and keeps Submit disabled until the form is valid", async () => {
    mockReferenceData();
    renderScreen();

    expect(await screen.findByText("Category *")).toBeInTheDocument();
    expect(screen.getByText("Summary *")).toBeInTheDocument();
    expect(screen.getByText("Description *")).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /submit ticket/i });
    expect(submit).toBeDisabled();

    await fillValidForm();
    expect(submit).toBeEnabled();
  });

  // UI-02
  it("shows a field error under Summary and makes no API call when Summary is empty", async () => {
    mockReferenceData();
    const createSpy = vi.spyOn(api, "createTicket");
    const { container } = renderScreen();

    await userEvent.selectOptions(await screen.findByLabelText(/category \*/i), String(CATEGORY.id));
    await userEvent.selectOptions(
      screen.getByLabelText(/related system \*/i),
      String(RELATED_SYSTEM.id),
    );
    await userEvent.selectOptions(screen.getByLabelText(/requested priority \*/i), "MEDIUM");
    await userEvent.type(screen.getByLabelText(/description \*/i), VALID_DESCRIPTION);
    // Summary left empty: Submit stays disabled, so exercise the form's
    // guard directly rather than clicking a disabled button.
    fireEvent.submit(container.querySelector("form")!);

    expect(await screen.findByText(/summary must be between 5 and 120 characters/i)).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  // UI-03
  it("disables Submit and sends only one request when clicked twice quickly", async () => {
    mockReferenceData();
    let resolveCreate: (ticket: Ticket) => void = () => {};
    const createSpy = vi.spyOn(api, "createTicket").mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    renderScreen();
    await fillValidForm();

    const submit = screen.getByRole("button", { name: /submit ticket/i });
    await userEvent.click(submit);
    expect(screen.getByRole("button", { name: /submitting/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /submitting/i }));
    expect(createSpy).toHaveBeenCalledTimes(1);

    resolveCreate({
      id: 1,
      ticketNumber: "TKT-2026-000001",
      requesterId: REQUESTER.id,
      categoryId: CATEGORY.id,
      relatedSystemId: RELATED_SYSTEM.id,
      summary: VALID_SUMMARY,
      description: VALID_DESCRIPTION,
      requestedPriority: "MEDIUM",
      currentStatus: "NEW",
      createdAt: new Date().toISOString(),
    });
    expect(await screen.findByText(/TKT-2026-000001/)).toBeInTheDocument();
  });

  // UI-04
  it("shows a distinct inline error for an oversized file, a wrong-type file, and a 6th file", async () => {
    mockReferenceData();
    renderScreen();
    await screen.findByLabelText(/category \*/i);

    expect(screen.getByText(/jpg, jpeg, png, webp, pdf/i)).toBeInTheDocument();

    const input = screen.getByLabelText(/attachments/i) as HTMLInputElement;

    const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    const wrongType = new File(["x"], "notes.docx", { type: "application/msword" });
    const fiveValid = Array.from(
      { length: 5 },
      (_, i) => new File(["x"], `photo-${i}.jpg`, { type: "image/jpeg" }),
    );
    const sixth = new File(["x"], "photo-6.jpg", { type: "image/jpeg" });

    await userEvent.upload(input, big);
    await userEvent.upload(input, wrongType);
    expect(await screen.findByText(/file exceeds the 5 mb limit/i)).toBeInTheDocument();
    expect(screen.getByText(/only jpg, jpeg, png, webp, and pdf/i)).toBeInTheDocument();

    for (const file of fiveValid) {
      await userEvent.upload(input, file);
    }
    await userEvent.upload(input, sixth);
    expect(await screen.findByText(/maximum of 5 files/i)).toBeInTheDocument();

    // The 5 valid files stay listed and selectable (no error on them).
    expect(screen.getByText("photo-0.jpg")).toBeInTheDocument();
    // Each row shows its size, per ui-spec.md §6.
    expect(screen.getByText("(6.0 MB)")).toBeInTheDocument();
  });

  it("reports a client-rejected file as a retryable warning after the ticket is created", async () => {
    mockReferenceData();
    vi.spyOn(api, "createTicket").mockResolvedValue({
      id: 7,
      ticketNumber: "TKT-2026-000007",
      requesterId: REQUESTER.id,
      categoryId: CATEGORY.id,
      relatedSystemId: RELATED_SYSTEM.id,
      summary: VALID_SUMMARY,
      description: VALID_DESCRIPTION,
      requestedPriority: "MEDIUM",
      currentStatus: "NEW",
      createdAt: new Date().toISOString(),
    });
    const uploadSpy = vi.spyOn(api, "uploadAttachments");

    renderScreen();
    await fillValidForm();

    const wrongType = new File(["x"], "notes.docx", { type: "application/msword" });
    await userEvent.upload(screen.getByLabelText(/attachments/i), wrongType);
    expect(await screen.findByText(/only jpg, jpeg, png, webp, and pdf/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    expect(await screen.findByText(/TKT-2026-000007/)).toBeInTheDocument();
    expect(screen.getByText(/notes\.docx/)).toBeInTheDocument();
    expect(screen.getByText(/only jpg, jpeg, png, webp, and pdf/i)).toBeInTheDocument();
    // Nothing valid to upload, so the server is never even called for it.
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  // UI-05
  it("shows an error banner and preserves entered values when the create request fails", async () => {
    mockReferenceData();
    vi.spyOn(api, "createTicket").mockRejectedValue(new Error("Server unavailable."));

    renderScreen();
    await fillValidForm();
    await userEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    expect(await screen.findByText("Server unavailable.")).toBeInTheDocument();
    expect(screen.getByLabelText(/summary \*/i)).toHaveValue(VALID_SUMMARY);
    expect(screen.getByLabelText(/description \*/i)).toHaveValue(VALID_DESCRIPTION);
  });

  // UI-06
  it("shows the success panel with the ticketNumber and a View Ticket action", async () => {
    mockReferenceData();
    vi.spyOn(api, "createTicket").mockResolvedValue({
      id: 42,
      ticketNumber: "TKT-2026-000042",
      requesterId: REQUESTER.id,
      categoryId: CATEGORY.id,
      relatedSystemId: RELATED_SYSTEM.id,
      summary: VALID_SUMMARY,
      description: VALID_DESCRIPTION,
      requestedPriority: "MEDIUM",
      currentStatus: "NEW",
      createdAt: new Date().toISOString(),
    });

    renderScreen();
    await fillValidForm();
    await userEvent.click(screen.getByRole("button", { name: /submit ticket/i }));

    expect(await screen.findByText(/TKT-2026-000042/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view ticket/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create another/i })).toBeInTheDocument();
  });

  // UI-16
  it("shows a full-form failure banner and no Submit button when reference data fails to load", async () => {
    localStorage.setItem(STORAGE_KEY, String(REQUESTER.id));
    vi.spyOn(api, "getRequesters").mockResolvedValue([REQUESTER]);
    vi.spyOn(api, "getCategories").mockRejectedValue(new Error("down"));
    vi.spyOn(api, "getRelatedSystems").mockResolvedValue([RELATED_SYSTEM]);

    renderScreen();

    expect(await screen.findByText(/unable to load ticket form data/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit ticket/i })).not.toBeInTheDocument();
  });
});
