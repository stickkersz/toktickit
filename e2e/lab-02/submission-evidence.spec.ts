import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { API_URL, changeRequester, createTicket, seedTickets, selectRequester } from "./helpers.js";

// Additional evidence for the Lab 2 submission PDF (handout §14 Parts 6-8)
// beyond what tests.md's own planned tests already require. These states are
// not separately named in tests.md's traceability table; they exist purely to
// produce readable, real screenshots for the PDF's evidence requirements.
//
// Unlike requester-ticket-flow.spec.ts and responsive-visual.spec.ts (tests.md's
// actual graded suite, idempotent and safe to rerun without touching the
// database), the "My Tickets" test below seeds an exact number of Tickets and
// asserts exact counts and page totals. Run it once against a freshly wiped
// database (`TRUNCATE TABLE "Attachment", "Ticket" RESTART IDENTITY CASCADE;`
// on toktickit-pg); running it again without wiping first will double the
// count and fail the exact-total assertions. It uses Requester indices 2/3
// specifically so it can run alongside the other two specs in one
// `npx playwright test` without their Tickets (on indices 0/1) affecting it.
const SHOTS = "artifacts/lab-02/screenshots";

function shot(screen: string, name: string): string {
  return `${SHOTS}/${screen}/${name}.png`;
}

test.describe("Submission evidence: Requester Selection", () => {
  test("loading, failure, selected display, and Change Requester", async ({ page }) => {
    // Loading state: hold the requesters response open so the disabled,
    // loading <select> is visible long enough to capture.
    let releaseRequesters: () => void = () => {};
    const requestersHeld = new Promise<void>((resolve) => {
      releaseRequesters = resolve;
    });
    await page.route("**/api/requesters", async (route) => {
      await requestersHeld;
      await route.fallback();
    });
    await page.goto("/select-requester");
    await expect(page.getByLabel("Development Requester (loading)")).toBeDisabled();
    await page.screenshot({ path: shot("requester-selection", "loading-desktop"), fullPage: true });
    releaseRequesters();
    await page.unroute("**/api/requesters");

    // Failure state with Retry (handout §8.1's "safe API-failure state").
    await page.route("**/api/requesters", (route) => route.abort("failed"));
    await page.goto("/select-requester");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("Unable to load Development Requesters.")).toBeVisible();
    await page.screenshot({ path: shot("requester-selection", "failure-desktop"), fullPage: true });
    await page.unroute("**/api/requesters");

    // Ready state: active-Requester dropdown populated from PostgreSQL.
    await page.goto("/select-requester");
    const select = page.getByLabel(/development requester \*/i);
    await expect(select).toBeVisible();
    const name = (await select.locator("option").nth(1).textContent())?.trim() ?? "";
    const value = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(value!);
    await page.screenshot({ path: shot("requester-selection", "ready-selected-desktop"), fullPage: true });

    // After Continue: the shell shows the selected Requester's name and a
    // Change Requester action (handout §8.1 "After selection").
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /change requester/i })).toBeVisible();
    await page.screenshot({ path: shot("requester-selection", "selected-in-shell-desktop"), fullPage: true });

    // Change Requester returns to the selection screen.
    await page.getByRole("button", { name: /change requester/i }).click();
    await expect(page).toHaveURL(/\/select-requester$/);
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await page.screenshot({ path: shot("requester-selection", "change-requester-desktop"), fullPage: true });
  });
});

test.describe("Submission evidence: Create Ticket submit failure", () => {
  // Handout §14 Part 6, item 5: "Stop the backend or simulate failure and show
  // the safe error state with form values preserved." The existing
  // create-ticket/api-failure-desktop.png covers a *reference-data* load
  // failure, where the form never renders and so has no values to preserve.
  // This captures the other half: a backend failure during submit, with what
  // the Requester typed still in the form.
  test("keeps the typed values when the create request fails", async ({ page }) => {
    await selectRequester(page, 2);
    await page.goto("/tickets/new");

    const summary = "Projector in room 401 will not power on";
    const description =
      "The projector shows no power light at all, and swapping the cable and wall socket changed nothing.";

    await page.getByLabel(/^category \*/i).selectOption({ index: 1 });
    await page.getByLabel(/^related system \*/i).selectOption({ index: 1 });
    await page.getByLabel(/^requested priority \*/i).selectOption("HIGH");
    await page.getByLabel(/^summary \*/i).fill(summary);
    await page.getByLabel(/^description \*/i).fill(description);

    // Simulate the backend being unreachable at submit time.
    await page.route("**/api/tickets", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.abort("failed");
    });

    await page.getByRole("button", { name: "Submit Ticket" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    // The point of the evidence: nothing the Requester typed was lost (BR-19).
    await expect(page.getByLabel(/^summary \*/i)).toHaveValue(summary);
    await expect(page.getByLabel(/^description \*/i)).toHaveValue(description);
    await expect(page.getByLabel(/^requested priority \*/i)).toHaveValue("HIGH");

    await page.screenshot({
      path: shot("create-ticket", "submit-failure-values-preserved-desktop"),
      fullPage: true,
    });
    await page.unroute("**/api/tickets");
  });
});

test.describe("Submission evidence: My Tickets search, filter, sort, pagination, ownership", () => {
  test("search, filter, sort, page 2, and a Requester switch that hides the list", async ({
    page,
    request,
  }) => {
    // Requester indices 2/3, not 0/1: requester-ticket-flow.spec.ts and
    // responsive-visual.spec.ts both act on indices 0/1, and this test's
    // exact-count assertions (search "1 of 1", filter "3 of 3", pagination)
    // would otherwise pick up whatever Tickets those specs created first,
    // breaking when the full suite runs together in file order. Using
    // untouched indices makes this test's counts independent of run order.
    const name = await selectRequester(page, 2);
    const requesters = await (await request.get(`${API_URL}/api/requesters`)).json();
    const requesterId = requesters[2].id;

    const uniqueTerm = `Findme${randomUUID().slice(0, 6)}`;
    await seedTickets(request, requesterId, [
      { summary: `${uniqueTerm} network drop`, categoryId: 4, relatedSystemId: 1, requestedPriority: "HIGH" },
      { summary: "Printer will not respond", categoryId: 2, relatedSystemId: 2, requestedPriority: "LOW" },
      { summary: "Password reset needed", categoryId: 1, relatedSystemId: 3, requestedPriority: "MEDIUM" },
      { summary: "Grade portal times out", categoryId: 3, relatedSystemId: 4, requestedPriority: "HIGH" },
      { summary: "Wi-Fi drops in library", categoryId: 4, relatedSystemId: 1, requestedPriority: "MEDIUM" },
      { summary: "Laptop will not charge", categoryId: 2, relatedSystemId: 2, requestedPriority: "LOW" },
      { summary: "Cannot access shared drive", categoryId: 1, relatedSystemId: 3, requestedPriority: "MEDIUM" },
      { summary: "VPN certificate expired", categoryId: 4, relatedSystemId: 1, requestedPriority: "HIGH" },
      { summary: "Email attachments blocked", categoryId: 1, relatedSystemId: 3, requestedPriority: "LOW" },
      { summary: "Kiosk screen frozen", categoryId: 2, relatedSystemId: 2, requestedPriority: "MEDIUM" },
      { summary: "Course registration error", categoryId: 3, relatedSystemId: 4, requestedPriority: "HIGH" },
    ]);

    await page.goto("/tickets");
    await expect(page.getByRole("table")).toBeVisible();

    // Search applied (Part 7).
    await page.getByPlaceholder(/search by ticket number/i).fill(uniqueTerm);
    // Scoped to the desktop table: the mobile card list renders in the DOM at
    // the same time (CSS-hidden, not unmounted), so an unscoped getByText
    // matches both and fails Playwright's strict mode.
    await expect(page.getByRole("table").getByText(`${uniqueTerm} network drop`)).toBeVisible();
    await expect(page.getByText(/showing 1.1 of 1 tickets/i)).toBeVisible();
    await page.screenshot({ path: shot("my-tickets", "search-applied-desktop"), fullPage: true });
    await page.getByPlaceholder(/search by ticket number/i).fill("");

    // Filter applied: Network category (3 rows seeded above).
    await page.getByRole("combobox").nth(0).selectOption({ label: "Network" });
    await expect(page.getByText(/showing 1.3 of 3 tickets/i)).toBeVisible();
    await page.screenshot({ path: shot("my-tickets", "filter-applied-desktop"), fullPage: true });
    await page.getByRole("button", { name: "Clear Filters" }).click();

    // Sort applied: Summary ascending. "Cannot access shared drive" sorts
    // first among the 11 seeded summaries.
    await page.getByRole("columnheader", { name: "Summary" }).click();
    await expect(page.getByRole("columnheader", { name: /summary ▲/i })).toBeVisible();
    await expect(page.locator("tbody tr").first()).toContainText("Cannot access shared drive");
    await page.screenshot({ path: shot("my-tickets", "sort-applied-desktop"), fullPage: true });

    // Pagination: PAGE_SIZE is 10, 11 Tickets were seeded for this Requester,
    // so page 2 holds exactly the alphabetically-last one. The "Page X of Y"
    // indicator updates synchronously on click (local state), ahead of the
    // async re-fetch that actually replaces the table's rows, so the
    // assertion below waits on the row content itself rather than reading it
    // immediately after the indicator changes.
    await expect(page.getByText(/^page 1 of 2$/i)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/^page 2 of 2$/i)).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr").first()).toContainText("Wi-Fi drops in library");
    await page.screenshot({ path: shot("my-tickets", "page-2-desktop"), fullPage: true });

    // Requester switch: Requester B must never see Requester A's 11 tickets.
    await changeRequester(page, 3);
    await expect(page.getByText(/haven't submitted any tickets yet/i)).toBeVisible();
    await expect(page.getByText(uniqueTerm)).toHaveCount(0);
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
    await selectRequester(page, 2);
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
    await changeRequester(page, 3);
    await page.goto(ownedTicketUrl);
    await expect(page.getByText("Ticket not found.")).toBeVisible();
    await expect(page.getByText("added-after-creation.png")).toHaveCount(0);
    await expect(page.getByText(ticketNumber)).toHaveCount(0);
    await page.screenshot({ path: shot("ticket-detail", "unauthorized-access-desktop"), fullPage: true });
  });
});
