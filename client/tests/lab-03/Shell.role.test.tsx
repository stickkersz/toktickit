import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import App from "../../src/App.js";
import * as api from "../../src/api.js";
import type { AuthUser } from "../../src/api.js";
import { ADMIN, REQUESTER, STAFF, renderApp } from "./support.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const NAV_LABELS = ["My Tickets", "Create Ticket", "Ticket Queue", "Users"];

// The links inside the main navigation, by accessible name.
function navLinks() {
  const nav = screen.getByRole("navigation", { name: "Main" });
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent)
    .filter((label) => NAV_LABELS.includes(label ?? ""));
}

describe("role navigation", () => {
  // UI-09 / AC-11, FR-05
  it.each<[string, AuthUser, string, string[]]>([
    ["a Requester", REQUESTER, "/tickets", ["My Tickets", "Create Ticket"]],
    ["IT Staff", STAFF, "/staff/tickets", ["Ticket Queue"]],
    ["an Administrator", ADMIN, "/admin/users", ["Ticket Queue", "Users"]],
  ])("renders only the destinations %s may use, and none of the others in the markup", async (_who, user, path, expected) => {
    renderApp(path, user);

    await screen.findByRole("navigation", { name: "Main" });
    expect(navLinks()).toEqual(expected);
    // "No hidden markup": a destination the role may not use is absent, not merely invisible.
    for (const label of NAV_LABELS.filter((l) => !expected.includes(l))) {
      expect(screen.queryByRole("link", { name: label, hidden: true })).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(new RegExp(`^${label}$`));
    }
  });

  it("shows the signed-in user's name with their role badge, a Change password link and Logout", async () => {
    renderApp("/staff/tickets", STAFF);

    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByText(STAFF.name)).toBeInTheDocument();
    expect(within(nav).getByText("IT Staff")).toHaveClass("zg-badge-role");
    expect(within(nav).getByRole("link", { name: "Change password" })).toHaveAttribute("href", "/change-password");
    expect(within(nav).getByRole("button", { name: "Logout" })).toBeInTheDocument();
    // The Lab 2 selector's controls are gone.
    expect(screen.queryByRole("button", { name: /change requester/i })).not.toBeInTheDocument();
  });

  it("marks the current section, and keeps a list current on its detail route", async () => {
    renderApp("/admin/users", ADMIN);
    expect(await screen.findByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Ticket Queue" })).not.toHaveAttribute("aria-current");
  });

  it("keeps identity and Logout inside the collapsible panel that the mobile menu toggles", async () => {
    renderApp("/tickets", REQUESTER);
    const toggle = await screen.findByRole("button", { name: "Toggle navigation" });
    const panel = document.getElementById("main-nav")!;

    expect(within(panel).getByText(REQUESTER.name)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Logout" })).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(panel).toHaveClass("show");
    await userEvent.click(within(panel).getByRole("link", { name: "Change password" }));
    expect(await screen.findByRole("heading", { name: "Change Your Password" })).toBeInTheDocument();
  });

  it("opens no shell at all for a visitor with no session", async () => {
    renderApp("/tickets", null);
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });
});

describe("Logout", () => {
  function BackButton() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(-1)}>
        browser back
      </button>
    );
  }

  // UI-10 / AC-09
  it("ends the session, returns to Login, and Back does not restore the application", async () => {
    const logout = vi.spyOn(api, "logout").mockResolvedValue();
    vi.spyOn(api, "getCurrentUser").mockResolvedValue(REQUESTER);
    vi.spyOn(api, "getCategories").mockResolvedValue([]);
    vi.spyOn(api, "getRelatedSystems").mockResolvedValue([]);
    vi.spyOn(api, "getTickets").mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });

    render(
      <MemoryRouter initialEntries={["/tickets/new", "/tickets"]} initialIndex={1}>
        <App />
        <BackButton />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Logout" }));

    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();

    // The page behind Login was Create Ticket. Going back to it must bounce to Login.
    await userEvent.click(screen.getByRole("button", { name: "browser back" }));
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create Ticket" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("still signs the user out on this screen when the API cannot be reached", async () => {
    vi.spyOn(api, "getCurrentUser").mockResolvedValue(STAFF);
    // logout() swallows a network failure on purpose: the client forgets the user either way.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    try {
      render(
        <MemoryRouter initialEntries={["/staff/tickets"]}>
          <App />
        </MemoryRouter>,
      );
      await userEvent.click(await screen.findByRole("button", { name: "Logout" }));
      expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
