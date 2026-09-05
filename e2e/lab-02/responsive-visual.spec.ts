import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createTicket, hasNoHorizontalScroll, selectRequester, VIEWPORTS } from "./helpers.js";

// RESP-01 (AC-19) from docs/lab-02/tests.md: capture every screen at the three
// documented viewports, save them to the exact ui-spec.md §13 paths, and assert
// no screen scrolls horizontally at any width.
const SHOTS = "artifacts/lab-02/screenshots";

function shot(screen: string, name: string): string {
  return `${SHOTS}/${screen}/${name}.png`;
}

test.describe("Responsive and visual evidence", () => {
  test("Create Ticket states and viewports", async ({ page }) => {
    await selectRequester(page, 0);

    // Requester Selection failure state is captured before entering the app,
    // since the shell is only reachable with a Requester selected.
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/tickets/new");
    await expect(page.getByLabel(/^summary \*/i)).toBeVisible();
    await page.screenshot({ path: shot("create-ticket", "initial-desktop"), fullPage: true });
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // Validation failure with per-field messages (BR-18, handout §8.3). Submit
    // is disabled while the form is client-side invalid, so the reachable
    // field-error path is a server 400 VALIDATION_ERROR carrying `fields`.
    await page.getByLabel(/^category \*/i).selectOption({ index: 1 });
    await page.getByLabel(/^related system \*/i).selectOption({ index: 1 });
    await page.getByLabel(/^requested priority \*/i).selectOption("LOW");
    await page.getByLabel(/^summary \*/i).fill("Printer jam on level 3");
    await page
      .getByLabel(/^description \*/i)
      .fill("The shared printer keeps jamming whenever a duplex job is sent to it.");

    await page.route("**/api/tickets", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "VALIDATION_ERROR",
          message: "Summary must be between 5 and 120 characters.",
          fields: {
            summary: "Summary must be between 5 and 120 characters.",
            description: "Description must be between 20 and 2000 characters.",
          },
        }),
      });
    });

    await page.getByRole("button", { name: "Submit Ticket" }).click();
    await expect(page.getByText("Summary must be between 5 and 120 characters.")).toBeVisible();
    await expect(
      page.getByText("Description must be between 20 and 2000 characters."),
    ).toBeVisible();
    await page.screenshot({
      path: shot("create-ticket", "validation-error-desktop"),
      fullPage: true,
    });
    await page.unroute("**/api/tickets");

    // Values entered before the failure are preserved (BR-19).
    await expect(page.getByLabel(/^summary \*/i)).toHaveValue("Printer jam on level 3");

    // Invalid attachment: a wrong-type file is rejected inline (AC-08).
    await page.getByLabel(/^attachments/i).setInputFiles({
      name: "notes.docx",
      mimeType: "application/msword",
      buffer: Buffer.from("not really a docx"),
    });
    await expect(page.getByText(/only jpg, jpeg, png, webp, and pdf/i)).toBeVisible();
    await page.screenshot({
      path: shot("create-ticket", "invalid-attachment-desktop"),
      fullPage: true,
    });

    // Submitting (busy) state: hold the POST open so the busy button is visible.
    await page.getByLabel(/^summary \*/i).fill(`Responsive evidence ${randomUUID().slice(0, 8)}`);
    await page
      .getByLabel(/^description \*/i)
      .fill("Captured by the responsive and visual Playwright suite for Lab 2 evidence.");

    let releaseCreate: () => void = () => {};
    const createHeld = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    await page.route("**/api/tickets", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await createHeld;
      await route.fallback();
    });

    await page.getByRole("button", { name: "Submit Ticket" }).click();
    await expect(page.getByRole("button", { name: /submitting/i })).toBeDisabled();
    await page.screenshot({ path: shot("create-ticket", "submitting-desktop"), fullPage: true });
    releaseCreate();

    // Success state with the backend-generated Ticket Number.
    await expect(page.getByText(/created\./i)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot("create-ticket", "success-desktop"), fullPage: true });
    await page.unroute("**/api/tickets");

    // API failure state: reference data fails to load.
    await page.route("**/api/categories", (route) => route.abort("failed"));
    await page.goto("/tickets/new");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.screenshot({ path: shot("create-ticket", "api-failure-desktop"), fullPage: true });
    await page.unroute("**/api/categories");

    // Tablet and mobile initial states.
    for (const [label, size] of [
      ["tablet", VIEWPORTS.tablet],
      ["mobile", VIEWPORTS.mobile],
    ] as const) {
      await page.setViewportSize(size);
      await page.goto("/tickets/new");
      await expect(page.getByLabel(/^summary \*/i)).toBeVisible();
      await page.screenshot({ path: shot("create-ticket", `initial-${label}`), fullPage: true });
      expect(await hasNoHorizontalScroll(page), `Create Ticket scrolls at ${label}`).toBe(true);
    }
  });

  test("My Tickets states and viewports", async ({ page }) => {
    await selectRequester(page, 0);
    await createTicket(page, `Responsive list evidence ${randomUUID().slice(0, 8)}`);

    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/tickets");
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await page.screenshot({ path: shot("my-tickets", "loaded-desktop"), fullPage: true });
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // No-results state: a search that matches nothing (BR-24a).
    await page.getByPlaceholder(/search by ticket number/i).fill("zzz-no-such-ticket-zzz");
    await expect(page.getByText(/no tickets match your filters/i)).toBeVisible();
    await page.screenshot({ path: shot("my-tickets", "no-results-desktop"), fullPage: true });

    // Empty state: a Requester who owns no Tickets at all, distinct from
    // no-results (BR-24a). Served by stubbing an empty first page.
    await page.route("**/api/tickets?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
        }),
      }),
    );
    await page.goto("/tickets");
    await expect(page.getByText(/haven't submitted any tickets yet/i)).toBeVisible();
    await page.screenshot({ path: shot("my-tickets", "empty-desktop"), fullPage: true });
    await page.unroute("**/api/tickets?*");

    // Failure state with Retry.
    await page.route("**/api/tickets?*", (route) => route.abort("failed"));
    await page.goto("/tickets");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.screenshot({ path: shot("my-tickets", "failure-desktop"), fullPage: true });
    await page.unroute("**/api/tickets?*");

    // Tablet keeps the table (Created Date/Category hidden below lg); mobile
    // switches to the card list (ui-spec.md §7).
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto("/tickets");
    await expect(page.getByRole("table")).toBeVisible();
    await page.screenshot({ path: shot("my-tickets", "loaded-tablet"), fullPage: true });
    expect(await hasNoHorizontalScroll(page), "My Tickets scrolls at tablet").toBe(true);

    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/tickets");
    await expect(page.getByLabel("Tickets").locator(".card").first()).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();
    await page.screenshot({ path: shot("my-tickets", "loaded-mobile"), fullPage: true });
    expect(await hasNoHorizontalScroll(page), "My Tickets scrolls at mobile").toBe(true);
  });

  test("Ticket Detail states and viewports", async ({ page }) => {
    await selectRequester(page, 0);
    await createTicket(page, `Responsive detail evidence ${randomUUID().slice(0, 8)}`, {
      attachment: {
        name: "detail-evidence.png",
        mimeType: "image/png",
        body: Buffer.from("fake png bytes for the responsive detail screenshots"),
      },
    });

    await page.getByRole("button", { name: "View Ticket" }).click();
    await expect(page).toHaveURL(/\/tickets\/\d+$/);
    const detailUrl = page.url();

    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto(detailUrl);
    await expect(page.getByText("Attachments (1 active)")).toBeVisible();
    await page.screenshot({ path: shot("ticket-detail", "loaded-desktop"), fullPage: true });
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // Removed-attachment state (BR-30).
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByLabel(/reason for removal/i).fill("Superseded by a clearer screenshot");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Attachments (0 active)")).toBeVisible();
    await page.screenshot({
      path: shot("ticket-detail", "attachment-removed-desktop"),
      fullPage: true,
    });

    for (const [label, size] of [
      ["tablet", VIEWPORTS.tablet],
      ["mobile", VIEWPORTS.mobile],
    ] as const) {
      await page.setViewportSize(size);
      await page.goto(detailUrl);
      await expect(page.getByText(/attachments \(\d+ active\)/i)).toBeVisible();
      await page.screenshot({ path: shot("ticket-detail", `loaded-${label}`), fullPage: true });
      expect(await hasNoHorizontalScroll(page), `Ticket Detail scrolls at ${label}`).toBe(true);
    }
  });
});
