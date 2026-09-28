import { expect, test } from "@playwright/test";
import { createTicket } from "../lab-02/helpers.js";
import { createTicketAsRequester, LANDING, logout, REQUESTER, short, signIn, STAFF } from "./helpers.js";

// E2E-03 and E2E-04 from docs/lab-03/tests.md.
test.describe("Staff Ticket flow and Requester regression", () => {
  // E2E-03 (AC-16 to AC-27)
  test("finds, claims, prioritises, moves, comments on, notes and resolves a Ticket; the Requester sees all but the note", async ({ page }) => {
    const ticket = await createTicketAsRequester(`E2E staff flow ${short()}`);
    const comment = `We are looking at it now ${short()}`;
    const note = `Internal: VPN profile expired on the gateway ${short()}`;
    const resolution = `Reissued the VPN profile and confirmed the connection ${short()}`;

    // Find it in the queue.
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await page.getByLabel("Search tickets").fill(ticket.ticketNumber);
    const row = page.getByRole("table").getByRole("button", { name: new RegExp(ticket.ticketNumber) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Unassigned");
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/staff/tickets/${ticket.id}$`));
    await expect(page.getByRole("heading", { name: ticket.ticketNumber })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ticket Queue" }).first()).toHaveAttribute("aria-current", "page");
    // ui-spec section 8: the breadcrumb reads "Ticket Queue > Ticket Detail".
    const separator = await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .locator(".breadcrumb-item.active")
      .evaluate((item) => getComputedStyle(item, "::before").content);
    expect(separator).toBe('">"');

    const owner = page.getByLabel("Ticket Owner");
    const priority = page.getByLabel("IT Priority");
    const status = page.getByLabel("Current Status");

    // Claim (AC-16, AC-17).
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(owner.locator("option:checked")).toHaveText(`${STAFF.name} (you)`);
    await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);

    // IT Priority (AC-20, AC-21), separate from the Requested Priority.
    await priority.selectOption("HIGH");
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(priority).toHaveValue("HIGH");

    // Status: only permitted moves are offered (AC-23), NEW to OPEN to IN_PROGRESS.
    await expect(status.locator("option")).toHaveText(["New", "Open", "Cancelled"]);
    await status.selectOption("OPEN");
    await expect(status).toHaveValue("OPEN");
    await status.selectOption("IN_PROGRESS");
    await expect(status).toHaveValue("IN_PROGRESS");

    // A Public Comment (AC-26) and an Internal Note (AC-27).
    await page.getByLabel("Add Public Comment").fill(comment);
    await page.getByRole("button", { name: "Post Comment" }).click();
    await expect(page.getByRole("tab", { name: "Public Comments (1)" })).toBeVisible();
    await expect(page.getByRole("tabpanel").getByText(comment)).toBeVisible();

    await page.getByRole("tab", { name: /^Internal Notes/ }).click();
    await expect(page.getByText("Internal only. Not visible to the Requester.")).toBeVisible();
    await page.getByLabel("Add Internal Note").fill(note);
    await page.getByRole("button", { name: "Add Note" }).click();
    await expect(page.getByRole("tab", { name: "Internal Notes (1)" })).toBeVisible();
    await expect(page.getByRole("tabpanel").getByText(note)).toBeVisible();

    // Resolve with a Resolution Summary (AC-24).
    await status.selectOption("RESOLVED");
    await page.getByLabel("Resolution Summary *").fill(resolution);
    await page.getByRole("button", { name: "Confirm and resolve" }).click();
    await expect(status).toHaveValue("RESOLVED");
    await expect(page.getByLabel("Resolution Summary", { exact: true })).toHaveValue(resolution);

    // Every step persisted.
    await page.reload();
    await expect(owner.locator("option:checked")).toHaveText(`${STAFF.name} (you)`);
    await expect(priority).toHaveValue("HIGH");
    await expect(status).toHaveValue("RESOLVED");
    await expect(page.getByRole("tab", { name: "Public Comments (1)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Internal Notes (1)" })).toBeVisible();
    await logout(page);

    // The Requester sees the comment and the resolution, never the note.
    const noteRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/notes")) noteRequests.push(req.url());
    });
    await signIn(page, REQUESTER.email, LANDING.REQUESTER);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByLabel("Ticket No.")).toHaveValue(ticket.ticketNumber);
    await expect(page.getByLabel("Resolution Summary")).toHaveValue(resolution);
    await expect(page.getByRole("heading", { name: "Public Comments (1)" })).toBeVisible();
    await expect(page.getByText(comment)).toBeVisible();
    await expect(page.getByText(note)).toHaveCount(0);
    await expect(page.getByText(/Internal Note/i)).toHaveCount(0);
    expect(noteRequests).toEqual([]);
    expect((await page.request.get(`/api/tickets/${ticket.id}/notes`)).status()).toBe(403);
  });

  // E2E-04 (AC-14)
  test("keeps the Lab 2 Requester flow under the signed-in identity: create with an attachment, list, filter, open, remove", async ({ page }) => {
    await signIn(page, REQUESTER.email, LANDING.REQUESTER);
    const summary = `E2E regression ${short()}`;
    const { ticketNumber } = await createTicket(page, summary, {
      attachment: { name: "regression.png", mimeType: "image/png", body: Buffer.from("fake png bytes for the Lab 3 regression") },
    });

    // List and filter: the new Ticket is in My Tickets, and a filter that excludes it hides it.
    await page.goto("/tickets");
    await page.getByPlaceholder(/search by ticket number/i).fill(ticketNumber);
    await expect(page.getByText(summary).first()).toBeVisible();
    const priorityFilter = page.locator("select").filter({ has: page.locator("option", { hasText: "All Priorities" }) });
    await priorityFilter.selectOption("LOW");
    await expect(page.getByText(/no tickets match your filters/i)).toBeVisible();
    await priorityFilter.selectOption("MEDIUM");
    await expect(page.getByText(summary).first()).toBeVisible();

    // Open it: the Ticket belongs to the signed-in Requester.
    await page.getByText(summary).first().click();
    await expect(page).toHaveURL(/\/tickets\/\d+$/);
    await expect(page.getByLabel("Ticket No.")).toHaveValue(ticketNumber);
    await expect(page.getByLabel("Requester")).toHaveValue(REQUESTER.name);

    // Remove the attachment with a reason, exactly as in Lab 2.
    await expect(page.getByText("Attachments (1 active)")).toBeVisible();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByLabel(/reason for removal/i).fill("Attached the wrong screenshot");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Attachments (0 active)")).toBeVisible();
    await expect(page.getByText("Removed", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);
  });
});
