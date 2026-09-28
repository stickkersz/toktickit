import { expect, test } from "@playwright/test";
import { ADMIN, createUserAsAdmin, E2E_PASSWORD, fillLogin, INITIAL_PASSWORD, LANDING, logout, navItems, REQUESTER, signIn, STAFF } from "./helpers.js";

// E2E-01 and E2E-02 from docs/lab-03/tests.md.
test.describe("Authentication and role navigation", () => {
  // E2E-01 (AC-01, AC-02, AC-09)
  test("signs in with an initial password, is held on Change Password, then logs out and loses access", async ({ page }) => {
    const user = await createUserAsAdmin("REQUESTER", "first-login");

    await fillLogin(page, user.email, INITIAL_PASSWORD);
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole("heading", { name: "Change Your Password" })).toBeVisible();
    await expect(page.getByText("You must change your password to continue.")).toBeVisible();

    // AC-02: nothing else opens while the initial password is still held, by URL or by API.
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/change-password$/);
    expect((await page.request.get("/api/tickets")).status()).toBe(403);

    await page.getByLabel("Current (temporary) password *", { exact: true }).fill(INITIAL_PASSWORD);
    await page.getByLabel("New password *", { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel("Confirm new password *", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(LANDING.REQUESTER);
    expect(await navItems(page)).toEqual(["My Tickets", "Create Ticket"]);
    expect((await page.request.get("/api/tickets")).status()).toBe(200);

    // AC-09: after logout neither a protected URL nor the API answers with data.
    await logout(page);
    for (const url of ["/tickets", "/tickets/new", "/staff/tickets", "/admin/users"]) {
      await page.goto(url);
      await expect(page, url).toHaveURL(/\/login$/);
    }
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    expect((await page.request.get("/api/tickets")).status()).toBe(401);

    // The new password is the one that now works.
    await fillLogin(page, user.email, E2E_PASSWORD);
    await expect(page).toHaveURL(LANDING.REQUESTER);
  });

  // E2E-02 (AC-11, AC-12)
  test("shows each role only its own navigation and the forbidden state on another role's route", async ({ page }) => {
    const roles = [
      { email: REQUESTER.email, landing: LANDING.REQUESTER, nav: ["My Tickets", "Create Ticket"], forbidden: ["/staff/tickets", "/admin/users"] },
      { email: STAFF.email, landing: LANDING.IT_STAFF, nav: ["Ticket Queue"], forbidden: ["/tickets", "/tickets/new", "/admin/users"] },
      { email: ADMIN.email, landing: LANDING.ADMINISTRATOR, nav: ["Ticket Queue", "Users"], forbidden: ["/tickets", "/tickets/new"] },
    ];

    for (const role of roles) {
      await signIn(page, role.email, role.landing);
      expect(await navItems(page), role.email).toEqual(role.nav);
      await expect(page.locator('#main-nav a[aria-current="page"]'), role.email).toHaveCount(1);

      for (const url of role.forbidden) {
        // BR-63: the forbidden screen requests none of the screen's data.
        const dataRequests: string[] = [];
        const listen = (req: { url(): string }) => {
          if (/\/api\/(tickets|staff|admin)/.test(req.url())) dataRequests.push(req.url());
        };
        page.on("request", listen);
        await page.goto(url);
        await expect(page.getByRole("heading", { name: "Access denied" }), `${role.email} at ${url}`).toBeVisible();
        await expect(page.getByRole("link", { name: "Go to your home screen" })).toBeVisible();
        page.off("request", listen);
        expect(dataRequests, `${role.email} at ${url}`).toEqual([]);
      }

      await page.getByRole("link", { name: "Go to your home screen" }).click();
      await expect(page).toHaveURL(role.landing);
      await logout(page);
    }
  });
});
