import type { Page } from "@playwright/test";
import { expect, test, watchConsole } from "./console.js";
import {
  createTicketAsRequester,
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

// E2E-02, E2E-03, E2E-04 and the resolve-blocked and resolved-history screenshots (docs/lab-04/tests.md).

const shot = (name: string) => `artifacts/lab-04/screenshots/actions-taken/${name}.png`;
const SIZES = [
  ["desktop", VIEWPORTS.desktop],
  ["tablet", VIEWPORTS.tablet],
  ["mobile", VIEWPORTS.mobile],
] as const;
const RESOLUTION = "Replaced the LAN cable at desk 4B; the link stayed stable for 30 minutes.";

async function openTicket(page: Page, id: number) {
  await page.goto(`/staff/tickets/${id}?tab=actions`);
  await expect(page.getByRole("tab", { name: /^Actions Taken \(\d+\)$/ })).toHaveAttribute("aria-selected", "true");
}

async function claimAndStart(page: Page) {
  const status = page.getByLabel("Current Status");
  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
  for (const next of ["OPEN", "IN_PROGRESS"]) {
    await status.selectOption(next);
    await expect(page.getByText("Status updated.")).toBeVisible();
    await expect(status).toHaveValue(next);
  }
}

async function addAction(page: Page, description: string) {
  await page.getByRole("button", { name: "Add Action" }).click();
  await page.getByLabel(/Action Description/).fill(description);
  await page.getByRole("button", { name: "Save Action" }).click();
  await expect(page.getByText("Action added.")).toBeVisible();
}

async function completeOpenAction(page: Page, description: string) {
  const row = page.getByRole("button").filter({ hasText: description }).first();
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page.getByRole("dialog").getByLabel(/Result/).fill("Cable replaced and the link retested.");
  await page.getByRole("dialog").getByRole("button", { name: "Mark as Completed" }).click();
  await expect(page.getByText("Action completed.")).toBeVisible();
}

async function resolve(page: Page) {
  await page.getByLabel("Current Status").selectOption("RESOLVED");
  await page.getByLabel("Resolution Summary *").fill(RESOLUTION);
  await page.getByRole("button", { name: "Confirm and resolve" }).click();
  await expect(page.getByText("Status updated.")).toBeVisible();
  await expect(page.getByLabel("Current Status")).toHaveValue("RESOLVED");
}

test.describe("Ticket resolution", () => {
  // E2E-03 (AC-19, AC-20), with the blocked Resolve captured
  test("refuses to resolve while an Action is Planned, then resolves once it is Completed", async ({ page }) => {
    const ticket = await createTicketAsRequester(`E2E resolve gate ${short()}`);
    await page.setViewportSize(VIEWPORTS.desktop);
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await openTicket(page, ticket.id);
    await claimAndStart(page);

    // No Action at all.
    await page.getByLabel("Current Status").selectOption("RESOLVED");
    await expect(page.getByText("Record and complete at least one action before resolving.")).toBeVisible();

    // No reload anywhere below: the gate follows the Action writes on the same screen (review on #85).
    await addAction(page, "Replace the LAN cable at desk 4B.");
    await page.getByLabel("Current Status").selectOption("RESOLVED");
    const blocked = page.getByText("This ticket cannot be resolved yet: 1 planned action is still open.");
    await expect(blocked).toBeVisible();
    await expect(page.getByLabel("Resolution Summary *")).toHaveCount(0);
    await expect(page.getByLabel("Current Status")).toHaveValue("IN_PROGRESS");
    for (const [size, viewport] of SIZES) {
      await page.setViewportSize(viewport);
      await blocked.scrollIntoViewIfNeeded();
      expect(await hasNoHorizontalScroll(page), `resolve-blocked ${size}`).toBe(true);
      await page.screenshot({ animations: "disabled", path: shot(`resolve-blocked-${size}`) });
    }
    await page.setViewportSize(VIEWPORTS.desktop);

    // The link opens Actions Taken, where the Action is completed.
    await page.getByRole("link", { name: "Go to Actions Taken" }).click();
    await expect(page.getByRole("tab", { name: /^Actions Taken/ })).toBeFocused();
    await completeOpenAction(page, "Replace the LAN cable at desk 4B.");
    // The gate opened on this screen: the blocked sentence is gone without a reload (review on #85).
    await expect(page.getByText(/cannot be resolved yet/)).toHaveCount(0);
    await resolve(page);
  });

  // E2E-02 (AC-03), with the history captured for both roles
  test("records the work, resolves, and shows the Requester both the Action and the Resolved status with its history", async ({ page }) => {
    const ticket = await createTicketAsRequester(`E2E resolve flow ${short()}`);
    await page.setViewportSize(VIEWPORTS.desktop);
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await openTicket(page, ticket.id);
    await claimAndStart(page);
    await addAction(page, "Replace the LAN cable at desk 4B.");
    await completeOpenAction(page, "Replace the LAN cable at desk 4B.");
    await resolve(page);

    // The staff History lists every move, the last with its Resolution Summary.
    await page.getByRole("tab", { name: "History" }).click();
    const history = page.getByRole("tabpanel");
    await expect(history.getByText("Created as New")).toBeVisible();
    await expect(history.getByText(`Resolution Summary: ${RESOLUTION}`)).toBeVisible();
    await expect(history.getByRole("listitem")).toHaveCount(4);
    for (const [size, viewport] of SIZES) {
      await page.setViewportSize(viewport);
      await history.scrollIntoViewIfNeeded();
      expect(await hasNoHorizontalScroll(page), `resolved-history ${size}`).toBe(true);
      await page.screenshot({ animations: "disabled", path: shot(`resolved-history-${size}`), fullPage: true });
    }
    await page.setViewportSize(VIEWPORTS.desktop);
    await logout(page);

    // The Requester: the Completed Action with STAFF as Performed By, Resolved, and the same history.
    await signIn(page, REQUESTER.email, LANDING.REQUESTER);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByLabel("Resolution Summary")).toHaveValue(RESOLUTION);
    const actions = page.locator("section", { has: page.getByRole("heading", { name: "Actions Taken (1)" }) });
    await actions.getByRole("button").filter({ hasText: "Replace the LAN cable" }).first().click();
    await expect(actions.getByText(new RegExp(`^${STAFF.name}, `))).toHaveCount(2); // Recorded By and Performed By
    await expect(actions.getByText("Completed", { exact: true }).first()).toBeVisible();
    const requesterHistory = page.locator("section", { has: page.getByRole("heading", { name: "History" }) });
    await expect(requesterHistory.getByRole("listitem")).toHaveCount(4);
    await expect(requesterHistory.getByRole("button")).toHaveCount(0);
  });

  // E2E-04 (AC-22, BR-23)
  test("refuses a move made from a status another staff member has already changed, and shows the current one", async ({ browser, consoleMessages }) => {
    const ticket = await createTicketAsRequester(`E2E stale move ${short()}`);
    const first = await browser.newPage();
    const second = await browser.newPage();
    // Two pages of their own, outside the test's context, so they are watched here (E2E-09).
    watchConsole(first.context(), consoleMessages);
    watchConsole(second.context(), consoleMessages);
    await signIn(first, STAFF.email, LANDING.IT_STAFF);
    await signIn(second, OTHER_STAFF.email, LANDING.IT_STAFF);
    await first.goto(`/staff/tickets/${ticket.id}`);
    await second.goto(`/staff/tickets/${ticket.id}`);
    await expect(first.getByLabel("Current Status")).toHaveValue("NEW");
    await expect(second.getByLabel("Current Status")).toHaveValue("NEW");

    // The first moves it to Open.
    await first.getByLabel("Current Status").selectOption("OPEN");
    await expect(first.getByText("Status updated.")).toBeVisible();

    // The second, still showing New, cancels it from New.
    await second.getByLabel("Current Status").selectOption("CANCELLED");
    await second.getByRole("button", { name: "Confirm and cancel" }).click();
    await expect(second.getByText("This ticket moved to Open while you were viewing it.")).toBeVisible();
    await expect(second.getByLabel("Current Status")).toHaveValue("OPEN");
    await expect(second.getByRole("button", { name: "Confirm and cancel" })).toHaveCount(0);
    await first.close();
    await second.close();
  });
});
