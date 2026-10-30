import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import type { AuthUser } from "../../src/api.js";
import { ADMIN, REQUESTER, STAFF, renderApp } from "../lab-03/support.js";

// Lab 4 ui-spec section 3 (FR-14, AC-36): Dashboard is the first item in every role's navigation and its
// landing route.

afterEach(() => {
  vi.restoreAllMocks();
});

// The role's destinations; the account area beside them also holds a Change password link.
const navLinks = () =>
  within(screen.getByRole("navigation", { name: "Main" }))
    .getAllByRole("link")
    .filter((l) => l.getAttribute("href") !== "/change-password");

describe("navigation and landing route per role", () => {
  // UI-01 / AC-36, FR-14
  it.each<[string, AuthUser, string, string[]]>([
    ["a Requester", REQUESTER, "/dashboard", ["Dashboard", "My Tickets", "Create Ticket"]],
    ["IT Staff", STAFF, "/staff/dashboard", ["Dashboard", "Ticket Queue"]],
    ["an Administrator", ADMIN, "/staff/dashboard", ["Dashboard", "Ticket Queue", "Users"]],
  ])("lands %s on its Dashboard with Dashboard first and marked as the current page", async (_who, user, landing, items) => {
    renderApp("/", user);
    await screen.findByRole("heading", { name: "Dashboard" });
    const links = navLinks();
    expect(links.map((l) => l.textContent)).toEqual(items);
    expect(links[0]).toHaveAttribute("href", landing);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    for (const other of links.slice(1)) expect(other).not.toHaveAttribute("aria-current");
  });

  // UI-01 / AC-36: the Dashboard item is marked on its own route only.
  it("moves the current-page mark off Dashboard on another screen", async () => {
    renderApp("/staff/tickets", STAFF);
    await screen.findByRole("heading", { name: "Ticket Queue" });
    const [dashboard, queue] = navLinks();
    expect(dashboard).not.toHaveAttribute("aria-current");
    expect(queue).toHaveAttribute("aria-current", "page");
  });
});
