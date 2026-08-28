import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import * as api from "../../src/api.js";
import type { Requester, TicketListItem, TicketListParams, TicketListResult } from "../../src/api.js";

const STORAGE_KEY = "toktickit.currentRequesterId";
const ARI: Requester = { id: 1, name: "Ari Anan", email: "ari.anan@example.com" };
const BEN: Requester = { id: 2, name: "Ben Boon", email: "ben.boon@example.com" };

function ticket(overrides: Partial<TicketListItem> = {}): TicketListItem {
  return {
    id: 1,
    ticketNumber: "TKT-2026-000001",
    summary: "Sample ticket",
    categoryName: "Hardware",
    requestedPriority: "MEDIUM",
    currentStatus: "NEW",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function listResult(
  data: TicketListItem[],
  overrides: Partial<TicketListResult["pagination"]> = {},
): TicketListResult {
  return {
    data,
    pagination: {
      page: 1,
      pageSize: 10,
      total: data.length,
      totalPages: data.length > 0 ? 1 : 0,
      ...overrides,
    },
  };
}

function renderAtTickets(requester: Requester = ARI) {
  localStorage.setItem(STORAGE_KEY, String(requester.id));
  return render(
    <MemoryRouter initialEntries={["/tickets"]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("My Tickets", () => {
  // UI-07
  it("shows the create-your-first-ticket empty state with filters hidden (AC-21)", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getCategories").mockResolvedValue([]);
    vi.spyOn(api, "getTickets").mockResolvedValue(listResult([]));

    renderAtTickets();

    expect(await screen.findByText(/haven't submitted any tickets yet/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search by ticket number/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /create ticket/i }).length).toBeGreaterThan(0);
  });

  // UI-08
  it("shows the no-results state with filters still visible once a search narrows to zero (AC-12)", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getCategories").mockResolvedValue([]);
    const getTicketsSpy = vi
      .spyOn(api, "getTickets")
      .mockResolvedValueOnce(listResult([ticket({ summary: "Existing ticket" })]))
      .mockResolvedValueOnce(listResult([]));

    renderAtTickets();
    await screen.findAllByText("Existing ticket");

    const search = screen.getByPlaceholderText(/search by ticket number/i);
    fireEvent.change(search, { target: { value: "nothing matches this" } });

    expect(await screen.findByText(/no tickets match your filters/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search by ticket number/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /clear filters/i }).length).toBeGreaterThan(0);
    expect(getTicketsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "nothing matches this" }),
    );
  });

  // UI-17
  it("renders pagination controls and requests the next page on click (AC-13)", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getCategories").mockResolvedValue([]);
    const page1 = listResult(
      Array.from({ length: 10 }, (_, i) => ticket({ id: i + 1, summary: `Ticket ${i + 1}` })),
      { page: 1, total: 25, totalPages: 3 },
    );
    const page2 = listResult(
      Array.from({ length: 10 }, (_, i) => ticket({ id: i + 11, summary: `Ticket ${i + 11}` })),
      { page: 2, total: 25, totalPages: 3 },
    );
    const getTicketsSpy = vi
      .spyOn(api, "getTickets")
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    renderAtTickets();
    expect(await screen.findByText(/page 1 of 3/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));

    expect(await screen.findByText(/page 2 of 3/i)).toBeInTheDocument();
    expect(getTicketsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 } as Partial<TicketListParams>),
    );
  });

  it("ignores a slower, superseded request's result (out-of-order search responses)", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getCategories").mockResolvedValue([]);

    let resolveSlow: (value: TicketListResult) => void = () => {};
    vi.spyOn(api, "getTickets").mockImplementation((params: TicketListParams) => {
      if (params.search === "slow") {
        return new Promise((resolve) => {
          resolveSlow = resolve;
        });
      }
      if (params.search === "fast") {
        return Promise.resolve(listResult([ticket({ summary: "Fast result" })]));
      }
      return Promise.resolve(listResult([ticket({ summary: "Initial ticket" })]));
    });

    renderAtTickets();
    await screen.findAllByText("Initial ticket");

    const search = screen.getByPlaceholderText(/search by ticket number/i);
    fireEvent.change(search, { target: { value: "slow" } });
    // The "slow" request is now pending. Before it resolves, search again;
    // the "fast" request resolves first and must win.
    fireEvent.change(search, { target: { value: "fast" } });

    expect((await screen.findAllByText("Fast result"))[0]).toBeInTheDocument();

    // The stale "slow" request finally resolves; it must not overwrite the
    // already-rendered, more recent "fast" result.
    resolveSlow(listResult([ticket({ summary: "Slow result" })]));
    await Promise.resolve();
    expect(screen.queryByText("Slow result")).not.toBeInTheDocument();
    expect(screen.getAllByText("Fast result")[0]).toBeInTheDocument();
  });

  it("shows a failure state with Retry and clears stale rows when a later request fails (AC-13-adjacent)", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getCategories").mockResolvedValue([]);
    const getTicketsSpy = vi
      .spyOn(api, "getTickets")
      .mockResolvedValueOnce(listResult([ticket({ summary: "Soon-to-be-stale ticket" })]))
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(listResult([ticket({ summary: "Recovered ticket" })]));

    renderAtTickets();
    await screen.findAllByText("Soon-to-be-stale ticket");

    const search = screen.getByPlaceholderText(/search by ticket number/i);
    fireEvent.change(search, { target: { value: "trigger failure" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/unable to load your tickets/i);
    expect(screen.queryByText("Soon-to-be-stale ticket")).not.toBeInTheDocument();
    // The toolbar stays available so the user isn't stuck.
    expect(screen.getByPlaceholderText(/search by ticket number/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect((await screen.findAllByText("Recovered ticket"))[0]).toBeInTheDocument();
    expect(getTicketsSpy).toHaveBeenCalledTimes(3);
  });

  it("provides a reduced tablet table and a separate mobile card list for the same data (ui-spec.md §7)", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getCategories").mockResolvedValue([]);
    vi.spyOn(api, "getTickets").mockResolvedValue(
      listResult([ticket({ summary: "Responsive ticket" })]),
    );

    const { container } = renderAtTickets();
    await screen.findAllByText("Responsive ticket");

    // Desktop/tablet table: hidden below md (768px), Created Date/Category
    // hidden below lg (992px) for the tablet 5-column layout.
    const tableWrapper = container.querySelector(".table-responsive");
    expect(tableWrapper).toHaveClass("d-none", "d-md-block");
    const headers = screen.getAllByRole("columnheader");
    const createdDateHeader = headers.find((h) => h.textContent?.startsWith("Created Date"));
    const categoryHeader = headers.find((h) => h.textContent === "Category");
    expect(createdDateHeader).toHaveClass("d-none", "d-lg-table-cell");
    expect(categoryHeader).toHaveClass("d-none", "d-lg-table-cell");

    // Mobile card list: shown only below md (768px).
    const cardList = screen.getByLabelText("Tickets");
    expect(cardList).toHaveClass("d-md-none");
    expect(cardList.querySelector(".card")).not.toBeNull();
  });

  it("makes sortable headers and ticket rows keyboard-operable", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI]);
    vi.spyOn(api, "getCategories").mockResolvedValue([]);
    const getTicketsSpy = vi
      .spyOn(api, "getTickets")
      .mockResolvedValue(listResult([ticket({ summary: "Keyboard ticket" })]));

    renderAtTickets();
    await screen.findAllByText("Keyboard ticket");

    const summaryHeader = screen.getByRole("columnheader", { name: /^summary/i });
    expect(summaryHeader).toHaveAttribute("tabindex", "0");
    getTicketsSpy.mockClear();
    fireEvent.keyDown(summaryHeader, { key: "Enter" });
    await waitFor(() =>
      expect(getTicketsSpy).toHaveBeenCalledWith(expect.objectContaining({ sort: "summary" })),
    );

    const rows = screen.getAllByText("Keyboard ticket").map((el) => el.closest('[role="button"]'));
    for (const row of rows) {
      expect(row).toHaveAttribute("tabindex", "0");
    }
  });

  // UI-09
  it("clears previously rendered rows before the newly selected Requester's data loads (AC-18)", async () => {
    vi.spyOn(api, "getRequesters").mockResolvedValue([ARI, BEN]);
    vi.spyOn(api, "getCategories").mockResolvedValue([]);

    let resolveBenFetch: (value: TicketListResult) => void = () => {};
    vi.spyOn(api, "getTickets").mockImplementation((params: TicketListParams) => {
      if (params.requesterId === ARI.id) {
        return Promise.resolve(listResult([ticket({ summary: "Ari's ticket" })]));
      }
      return new Promise((resolve) => {
        resolveBenFetch = resolve;
      });
    });

    renderAtTickets(ARI);
    expect((await screen.findAllByText("Ari's ticket"))[0]).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /change requester/i }));
    await screen.findByText(/select development requester/i);
    expect(screen.queryByText("Ari's ticket")).not.toBeInTheDocument();

    await userEvent.selectOptions(
      await screen.findByLabelText(/development requester \*/i),
      String(BEN.id),
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    // Landed back on My Tickets for Ben; his fetch hasn't resolved yet, so
    // Ari's rows must not still be showing (no stale flash, BR-06/AC-18).
    expect(screen.queryByText("Ari's ticket")).not.toBeInTheDocument();

    resolveBenFetch(listResult([ticket({ summary: "Ben's ticket" })]));
    expect((await screen.findAllByText("Ben's ticket"))[0]).toBeInTheDocument();
  });
});
