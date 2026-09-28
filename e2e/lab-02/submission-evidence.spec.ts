import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  apiSignedIn,
  categoryId,
  createTicket,
  REQUESTERS,
  seedTickets,
  signInAsRequester,
  switchRequester,
} from "./helpers.js";

// Additional evidence for the Lab 2 submission PDF (handout §14 Parts 6-8)
// beyond what tests.md's own planned tests already require. These states are
// not separately named in tests.md's traceability table; they exist purely to
// produce readable, real screenshots for the PDF's evidence requirements.
//
// Lab 3: these specs sign in for real (helpers.ts) instead of choosing a Development
// Requester. The Requester Selection screen was deleted (BR-49), so its evidence test is
// retired: the screenshots it produced for the Lab 2 submission stay committed.
//
// The "My Tickets" test used to seed an exact number of Tickets and assert exact totals,
// so it only passed against a freshly wiped database and failed on every rerun. It now
// tags everything it creates with a per-run token and scopes each assertion to that
// token, so it is repeatable against a database that already holds other Tickets. It uses
// Requester indices 2/3 so it stays apart from the other two specs, which use 0/1.
const SHOTS = "artifacts/lab-02/screenshots";

function shot(screen: string, name: string): string {
  return `${SHOTS}/${screen}/${name}.png`;
}

test.describe("Submission evidence: Create Ticket submit failure", () => {
  // Handout §14 Part 6, item 5: "Stop the backend or simulate failure and show
  // the safe error state with form values preserved." The existing
  // create-ticket/api-failure-desktop.png covers a *reference-data* load
  // failure, where the form never renders and so has no values to preserve.
  // This captures the other half: a backend failure during submit, with what
  // the Requester typed still in the form.
  test("keeps the typed values when the create request fails", async ({ page }) => {
    await signInAsRequester(page, 2);
    await page.goto("/tickets/new");

    const summary = "Projector in room 401 will not power on";
    const description =
      "The projector shows no power light at all, and swapping the cable and wall socket changed nothing.";

    await page.getByLabel(/^category \*/i).selectOption({ index: 1 });
    await page.getByLabel(/^related system \*/i).selectOption({ index: 1 });
    await page.getByLabel(/^requested priority \*/i).selectOption("HIGH");
    await page.getByLabel(/^summary \*/i).fill(summary);
    await page.getByLabel(/^description \*/i).fill(description);

    // Read back what the two reference-data selects actually resolved to, so
    // the assertions below compare against real ids rather than assuming what
    // the seed happens to order first.
    const categoryValue = await page.getByLabel(/^category \*/i).inputValue();
    const relatedSystemValue = await page.getByLabel(/^related system \*/i).inputValue();
    expect(categoryValue).not.toBe("");
    expect(relatedSystemValue).not.toBe("");

    // Simulate the backend being unreachable at submit time.
    await page.route("**/api/tickets", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.abort("failed");
    });

    await page.getByRole("button", { name: "Submit Ticket" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    // The point of the evidence: nothing the Requester entered was lost
    // (BR-19), including the two reference-data selects, not just the free
    // text and the priority.
    await expect(page.getByLabel(/^category \*/i)).toHaveValue(categoryValue);
    await expect(page.getByLabel(/^related system \*/i)).toHaveValue(relatedSystemValue);
    await expect(page.getByLabel(/^requested priority \*/i)).toHaveValue("HIGH");
    await expect(page.getByLabel(/^summary \*/i)).toHaveValue(summary);
    await expect(page.getByLabel(/^description \*/i)).toHaveValue(description);

    await page.screenshot({
      path: shot("create-ticket", "submit-failure-values-preserved-desktop"),
      fullPage: true,
    });
    await page.unroute("**/api/tickets");
  });
});

test.describe("Submission evidence: My Tickets search, filter, sort, pagination, ownership", () => {
  test("search, filter, sort, page 2, and a Requester switch that hides the list", async ({ page }) => {
    const name = await signInAsRequester(page, 2);

    // Every Ticket this run creates carries the token, and every assertion below is
    // scoped to it, so Tickets left by earlier runs cannot change a count or an order.
    const token = `Run${randomUUID().slice(0, 6)}`;
    const network = await categoryId("Network");
    const hardware = await categoryId("Hardware");
    const account = await categoryId("Account and Access");
    const software = await categoryId("Software");

    const owner = await apiSignedIn(REQUESTERS[2].email);
    await seedTickets(owner, [
      { summary: `${token} Network drop`, categoryId: network, relatedSystemId: 1, requestedPriority: "HIGH" },
      { summary: `${token} Printer will not respond`, categoryId: hardware, relatedSystemId: 2, requestedPriority: "LOW" },
      { summary: `${token} Password reset needed`, categoryId: account, relatedSystemId: 3, requestedPriority: "MEDIUM" },
      { summary: `${token} Grade portal times out`, categoryId: software, relatedSystemId: 4, requestedPriority: "HIGH" },
      { summary: `${token} Wi-Fi drops in library`, categoryId: network, relatedSystemId: 1, requestedPriority: "MEDIUM" },
      { summary: `${token} Laptop will not charge`, categoryId: hardware, relatedSystemId: 2, requestedPriority: "LOW" },
      { summary: `${token} Cannot access shared drive`, categoryId: account, relatedSystemId: 3, requestedPriority: "MEDIUM" },
      { summary: `${token} VPN certificate expired`, categoryId: network, relatedSystemId: 1, requestedPriority: "HIGH" },
      { summary: `${token} Email attachments blocked`, categoryId: account, relatedSystemId: 3, requestedPriority: "LOW" },
      { summary: `${token} Kiosk screen frozen`, categoryId: hardware, relatedSystemId: 2, requestedPriority: "MEDIUM" },
      { summary: `${token} Course registration error`, categoryId: software, relatedSystemId: 4, requestedPriority: "HIGH" },
    ]);
    await owner.dispose();

    await page.goto("/tickets");
    await expect(page.getByRole("table")).toBeVisible();
    const search = page.getByPlaceholder(/search by ticket number/i);

    // Search applied (Part 7): a phrase that matches exactly one of this run's Tickets.
    await search.fill(`${token} Network drop`);
    // Scoped to the desktop table: the mobile card list renders in the DOM at
    // the same time (CSS-hidden, not unmounted), so an unscoped getByText
    // matches both and fails Playwright's strict mode.
    await expect(page.getByRole("table").getByText(`${token} Network drop`)).toBeVisible();
    await expect(page.getByText(/showing 1.1 of 1 tickets/i)).toBeVisible();
    await page.screenshot({ path: shot("my-tickets", "search-applied-desktop"), fullPage: true });

    // Filter applied: Network, within this run's 11 Tickets (3 of them are Network).
    await search.fill(token);
    await page.getByRole("combobox").nth(0).selectOption({ label: "Network" });
    await expect(page.getByText(/showing 1.3 of 3 tickets/i)).toBeVisible();
    await page.screenshot({ path: shot("my-tickets", "filter-applied-desktop"), fullPage: true });
    await page.getByRole("button", { name: "Clear Filters" }).click();

    // Sort applied: Summary ascending, among this run's 11 Tickets. "Cannot access
    // shared drive" sorts first once the shared token prefix is equal.
    await search.fill(token);
    await expect(page.getByText(/showing 1.10 of 11 tickets/i)).toBeVisible();
    await page.getByRole("columnheader", { name: "Summary" }).click();
    await expect(page.getByRole("columnheader", { name: /summary ▲/i })).toBeVisible();
    await expect(page.locator("tbody tr").first()).toContainText(`${token} Cannot access shared drive`);
    await page.screenshot({ path: shot("my-tickets", "sort-applied-desktop"), fullPage: true });

    // Pagination: PAGE_SIZE is 10 and this run made 11 Tickets, so page 2 holds exactly
    // the alphabetically-last one. The "Page X of Y" indicator updates synchronously on
    // click (local state), ahead of the async re-fetch that replaces the rows, so the
    // assertion waits on the row content itself.
    await expect(page.getByText(/^page 1 of 2$/i)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/^page 2 of 2$/i)).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr").first()).toContainText(`${token} Wi-Fi drops in library`);
    await page.screenshot({ path: shot("my-tickets", "page-2-desktop"), fullPage: true });

    // Signing in as someone else: Requester B must never see Requester A's Tickets. The
    // list is whatever B owns (possibly empty), and none of it carries this run's token.
    await switchRequester(page, 3);
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
    await expect(page.getByText(token)).toHaveCount(0);
    await page.screenshot({
      path: shot("my-tickets", "switched-requester-hides-previous-desktop"),
      fullPage: true,
    });

    expect(name.length).toBeGreaterThan(0);
  });
});

test.describe("Submission evidence: Ticket Detail attachment add, download, and unauthorized access", () => {
  test("adds an attachment after creation, downloads it, and blocks a foreign Requester", async ({
    page,
  }) => {
    // Indices 2/3 for the same reason as the My Tickets test above: stay off
    // the 0/1 slots the other specs use.
    await signInAsRequester(page, 2);
    const { ticketNumber } = await createTicket(
      page,
      `Add-attachment-after-creation ${randomUUID().slice(0, 8)}`,
    );

    await page.getByRole("button", { name: "View Ticket" }).click();
    await expect(page).toHaveURL(/\/tickets\/\d+$/);
    const ownedTicketUrl = page.url();
    await expect(page.getByText("Attachments (0 active)")).toBeVisible();

    // Add an attachment from Ticket Detail directly (not at creation time).
    await page.getByLabel("Add Attachment").setInputFiles({
      name: "added-after-creation.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake png bytes added after ticket creation"),
    });
    await expect(page.getByText("Attachments (1 active)")).toBeVisible();
    await expect(page.getByText("added-after-creation.png")).toBeVisible();
    await page.screenshot({ path: shot("ticket-detail", "attachment-added-after-creation-desktop"), fullPage: true });

    // Download the active attachment; Playwright's download event proves the
    // browser actually received a file, not just that a link is present.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("added-after-creation.png");
    await page.screenshot({ path: shot("ticket-detail", "attachment-downloaded-desktop"), fullPage: true });

    // A different Requester must not reach this Ticket (or its attachment)
    // by direct URL (handout Part 8's unauthorized-access requirement).
    await switchRequester(page, 3);
    await page.goto(ownedTicketUrl);
    await expect(page.getByText("Ticket not found.")).toBeVisible();
    await expect(page.getByText("added-after-creation.png")).toHaveCount(0);
    await expect(page.getByText(ticketNumber)).toHaveCount(0);
    await page.screenshot({ path: shot("ticket-detail", "unauthorized-access-desktop"), fullPage: true });
  });
});
