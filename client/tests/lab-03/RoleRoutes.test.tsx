import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import * as api from "../../src/api.js";
import type { AuthUser } from "../../src/api.js";
import { ADMIN, REQUESTER, STAFF, renderApp } from "./support.js";

const STORAGE_KEY = "toktickit.currentRequesterId";
// What the Lab 2 Development Requester selector left in browser storage. The selector
// and everything that read this key are gone (BR-49); a stale value must do nothing.
const LEGACY_KEY = "toktickit.currentRequesterId";

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
    // The protected screen never rendered.
    expect(screen.queryByRole("heading", { name: "User Management" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Tickets" })).not.toBeInTheDocument();
    // The refusal sits inside the caller's own shell, so only their own role's
    // navigation is offered: staff and administrators never see Requester links.
    if (user.role !== "REQUESTER") {
      expect(screen.queryByRole("link", { name: "Create Ticket" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "My Tickets" })).not.toBeInTheDocument();
    }
    expectNoProtectedRequests();
    // The way out is the user's own home screen, not the screen they were refused.
    expect(screen.getByRole("link", { name: "Go to your home screen" })).toHaveAttribute(
      "href",
      user.role === "ADMINISTRATOR" ? "/admin/users" : user.role === "IT_STAFF" ? "/staff/tickets" : "/tickets",
    );
  });

  it.each<[string, AuthUser, string, RegExp]>([
    ["IT Staff on the staff queue", STAFF, "/staff/tickets", /^Ticket Queue$/],
    ["an Administrator on the staff queue", ADMIN, "/staff/tickets", /^Ticket Queue$/],
    ["an Administrator on User Management", ADMIN, "/admin/users", /^User Management$/],
    ["a Requester on My Tickets", REQUESTER, "/tickets", /^My Tickets$/],
  ])("still lets %s in", async (_who, user, path, heading) => {
    renderApp(path, user);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access denied" })).not.toBeInTheDocument();
  });

  // Lab 2 guaranteed that no ticket screen rendered without a current Requester and sent
  // the visitor to the selector; the same guarantee now sends them to Login (AC-13).
  it.each(["/tickets", "/tickets/new", "/tickets/42"])("sends a signed-out visitor to Login instead of %s, requesting nothing", async (path) => {
    renderApp(path, null);
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expectNoProtectedRequests();
  });

  it.each(["/staff/tickets", "/admin/users"])("sends a signed-out visitor to Login instead of %s", async (path) => {
    renderApp(path, null);
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access denied" })).not.toBeInTheDocument();
  });

  it("sends an unknown URL to the signed-in user's own landing route, never to Requester screens", async () => {
    renderApp("/no/such/page", STAFF);
    expect(await screen.findByRole("heading", { name: "Ticket Queue" })).toBeInTheDocument();
    // The queue loads its own filter list, so only the Requester screens' requests are ruled out.
    expect(api.getTickets).not.toHaveBeenCalled();
    expect(api.getTicketDetail).not.toHaveBeenCalled();
    expect(api.getRelatedSystems).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    renderApp("/still/not/a/page", ADMIN);
    // An Administrator lands on User Management.
    expect(await screen.findByRole("heading", { name: "User Management" })).toBeInTheDocument();
  });
});

describe("a stale Lab 2 Development Requester selection in browser storage", () => {
  beforeEach(() => localStorage.setItem(LEGACY_KEY, "1"));

  // UI-32 / AC-46, BR-63, BR-49
  it.each<[string, string, AuthUser]>([
    ["IT Staff", "/tickets", STAFF],
    ["IT Staff", "/tickets/new", STAFF],
    ["an Administrator", "/tickets", ADMIN],
    ["an Administrator", "/tickets/9", ADMIN],
  ])("gives %s no way onto the Requester screen %s", async (_who, path, user) => {
    renderApp(path, user);

    expect(await screen.findByText("You do not have access to Requester tickets.")).toBeInTheDocument();
    expectNoProtectedRequests();
    // Nothing reads the key any more, so nothing clears it either.
    expect(localStorage.getItem(LEGACY_KEY)).toBe("1");
  });

  it("does not let it stand in for signing in", async () => {
    renderApp("/tickets", null);
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expectNoProtectedRequests();
  });

  it("has no selector screen to go to: /select-requester is an unknown URL, for every role", async () => {
    renderApp("/select-requester", null);
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.queryByText("Select Development Requester")).not.toBeInTheDocument();

    vi.restoreAllMocks();
    renderApp("/select-requester", STAFF);
    expect(await screen.findByRole("heading", { name: "Ticket Queue" })).toBeInTheDocument();
    expect(screen.queryByText("Select Development Requester")).not.toBeInTheDocument();
  });

  it("leaves a signed-in Requester acting as themselves", async () => {
    renderApp("/tickets", REQUESTER);

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    expect(screen.getByText(REQUESTER.name)).toBeInTheDocument();
    expect(api.getTickets).toHaveBeenCalled();
  });
});
