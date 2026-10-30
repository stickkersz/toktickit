import { expect, Page, test } from "@playwright/test";
import {
  ADMIN,
  apiSignedIn,
  createTicketAsRequester,
  createUserAsAdmin,
  hasNoHorizontalScroll,
  LANDING,
  logout,
  OTHER_STAFF,
  REQUESTER,
  short,
  signIn,
  STAFF,
  VIEWPORTS,
} from "../lab-03/helpers.js";

// E2E-01, E2E-08 and the Actions Taken screenshots (RESP-02, A11Y-01 Actions part) from docs/lab-04/tests.md.
// Each test files its own Ticket, so the captures show nothing but that Ticket.

const shot = (name: string) => `artifacts/lab-04/screenshots/actions-taken/${name}.png`;
const SIZES = [
  ["desktop", VIEWPORTS.desktop],
  ["tablet", VIEWPORTS.tablet],
  ["mobile", VIEWPORTS.mobile],
] as const;

async function openActions(page: Page, ticketId: number) {
  await page.goto(`/staff/tickets/${ticketId}?tab=actions`);
  await expect(page.getByRole("tab", { name: /^Actions Taken \(\d+\)$/ })).toHaveAttribute("aria-selected", "true");
}

async function addAction(page: Page, description: string, responsible?: string) {
  await page.getByRole("button", { name: "Add Action" }).click();
  await page.getByLabel(/Action Description/).fill(description);
  if (responsible) await page.getByLabel(/Responsible Staff/).selectOption({ label: responsible });
  await page.getByRole("button", { name: "Save Action" }).click();
  await expect(page.getByText("Action added.")).toBeVisible();
}

// The row (desktop table) or card (phone) of an Action, by its description.
const actionRow = (page: Page, description: string) => page.getByRole("button").filter({ hasText: description }).first();

test.describe("Actions Taken", () => {
  // E2E-01 (AC-01, AC-14) and the Requester's read-only view (AC-15); RESP-02 and A11Y-01 for the Actions
  // Taken screens: no horizontal scroll and captures at 375, 768 and 1280, focus moved into the form and the
  // dialog, the dialog's primary button reached and shown with keyboard focus.
  test("IT Staff record two Actions for different people, edit and reassign one, complete one, cancel the other; the Requester sees all, read-only", async ({ page }) => {
    const ticket = await createTicketAsRequester(`E2E Actions flow ${short()}`);
    await page.setViewportSize(VIEWPORTS.desktop);
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await openActions(page, ticket.id);
    await expect(page.getByText("No actions recorded yet.")).toBeVisible();

    // Create, with the form and its validation captured on the way.
    await page.getByRole("button", { name: "Add Action" }).click();
    await expect(page.getByLabel(/Action Date\/Time/)).toBeFocused();
    await page.getByLabel("Follow-Up Required").check();
    await page.getByRole("button", { name: "Save Action" }).click();
    await expect(page.getByText("Description must be between 5 and 2000 characters.")).toBeVisible();
    await expect(page.getByText("Follow-up note must be between 5 and 1000 characters.")).toBeVisible();
    await page.screenshot({ animations: "disabled", path: shot("validation-desktop"), fullPage: true });
    await page.getByLabel(/Action Description/).fill("Replace the LAN cable at desk 4B and retest the link.");
    await page.getByLabel(/Follow-Up Note/).fill("Check the switch port if the link drops again.");
    await page.getByLabel(/Attachment Notes/).fill("Photo of the port in Attachments.");
    // Leave the last field so every touched field shows its settled, valid state.
    await page.getByLabel(/Action Description/).focus();
    await page.getByLabel(/Attachment Notes/).focus();
    await page.getByLabel(/Action Date\/Time/).focus();
    for (const [size, viewport] of SIZES) {
      await page.setViewportSize(viewport);
      expect(await hasNoHorizontalScroll(page), `create ${size}`).toBe(true);
      await page.screenshot({ animations: "disabled", path: shot(`create-${size}`), fullPage: true });
    }
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.getByRole("button", { name: "Save Action" }).click();
    await expect(page.getByText("Action added.")).toBeVisible();

    await addAction(page, "Clear the browser cache on the laptop.", OTHER_STAFF.name);
    await expect(page.getByRole("tab", { name: "Actions Taken (2)" })).toBeVisible();
    const table = page.getByRole("table");
    await expect(table.getByRole("cell", { name: OTHER_STAFF.name, exact: true })).toBeVisible();
    for (const [size, viewport] of SIZES) {
      await page.setViewportSize(viewport);
      expect(await hasNoHorizontalScroll(page), `list ${size}`).toBe(true);
      await page.screenshot({ animations: "disabled", path: shot(`list-${size}`), fullPage: true });
    }
    await page.setViewportSize(VIEWPORTS.desktop);
    // The table replaces the cards once the window is wide again.
    await expect(page.getByRole("table")).toBeVisible();

    // Edit and reassign the first.
    await actionRow(page, "Replace the LAN cable").click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel(/Action Description/).fill("Replace the LAN cable and the wall port at desk 4B.");
    await page.getByLabel(/Responsible Staff/).selectOption({ label: OTHER_STAFF.name });
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeEnabled();
    await page.screenshot({ animations: "disabled", path: shot("edit-desktop"), fullPage: true });
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();

    // Complete it through the dialog, keyboard focus visible inside. Its detail is still open after the save.
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/Result/)).toBeFocused();
    await dialog.getByLabel(/Result/).fill("Cable and port replaced; link stable at 1 Gbps for 30 minutes.");
    // Keyboard focus on the primary button, reached with Tab alone (the date field has a stop per part).
    const markDone = dialog.getByRole("button", { name: "Mark as Completed" });
    for (let i = 0; i < 12 && !(await markDone.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(markDone).toBeFocused();
    await page.screenshot({ animations: "disabled", path: shot("focus-dialog-desktop") });
    await dialog.getByLabel(/Result/).focus();
    for (const [size, viewport] of SIZES) {
      await page.setViewportSize(viewport);
      await page.screenshot({ animations: "disabled", path: shot(`complete-dialog-${size}`) });
    }
    await page.setViewportSize(VIEWPORTS.desktop);
    await dialog.getByRole("button", { name: "Mark as Completed" }).click();
    await expect(page.getByText("Action completed.")).toBeVisible();

    // Cancel the second.
    await actionRow(page, "Clear the browser cache").click();
    await page.getByRole("button", { name: "Cancel Action" }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Not needed: the error comes from the server.");
    await page.screenshot({ animations: "disabled", path: shot("cancel-dialog-desktop") });
    await page.getByRole("dialog").getByRole("button", { name: "Cancel Action" }).click();
    await expect(page.getByText("Action cancelled.")).toBeVisible();
    // The badge in each row (the open detail repeats the status).
    await expect(actionRow(page, "wall port").getByText("Completed", { exact: true })).toBeVisible();
    await expect(actionRow(page, "Clear the browser cache").getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: OTHER_STAFF.name, exact: true })).toHaveCount(2);
    await logout(page);

    // The Requester sees both, read-only, the cancelled one with its reason.
    await signIn(page, REQUESTER.email, LANDING.REQUESTER);
    await page.goto(`/tickets/${ticket.id}`);
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Actions Taken (2)" }) });
    await expect(section).toBeVisible();
    await section.getByRole("button").filter({ hasText: "Clear the browser cache" }).first().click();
    await expect(section.getByText("Not needed: the error comes from the server.")).toBeVisible();
    await expect(section.getByRole("button", { name: /add action|^edit$|^complete$|cancel action/i })).toHaveCount(0);
    for (const [size, viewport] of SIZES) {
      await page.setViewportSize(viewport);
      expect(await hasNoHorizontalScroll(page), `requester ${size}`).toBe(true);
      await page.screenshot({ animations: "disabled", path: shot(`requester-view-${size}`), fullPage: true });
    }
  });

  // E2E-08 (AC-04, BR-07)
  test("refuses an IT Staff member an Administrator deactivated while another user had them chosen in the open form", async ({ page }) => {
    const ticket = await createTicketAsRequester(`E2E inactive responsible ${short()}`);
    const leaving = await createUserAsAdmin("IT_STAFF", "leaving-staff");
    await page.setViewportSize(VIEWPORTS.desktop);
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await openActions(page, ticket.id);
    await page.getByRole("button", { name: "Add Action" }).click();
    await page.getByLabel(/Action Description/).fill("Run the battery health report on the laptop.");
    await page.getByLabel(/Responsible Staff/).selectOption({ label: leaving.name });

    // While the form is open, the Administrator deactivates them.
    const admin = await apiSignedIn(ADMIN.email);
    const res = await admin.patch(`/api/admin/users/${leaving.id}`, { data: { isActive: false } });
    expect(res.status()).toBe(200);
    await admin.dispose();

    await page.getByRole("button", { name: "Save Action" }).click();
    await expect(page.getByText("Choose an active IT Staff member.")).toBeVisible();
    // Nothing was recorded and the typed text is still there.
    await expect(page.getByLabel(/Action Description/)).toHaveValue("Run the battery health report on the laptop.");
    await expect(page.getByRole("tab", { name: "Actions Taken (0)" })).toBeVisible();
    await page.screenshot({ animations: "disabled", path: shot("inactive-responsible-desktop"), fullPage: true });
  });

  // The STALE_ACTION callout (UI-14), captured against the real server.
  test("shows the stale-edit callout with the other person's values when someone saved first", async ({ page }) => {
    const ticket = await createTicketAsRequester(`E2E stale action ${short()}`);
    const staffApi = await apiSignedIn(STAFF.email);
    const created = await staffApi.post(`/api/tickets/${ticket.id}/actions`, {
      data: { actionAt: new Date().toISOString(), description: "Check the VPN client version." },
    });
    expect(created.status()).toBe(201);
    const actionId = (await created.json()).id as number;

    await page.setViewportSize(VIEWPORTS.desktop);
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await openActions(page, ticket.id);
    await actionRow(page, "Check the VPN client version").click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel(/Action Description/).fill("Check the VPN client version and update it.");

    // Someone else saves first.
    const other = await apiSignedIn(OTHER_STAFF.email);
    expect((await other.patch(`/api/actions/${actionId}`, { data: { version: 1, description: "Reinstall the VPN client." } })).status()).toBe(200);
    await other.dispose();
    await staffApi.dispose();

    await page.getByRole("button", { name: "Save Changes" }).click();
    const callout = page.getByRole("alert");
    await expect(callout).toContainText("Someone else changed this action.");
    await expect(callout.getByText("Reinstall the VPN client.")).toBeVisible();
    await expect(page.getByLabel(/Action Description/)).toHaveValue("Check the VPN client version and update it.");
    await page.screenshot({ animations: "disabled", path: shot("stale-conflict-desktop"), fullPage: true });
  });
});
