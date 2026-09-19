import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as api from "../../src/api.js";
import type { AuthUser, Requester } from "../../src/api.js";
import { AuthProvider } from "../../src/authContext.js";
import { RequesterProvider, useRequester } from "../../src/requesterContext.js";
import { ADMIN, REQUESTER, STAFF, renderApp } from "./support.js";

const STORAGE_KEY = "toktickit.currentRequesterId";
// A Development Requester left over from the Lab 2 selector, in browser storage.
const LEGACY: Requester = { id: 1, name: "Legacy Selected Requester", email: "legacy@toktickit.test" };

const QUEUE_DENIED = "You do not have access to the Ticket Queue.";
const USERS_DENIED = "You do not have access to User Management.";
const TICKETS_DENIED = "You do not have access to Requester tickets.";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// Nothing behind a forbidden screen may have been requested: the API calls the
// Requester screens make on mount must not have happened.
function expectNoProtectedRequests() {
  expect(api.getTickets).not.toHaveBeenCalled();
  expect(api.getCategories).not.toHaveBeenCalled();
  expect(api.getRelatedSystems).not.toHaveBeenCalled();
  expect(api.getTicketDetail).not.toHaveBeenCalled();
}

describe("role based route protection", () => {
  // UI-31 / AC-46, BR-63, BR-16
  it.each<[string, AuthUser, string, string]>([
    ["a Requester opening the staff queue", REQUESTER, "/staff/tickets", QUEUE_DENIED],
    ["a Requester opening User Management", REQUESTER, "/admin/users", USERS_DENIED],
    ["IT Staff opening User Management", STAFF, "/admin/users", USERS_DENIED],
    ["IT Staff opening My Tickets", STAFF, "/tickets", TICKETS_DENIED],
    ["IT Staff opening Create Ticket", STAFF, "/tickets/new", TICKETS_DENIED],
    ["IT Staff opening a Requester Ticket Detail", STAFF, "/tickets/5", TICKETS_DENIED],
    ["an Administrator opening My Tickets", ADMIN, "/tickets", TICKETS_DENIED],
    ["an Administrator opening Create Ticket", ADMIN, "/tickets/new", TICKETS_DENIED],
    ["an Administrator opening a Requester Ticket Detail", ADMIN, "/tickets/5", TICKETS_DENIED],
  ])("blocks %s by direct URL with a forbidden state and requests nothing", async (_who, user, path, message) => {
    renderApp(path, user);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    // The protected screen never rendered, and no Requester navigation is offered.
    expect(screen.queryByRole("heading", { name: /^Signed in as/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Tickets" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create Ticket" })).not.toBeInTheDocument();
    expectNoProtectedRequests();
    // The way out is the user's own home screen, not the screen they were refused.
    expect(screen.getByRole("link", { name: "Go to your home screen" })).toHaveAttribute(
      "href",
      user.role === "ADMINISTRATOR" ? "/admin/users" : user.role === "IT_STAFF" ? "/staff/tickets" : "/tickets",
    );
  });

  it.each<[string, AuthUser, string, RegExp]>([
    ["IT Staff on the staff queue", STAFF, "/staff/tickets", /^Signed in as Pimchanok Somboon$/],
    ["an Administrator on the staff queue", ADMIN, "/staff/tickets", /^Signed in as Aekkarat Wongsa$/],
    ["an Administrator on User Management", ADMIN, "/admin/users", /^Signed in as Aekkarat Wongsa$/],
    ["a Requester on My Tickets", REQUESTER, "/tickets", /^My Tickets$/],
  ])("still lets %s in", async (_who, user, path, heading) => {
    renderApp(path, user);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access denied" })).not.toBeInTheDocument();
  });

  it.each(["/staff/tickets", "/admin/users"])("sends a signed-out visitor to Login instead of %s", async (path) => {
    renderApp(path, null);
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access denied" })).not.toBeInTheDocument();
  });

  it("sends an unknown URL to the signed-in user's own landing route, never to Requester screens", async () => {
    renderApp("/no/such/page", STAFF);
    expect(await screen.findByRole("heading", { name: `Signed in as ${STAFF.name}` })).toBeInTheDocument();
    expectNoProtectedRequests();

    vi.restoreAllMocks();
    renderApp("/still/not/a/page", ADMIN);
    expect(await screen.findAllByRole("heading", { name: `Signed in as ${ADMIN.name}` })).not.toHaveLength(0);
  });
});

describe("the legacy Development Requester selection", () => {
  function storeLegacySelection() {
    localStorage.setItem(STORAGE_KEY, String(LEGACY.id));
  }

  // UI-32 / AC-46, BR-63
  it.each<[string, string, AuthUser]>([
    ["IT Staff", "/tickets", STAFF],
    ["IT Staff", "/tickets/new", STAFF],
    ["an Administrator", "/tickets", ADMIN],
    ["an Administrator", "/tickets/9", ADMIN],
  ])("is ignored for %s, who cannot use it to reach the Requester screen %s", async (_who, path, user) => {
    storeLegacySelection();
    renderApp(path, user, { requesters: [LEGACY] });

    expect(await screen.findByText("You do not have access to Requester tickets.")).toBeInTheDocument();
    expect(screen.queryByText(LEGACY.name)).not.toBeInTheDocument();
    expectNoProtectedRequests();
    // Ignoring is not clearing: the stored value is left alone for the Lab 2 flow.
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(LEGACY.id));
  });

  it.each([STAFF, ADMIN])("never shows the selector to a signed-in %#, even with a stored selection", async (user) => {
    storeLegacySelection();
    renderApp("/select-requester", user, { requesters: [LEGACY] });

    expect(await screen.findByRole("heading", { name: `Signed in as ${user.name}` })).toBeInTheDocument();
    expect(screen.queryByText("Select Development Requester")).not.toBeInTheDocument();
  });

  it("never lets a stored selection override the identity of a signed-in Requester", async () => {
    storeLegacySelection();
    renderApp("/tickets", REQUESTER, { requesters: [LEGACY] });

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    expect(screen.getByText(REQUESTER.name)).toBeInTheDocument();
    expect(screen.queryByText(LEGACY.name)).not.toBeInTheDocument();
    // Requests are made as the signed-in user (id 7), never as the stored id (1).
    const calls = vi.mocked(api.getTickets).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([params]) => params.requesterId === REQUESTER.id)).toBe(true);
  });
});

// The role check on the Requester routes would catch these users first, so the
// context is exercised on its own: whoever is signed in, the requester it hands
// to the Lab 2 screens must come from the session and never from storage.
describe("the requester context under a signed-in user", () => {
  function Probe() {
    const { requester, status } = useRequester();
    return <p data-testid="probe">{`${status}:${requester?.name ?? "none"}`}</p>;
  }

  async function probe(currentUser: AuthUser | null) {
    localStorage.setItem(STORAGE_KEY, String(LEGACY.id));
    vi.spyOn(api, "getCurrentUser").mockResolvedValue(currentUser);
    vi.spyOn(api, "getRequesters").mockResolvedValue([LEGACY]);
    render(
      <MemoryRouter>
        <AuthProvider>
          <RequesterProvider>
            <Probe />
          </RequesterProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByText(/^resolved:/);
    return screen.getByTestId("probe").textContent;
  }

  // UI-32 / AC-46, BR-63
  it.each([
    ["IT Staff", STAFF],
    ["an Administrator", ADMIN],
  ])("gives %s no requester at all, whatever is stored", async (_who, user) => {
    expect(await probe(user)).toBe("resolved:none");
  });

  it("gives a signed-in Requester themselves, not the stored selection", async () => {
    expect(await probe(REQUESTER)).toBe(`resolved:${REQUESTER.name}`);
  });

  it("still honours the stored selection while nobody is signed in, so the Lab 2 flow is unchanged", async () => {
    expect(await probe(null)).toBe(`resolved:${LEGACY.name}`);
  });
});
