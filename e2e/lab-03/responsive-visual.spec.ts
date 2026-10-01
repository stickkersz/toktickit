import { expect, Page, test } from "@playwright/test";
import {
  ADMIN,
  asAdmin,
  createTicketAsRequester,
  createUserAsAdmin,
  fillLogin,
  hasNoHorizontalScroll,
  INACTIVE_REQUESTER,
  INITIAL_PASSWORD,
  LANDING,
  logout,
  REQUESTER,
  SEED_INITIAL_PASSWORD,
  shot,
  short,
  signIn,
  STAFF,
  VIEWPORTS,
} from "./helpers.js";

// RESP-01 (AC-35) and RESP-02 (ui-spec sections 13 and 14) from docs/lab-03/tests.md.

type Viewport = keyof typeof VIEWPORTS;

// Captures one state at one viewport, and checks it fits that viewport.
// User Management lists every account unpaged, so on a long-lived dev database a full-page
// capture runs to thousands of pixels; those shots keep to the viewport instead.
async function capture(page: Page, group: string, state: string, viewport: Viewport = "desktop") {
  await page.setViewportSize(VIEWPORTS[viewport]);
  await expect.poll(() => hasNoHorizontalScroll(page), `${group}/${state} at ${viewport}`).toBe(true);
  await page.screenshot({ path: shot(group, `${state}-${viewport}`), fullPage: group !== "user-management" });
}

test.describe("Lab 3 screenshots (RESP-02)", () => {
  test("authentication", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
    await capture(page, "authentication", "login-initial", "desktop");
    await capture(page, "authentication", "login-initial", "tablet");
    await capture(page, "authentication", "login-initial", "mobile");

    await page.setViewportSize(VIEWPORTS.desktop);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText("Email address is required.")).toBeVisible();
    await capture(page, "authentication", "login-validation-error");

    await fillLogin(page, REQUESTER.email, "Wrong!Passw0rd");
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password. Please try again.");
    await capture(page, "authentication", "login-invalid-credentials");

    await fillLogin(page, INACTIVE_REQUESTER.email, SEED_INITIAL_PASSWORD);
    await expect(page.getByRole("alert")).toHaveText("This account is inactive. Contact an administrator.");
    await capture(page, "authentication", "login-inactive-account");

    const user = await createUserAsAdmin("REQUESTER", "screenshot");
    await fillLogin(page, user.email, INITIAL_PASSWORD);
    await expect(page.getByRole("heading", { name: "Change Your Password" })).toBeVisible();
    await capture(page, "authentication", "change-password-initial");
    await capture(page, "authentication", "change-password-initial", "tablet");
    await capture(page, "authentication", "change-password-initial", "mobile");
    await page.setViewportSize(VIEWPORTS.desktop);

    await page.getByLabel("Current (temporary) password *", { exact: true }).fill(INITIAL_PASSWORD);
    await page.getByLabel("New password *", { exact: true }).fill("short");
    await page.getByLabel("Confirm new password *", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("New password *", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await capture(page, "authentication", "change-password-rules-unmet");
  });

  test("requester ticket detail", async ({ page }) => {
    const ticket = await createTicketAsRequester(`E2E requester view ${short()}`);
    await asAdmin((api) => api.post(`/api/tickets/${ticket.id}/comments`, { data: { body: "Thanks, we are looking at this now." } }));
    await signIn(page, REQUESTER.email, LANDING.REQUESTER);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByText("Thanks, we are looking at this now.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Problem appears resolved" })).toBeVisible();
    await capture(page, "requester-ticket-detail", "with-public-comment");
    await capture(page, "requester-ticket-detail", "with-public-comment", "tablet");
    await capture(page, "requester-ticket-detail", "with-public-comment", "mobile");
  });

  test("staff queue", async ({ page }) => {
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await expect(page.getByRole("table")).toBeVisible();
    await capture(page, "staff-queue", "loaded");
    await capture(page, "staff-queue", "loaded", "tablet");
    await capture(page, "staff-queue", "loaded", "mobile");
    await expect(page.getByLabel("Tickets", { exact: true })).toBeVisible();

    await page.setViewportSize(VIEWPORTS.desktop);
    await page.getByLabel("Status").selectOption("NEW");
    await page.getByLabel("Owner").selectOption("unassigned");
    await expect(page).toHaveURL(/status=NEW/);
    await expect(page.getByRole("table")).toBeVisible();
    await capture(page, "staff-queue", "filtered");

    await page.goto(`/staff/tickets?search=no-such-ticket-${short()}`);
    await expect(page.getByText("No tickets match these filters.")).toBeVisible();
    await capture(page, "staff-queue", "no-results");

    await page.route(/\/api\/staff\/tickets(\?|$)/, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "INTERNAL_ERROR", message: "Unable to load the ticket queue." }) }),
    );
    await page.goto("/staff/tickets");
    await expect(page.getByRole("alert")).toContainText("Unable to load the ticket queue.");
    await capture(page, "staff-queue", "failure");
  });

  test("staff ticket detail", async ({ page }) => {
    const ticket = await createTicketAsRequester(`E2E screenshot detail ${short()}`);
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await page.goto(`/staff/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: ticket.ticketNumber })).toBeVisible();
    await capture(page, "staff-ticket-detail", "loaded");
    await capture(page, "staff-ticket-detail", "loaded", "tablet");
    await capture(page, "staff-ticket-detail", "loaded", "mobile");

    await page.setViewportSize(VIEWPORTS.desktop);
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByLabel("Ticket Owner").locator("option:checked")).toHaveText(`${STAFF.name} (you)`);
    await capture(page, "staff-ticket-detail", "claimed");

    await page.getByRole("tab", { name: /^Internal Notes/ }).click();
    await page.getByLabel("Add Internal Note").fill("Checked the gateway logs: the VPN profile expired yesterday.");
    await page.getByRole("button", { name: "Add Note" }).click();
    await expect(page.getByRole("tab", { name: "Internal Notes (1)" })).toBeVisible();
    await capture(page, "staff-ticket-detail", "internal-notes");

    // A move the server refuses, e.g. because someone else changed the status a moment earlier.
    await page.route(`**/api/staff/tickets/${ticket.id}/status`, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "INVALID_TRANSITION", message: "That move is not permitted.", currentStatus: "NEW", permitted: ["OPEN", "CANCELLED"] }),
      }),
    );
    await page.getByLabel("Current Status").selectOption("OPEN");
    await expect(page.getByText("That move is not allowed from here. This Ticket can move to: Open, Cancelled.")).toBeVisible();
    await capture(page, "staff-ticket-detail", "invalid-transition");
    await page.unroute(`**/api/staff/tickets/${ticket.id}/status`);

    await page.reload();
    const status = page.getByLabel("Current Status");
    for (const next of ["OPEN", "IN_PROGRESS"]) {
      await status.selectOption(next);
      await expect(status).toHaveValue(next);
    }
    await status.selectOption("RESOLVED");
    const resolution = "Reissued the VPN profile and confirmed the connection with the user.";
    await page.getByLabel("Resolution Summary *").fill(resolution);
    await page.getByRole("button", { name: "Confirm and resolve" }).click();
    // The select shows Resolved while the save is still in flight, so wait for what only the saved Ticket shows.
    await expect(page.getByLabel("Resolution Summary", { exact: true })).toHaveValue(resolution);
    await expect(page.getByText("Saving…")).toHaveCount(0);
    await expect(status).toHaveValue("RESOLVED");
    await capture(page, "staff-ticket-detail", "resolved");
  });

  test("user management", async ({ page }) => {
    await signIn(page, ADMIN.email, LANDING.ADMINISTRATOR);
    await expect(page.getByRole("table")).toBeVisible();
    await capture(page, "user-management", "list");
    await capture(page, "user-management", "list", "tablet");
    await capture(page, "user-management", "list", "mobile");

    await page.setViewportSize(VIEWPORTS.desktop);
    await page.getByRole("button", { name: "Create User" }).click();
    await expect(page.getByRole("heading", { name: "Create User" })).toBeVisible();
    await capture(page, "user-management", "create-panel");

    await page.getByLabel("Full Name *").fill("Duplicate Example");
    await page.getByLabel("Email Address *").fill(REQUESTER.email);
    await page.getByLabel("Initial Password *", { exact: true }).fill(INITIAL_PASSWORD);
    await page.getByRole("button", { name: "Create User" }).last().click();
    await expect(page.getByText("That email address is already in use.")).toBeVisible();
    await capture(page, "user-management", "duplicate-email");
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByLabel("Search users").fill(ADMIN.email);
    await page.getByRole("button", { name: `Edit ${ADMIN.name}` }).click();
    await page.getByLabel("Role *").selectOption("IT_STAFF");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("At least one active Administrator is required.");
    await capture(page, "user-management", "last-administrator");
    await logout(page);

    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await capture(page, "user-management", "forbidden");
  });
});

// RESP-01 (AC-35): every Lab 3 screen at 375, 768 and 1280 with no horizontal page scroll,
// every control still reachable, the queue a table at desktop widths and cards on a phone.
test.describe("Lab 3 responsive layout (RESP-01)", () => {
  test("every Lab 3 screen fits 375, 768 and 1280, and the queue changes form at the documented widths", async ({ page }) => {
    const ticket = await createTicketAsRequester(`E2E responsive ${short()}`);
    const fresh = await createUserAsAdmin("REQUESTER", "responsive");

    async function fits(label: string) {
      for (const viewport of ["mobile", "tablet", "desktop"] as const) {
        await page.setViewportSize(VIEWPORTS[viewport]);
        await expect.poll(() => hasNoHorizontalScroll(page), `${label} at ${viewport}`).toBe(true);
        if (viewport === "mobile" && (await page.locator("#main-nav").count()) > 0) {
          await expect(page.getByRole("button", { name: "Toggle navigation" }), label).toBeVisible();
        }
      }
    }

    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await fits("Login");

    await fillLogin(page, fresh.email, INITIAL_PASSWORD);
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await fits("Change Password");
    await page.context().clearCookies();

    await signIn(page, REQUESTER.email, LANDING.REQUESTER);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: /^Public Comments/ })).toBeVisible();
    await fits("Requester Ticket Detail with Public Comments");
    await page.goto("/staff/tickets");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
    await fits("Forbidden");
    await page.context().clearCookies();

    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await fits("Ticket Queue");
    for (const [viewport, width] of [["desktop", 1280], ["992", 992]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("table"), `queue at ${viewport}`).toBeVisible();
    }
    await page.setViewportSize(VIEWPORTS.mobile);
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByLabel("Tickets", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Tickets", { exact: true }).getByRole("button").first()).toBeVisible();

    await page.goto(`/staff/tickets/${ticket.id}`);
    await expect(page.getByLabel("Current Status")).toBeVisible();
    await fits("Staff Ticket Detail");
    await page.setViewportSize(VIEWPORTS.mobile);
    for (const control of ["Ticket Owner", "IT Priority", "Current Status"]) {
      await page.getByLabel(control).scrollIntoViewIfNeeded();
      await expect(page.getByLabel(control), control).toBeInViewport();
    }
    await page.context().clearCookies();

    await signIn(page, ADMIN.email, LANDING.ADMINISTRATOR);
    await fits("User Management list");
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.getByRole("button", { name: "Create User" }).click();
    await expect(page.getByLabel("Full Name *")).toBeVisible();
    await fits("User Management panel");
  });
});

// A11Y-04 (AC-35): the shared focus ring is the Zen Green accent at 35%, which cannot be seen
// on the green header, so every header control needs its own ring that contrasts with it.
test.describe("Keyboard focus in the green header (A11Y-04)", () => {
  test("every header control shows a white focus ring when reached by keyboard", async ({ page }) => {
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    const header = page.getByRole("navigation", { name: "Main" });
    for (const control of [
      header.getByRole("link", { name: "Ticket Queue" }),
      header.getByRole("link", { name: "Change password" }),
      header.getByRole("button", { name: "Logout" }),
    ]) {
      await page.keyboard.press("Shift");
      await control.focus();
      const ring = await control.evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.outlineStyle, color: s.outlineColor, width: parseFloat(s.outlineWidth) };
      });
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);
      expect(ring.color).toBe("rgb(255, 255, 255)");
    }
  });

  test("queue rows and sortable headers show the Zen Green ring, never the browser's blue", async ({ page }) => {
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    const table = page.getByRole("table");
    for (const control of [table.getByRole("columnheader", { name: /Ticket No\./ }), table.getByRole("button").first()]) {
      await page.keyboard.press("Shift");
      await control.focus();
      const ring = await control.evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.outlineStyle, color: s.outlineColor, width: parseFloat(s.outlineWidth) };
      });
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);
      expect(ring.color).toBe("rgb(11, 122, 70)");
    }
  });
});
