import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import * as api from "../../src/api.js";
import { ApiError, type ContentItem } from "../../src/api.js";
import { AuthProvider } from "../../src/authContext.js";
import { useContentThread } from "../../src/content.js";
import { ROUTER_FUTURE } from "../../src/routerFuture.js";
import CreateTicket from "../../src/screens/CreateTicket.js";
import { REQUESTER, STAFF, renderApp } from "../lab-03/support.js";

// Every client source file as text, keyed by its path from the client folder ("src/...").
const SOURCES = Object.fromEntries(
  Object.entries(import.meta.glob("../../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>).map(([path, text]) => [path.replace("../../", ""), text]),
);
// The stylesheet as text. Vitest turns CSS imports into empty strings and the client has no Node types,
// so the file is read through a runtime import typed just for this.
const FS = "node:fs";
const { readFileSync: readText } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (path: string, encoding: "utf8") => string };
const css = readText("src/zen-green.css", "utf8");

// Lab 4 FR-17, FR-19, BR-39, BR-43: the forms keep what was typed and their Idempotency-Key across a
// failure, and the Lab 4 sources keep to the stylesheet.

afterEach(() => {
  vi.restoreAllMocks();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const down = () => new ApiError("Unable to reach the TokTickIT API.", 0, "NETWORK_ERROR");

describe("Create Ticket keeps the key and the text across a failure", () => {
  // UI-25 / AC-39, AC-42, BR-39
  it("sends an Idempotency-Key, reuses it when the same content is sent again, and keeps the typed text", async () => {
    vi.spyOn(api, "getCurrentUser").mockResolvedValue(REQUESTER);
    vi.spyOn(api, "getCategories").mockResolvedValue([{ id: 1, name: "Hardware" }]);
    vi.spyOn(api, "getRelatedSystems").mockResolvedValue([{ id: 1, name: "Staff VPN" }]);
    const create = vi.spyOn(api, "createTicket").mockRejectedValue(new Error("Unable to reach the TokTickIT API. Check your connection and try again."));
    render(
      <MemoryRouter future={ROUTER_FUTURE} initialEntries={["/tickets/new"]}>
        <AuthProvider>
          <CreateTicket />
        </AuthProvider>
      </MemoryRouter>,
    );
    await userEvent.selectOptions(await screen.findByLabelText(/category \*/i), "1");
    await userEvent.selectOptions(screen.getByLabelText(/related system \*/i), "1");
    await userEvent.selectOptions(screen.getByLabelText(/requested priority \*/i), "MEDIUM");
    await userEvent.type(screen.getByLabelText(/summary \*/i), "Laptop battery drains quickly");
    await userEvent.type(screen.getByLabelText(/description \*/i), "The battery falls below 20 percent after a short session every day.");

    const submit = screen.getByRole("button", { name: /submit ticket/i });
    await userEvent.click(submit);
    expect(await screen.findByText(/Unable to reach the TokTickIT API/)).toBeInTheDocument();
    expect(screen.getByLabelText(/summary \*/i)).toHaveValue("Laptop battery drains quickly");
    await userEvent.click(submit);
    expect(create).toHaveBeenCalledTimes(2);
    const [first, second] = create.mock.calls.map((c) => c[1]);
    expect(first).toMatch(UUID);
    expect(second).toBe(first);

    // Changed content is a different request, so it gets a new key.
    await userEvent.type(screen.getByLabelText(/summary \*/i), " again");
    await userEvent.click(submit);
    expect(create.mock.calls[2][1]).not.toBe(first);
  });
});

describe("the Public Comment and Internal Note composer", () => {
  const item: ContentItem = { id: 9, body: "Thanks, restarting now.", authorName: "Kanokwan Srisuwan", authorRole: "REQUESTER", createdAt: "2026-10-31T03:00:00.000Z" };
  const thread = (send: (id: number, body: string, key: string) => Promise<ContentItem>) =>
    renderHook(() => useContentThread(42, async () => [], send, "comment"));

  // UI-25 / AC-39, AC-42, BR-39 (both composers share this hook)
  it("keeps the key for a retry of the same text and the text after a failure, and starts a new key after success", async () => {
    const send = vi.fn().mockRejectedValueOnce(down()).mockResolvedValueOnce(item).mockResolvedValueOnce({ ...item, id: 10 });
    const { result } = thread(send);
    act(() => result.current.setDraft("Thanks, restarting now."));
    await act(() => result.current.post());
    expect(result.current.problem).toBe("Unable to add the comment. Nothing was added.");
    expect(result.current.draft).toBe("Thanks, restarting now.");
    await act(() => result.current.post());
    expect(send.mock.calls[0][2]).toMatch(UUID);
    expect(send.mock.calls[1][2]).toBe(send.mock.calls[0][2]);
    expect(result.current.items.map((i) => i.id)).toEqual([9]);
    expect(result.current.draft).toBe("");

    act(() => result.current.setDraft("One more thing about the printer."));
    await act(() => result.current.post());
    expect(send.mock.calls[2][2]).not.toBe(send.mock.calls[0][2]);
  });

  // UI-27 / AC-40, BR-39
  it("on IDEMPOTENCY_KEY_REUSED keeps the text, shows the server's message, and sends the next one with a new key", async () => {
    const reused = new ApiError("This request was already submitted with different content. Refresh and try again.", 409, "IDEMPOTENCY_KEY_REUSED");
    const send = vi.fn().mockRejectedValueOnce(reused).mockResolvedValueOnce(item);
    const { result } = thread(send);
    act(() => result.current.setDraft("Thanks, restarting now."));
    await act(() => result.current.post());
    expect(result.current.problem).toBe(reused.message);
    expect(result.current.draft).toBe("Thanks, restarting now.");
    await act(() => result.current.post());
    expect(send.mock.calls[1][2]).not.toBe(send.mock.calls[0][2]);
  });

  // A replay answers with the record already created; it is never listed twice.
  it("lists a replayed comment once", async () => {
    const send = vi.fn().mockResolvedValue(item);
    const { result } = renderHook(() => useContentThread(42, async () => [item], send, "comment"));
    await act(async () => {});
    act(() => result.current.setDraft("Thanks, restarting now."));
    await act(() => result.current.post());
    expect(result.current.items.map((i) => i.id)).toEqual([9]);
  });
});

describe("Lab 4 sources keep to the stylesheet", () => {
  const LAB4 = ["src/ActionsTaken.tsx", "src/StatusHistory.tsx", "src/dashboard.tsx", "src/screens/StaffDashboard.tsx", "src/screens/RequesterDashboard.tsx"];

  // STYLE-03 / FR-19
  it("has no hex colour literal outside zen-green.css", () => {
    for (const file of LAB4) expect(Object.keys(SOURCES)).toContain(file);
    // A colour, not an HTML entity such as &#9432;.
    for (const file of LAB4) expect(SOURCES[file], file).not.toMatch(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/);
    // And nowhere else in the client source either.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    for (const [file, text] of Object.entries(SOURCES)) expect(text, file).not.toMatch(/["'`]#[0-9a-fA-F]{3,8}["'`]/);
  });

  // STYLE-03 / FR-19
  it("uses only zg- classes that the stylesheet defines", () => {
    for (const file of LAB4) {
      // Element ids and ARIA references may use the zg- prefix too; only class names must exist in the stylesheet.
      const source = SOURCES[file].replace(/\b(id|htmlFor|aria-[a-z]+)=("[^"]*"|\{[^}]*\})/g, "");
      const used = new Set(source.match(/\bzg-[a-z0-9-]+/g) ?? []);
      for (const cls of used) expect(css, `${file}: .${cls}`).toMatch(new RegExp(`\\.${cls}(?![a-z0-9-])`));
    }
  });
});

describe("focus after a control removes itself (FR-17, the #84 sweep)", () => {
  // Lab 4 FR-17: Clear filters lands on Search, the first filter
  it("moves focus to Search after Clear filters on the queue", async () => {
    renderApp("/staff/tickets?itPriority=HIGH", STAFF);
    await userEvent.click((await screen.findAllByRole("button", { name: "Clear filters" }))[0]);
    expect(screen.getByRole("searchbox", { name: "Search tickets" })).toHaveFocus();
  });

  // Lab 4 FR-17: Retry goes away while it loads; focus goes to the screen's heading, never the page
  it("moves focus to the screen heading after Retry, not to the page", async () => {
    renderApp("/staff/tickets", STAFF);
    vi.mocked(api.getStaffTickets).mockRejectedValueOnce(down());
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Ticket Queue" })).toHaveFocus());
  });
});
