import { expect, Page, test } from "@playwright/test";
import {
  ADMIN,
  asAdmin,
  createTicketAsRequester,
  createUserAsAdmin,
  E2E_PASSWORD,
  fillLogin,
  INITIAL_PASSWORD,
  LANDING,
  logout,
  OTHER_STAFF,
  short,
  signIn,
} from "./helpers.js";

// E2E-05 and E2E-06 from docs/lab-03/tests.md.

async function openUser(page: Page, search: string, name: string) {
  await page.getByLabel("Search users").fill(search);
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  await expect(page.getByRole("heading", { name: "Edit User" })).toBeVisible();
}

test.describe("User administration", () => {
  // E2E-05 (AC-29 to AC-32)
  test("creates, refuses a duplicate, edits and resets a user who must then change it, and refuses the two unsafe changes", async ({ page }) => {
    const id = short();
    const name = `E2E Admin Flow ${id}`;
    const email = `e2e-admin-flow-${id}@toktickit.test`;

    await signIn(page, ADMIN.email, LANDING.ADMINISTRATOR);
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();

    // The last-Administrator case needs this to be the only active Administrator.
    const admins = (await (await page.request.get("/api/admin/users?role=ADMINISTRATOR")).json()) as { isActive: boolean }[];
    expect(admins.filter((a) => a.isActive), "this spec needs exactly one active Administrator").toHaveLength(1);

    // Create (AC-29).
    await page.getByRole("button", { name: "Create User" }).click();
    await page.getByLabel("Full Name *").fill(name);
    await page.getByLabel("Email Address *").fill(email);
    await page.getByLabel("Role *").selectOption("REQUESTER");
    await page.getByLabel("Initial Password *", { exact: true }).fill(INITIAL_PASSWORD);
    await page.getByRole("button", { name: "Create User" }).last().click();
    await expect(page.getByText(`Created ${name}.`)).toBeVisible();

    // A duplicate email, in another case, is refused on the field (AC-30).
    await page.getByRole("button", { name: "Create User" }).click();
    await page.getByLabel("Full Name *").fill(`${name} Twin`);
    await page.getByLabel("Email Address *").fill(email.toUpperCase());
    await page.getByLabel("Initial Password *", { exact: true }).fill(INITIAL_PASSWORD);
    await page.getByRole("button", { name: "Create User" }).last().click();
    await expect(page.getByText("That email address is already in use.")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // Edit, then issue a new initial password (AC-31).
    await openUser(page, email, name);
    await page.getByLabel("Full Name *").fill(`${name} Edited`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    const resetPassword = `Reset!${id}9A`;
    await page.getByRole("button", { name: "Set new initial password" }).click();
    await page.getByLabel("New initial password *", { exact: true }).fill(resetPassword);
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText(`Initial password set. ${name} Edited must change it at their next sign in.`)).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

    // Self-deactivation is not offered, and the reason is written out (AC-32).
    await openUser(page, ADMIN.email, ADMIN.name);
    await expect(page.getByRole("switch", { name: "Active" })).toBeDisabled();
    await expect(page.getByText("You cannot deactivate your own account.")).toBeVisible();
    await expect(page.getByText("Use Change password in the header to change your own password.")).toBeVisible();

    // Removing the last active Administrator by a role change is refused clearly, and nothing changes (AC-32).
    await page.getByLabel("Role *").selectOption("IT_STAFF");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("At least one active Administrator is required.");
    await expect(page.getByLabel("Role *")).toHaveValue("ADMINISTRATOR");

    // The server refuses both directly too, not just the screen.
    const me = (await (await page.request.get("/api/auth/me")).json()) as { id: number };
    for (const data of [{ isActive: false }, { role: "IT_STAFF" }]) {
      const res = await page.request.patch(`/api/admin/users/${me.id}`, { data });
      expect(res.status(), JSON.stringify(data)).toBe(409);
    }
    const still = (await (await page.request.get(`/api/admin/users?search=${encodeURIComponent(ADMIN.email)}`)).json()) as { role: string; isActive: boolean }[];
    expect(still).toEqual([expect.objectContaining({ role: "ADMINISTRATOR", isActive: true })]);
    await logout(page);

    // The new user signs in with the reset password and is forced to change it.
    await fillLogin(page, email, resetPassword);
    await expect(page).toHaveURL(/\/change-password$/);
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/change-password$/);
    await page.getByLabel("Current (temporary) password *", { exact: true }).fill(resetPassword);
    await page.getByLabel("New password *", { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel("Confirm new password *", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(LANDING.REQUESTER);
  });

  // E2E-06 (AC-40, AC-41)
  test("a deactivated owner's Ticket shows as needing an owner until another IT Staff user claims and moves it", async ({ page }) => {
    const former = await createUserAsAdmin("IT_STAFF", "former-owner");
    const ticket = await createTicketAsRequester(`E2E orphaned ${short()}`);
    await asAdmin((api) => api.patch(`/api/staff/tickets/${ticket.id}/owner`, { data: { ownerId: former.id } }));
    await asAdmin((api) => api.patch(`/api/staff/tickets/${ticket.id}/status`, { data: { currentStatus: "OPEN" } }));

    // The Administrator deactivates the owner through User Management.
    await signIn(page, ADMIN.email, LANDING.ADMINISTRATOR);
    await openUser(page, former.email, former.name);
    await page.getByRole("switch", { name: "Active" }).uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await logout(page);

    // Another IT Staff user finds it under "Needs an owner", with the marker and badge.
    await signIn(page, OTHER_STAFF.email, LANDING.IT_STAFF);
    await page.getByLabel("Owner").selectOption("needs-owner");
    await page.getByLabel("Search tickets").fill(ticket.ticketNumber);
    const row = page.getByRole("table").getByRole("button", { name: new RegExp(ticket.ticketNumber) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(former.name);
    await expect(row).toContainText("Needs new owner");
    await row.click();

    await expect(page.getByText("Owner is inactive")).toBeVisible();
    await expect(page.getByText("Needs new owner")).toBeVisible();
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByLabel("Ticket Owner").locator("option:checked")).toHaveText(`${OTHER_STAFF.name} (you)`);
    await expect(page.getByText("Needs new owner")).toHaveCount(0);
    await page.getByLabel("Current Status").selectOption("IN_PROGRESS");
    await expect(page.getByLabel("Current Status")).toHaveValue("IN_PROGRESS");

    // Once claimed it has left the "Needs an owner" view.
    await page.goto(`/staff/tickets?owner=needs-owner&search=${ticket.ticketNumber}`);
    await expect(page.getByText("No tickets match these filters.")).toBeVisible();
    await logout(page);

    // The deactivated user is told their account is inactive.
    await fillLogin(page, former.email, INITIAL_PASSWORD);
    await expect(page.getByRole("alert")).toHaveText("This account is inactive. Contact an administrator.");
    await expect(page).toHaveURL(/\/login$/);
  });
});
