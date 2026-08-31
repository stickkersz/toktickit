import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { changeRequester, createTicket, selectRequester } from "./helpers.js";

// E2E-01 / E2E-02 from docs/lab-02/tests.md. Runs against a live client, API,
// and seeded database (see playwright.config.ts).
test.describe("Requester ticket flow", () => {
  // E2E-01 (AC-01, AC-14, AC-15)
  test("creates a Ticket with an attachment, opens its Detail, and removes the attachment", async ({
    page,
  }) => {
    await selectRequester(page, 0);

    const summary = `E2E create and remove ${randomUUID().slice(0, 8)}`;
    const { ticketNumber } = await createTicket(page, summary, {
      attachment: {
        name: "evidence.png",
        mimeType: "image/png",
        body: Buffer.from("fake png bytes for the end-to-end attachment test"),
      },
    });

    // AC-01: the official Ticket Number comes back from the backend.
    expect(ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);

    await page.getByRole("button", { name: "View Ticket" }).click();
    await expect(page).toHaveURL(/\/tickets\/\d+$/);

    // The same Ticket Number is shown on Ticket Detail (read-only field).
    await expect(page.getByLabel("Ticket No.")).toHaveValue(ticketNumber);
    await expect(page.getByLabel("Summary")).toHaveValue(summary);

    // ui-spec.md §11: Ticket Detail still belongs to the My Tickets section, so
    // the nav keeps a current page rather than highlighting nothing.
    await expect(page.getByRole("link", { name: "My Tickets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("link", { name: "Create Ticket" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    // AC-14: the attachment uploaded during creation is listed as active.
    await expect(page.getByText("Attachments (1 active)")).toBeVisible();
    await expect(page.getByText("evidence.png")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toBeVisible();

    // AC-15: soft-remove it with a reason.
    await page.getByRole("button", { name: "Remove" }).click();
    const confirmButton = page.getByRole("button", { name: "Confirm" });
    await expect(confirmButton).toBeDisabled();

    await page.getByLabel(/reason for removal/i).fill("Uploaded the wrong screenshot");
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // Metadata is retained, the row is marked Removed, and the download control
    // is gone (BR-30).
    await expect(page.getByText("Attachments (0 active)")).toBeVisible();
    await expect(page.getByText("Removed", { exact: true })).toBeVisible();
    await expect(page.getByText("evidence.png")).toBeVisible();
    await expect(page.getByText(/uploaded the wrong screenshot/i)).toBeVisible();
    await expect(page.getByText("Unavailable")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);

    // The Ticket Number is unchanged after the attachment lifecycle.
    await expect(page.getByLabel("Ticket No.")).toHaveValue(ticketNumber);
  });

  // E2E-02 (AC-03, AC-11, AC-18)
  test("hides another Requester's Ticket from both the list and direct URL access", async ({
    page,
  }) => {
    await selectRequester(page, 0);

    const summary = `E2E ownership ${randomUUID().slice(0, 8)}`;
    const { ticketNumber } = await createTicket(page, summary);

    await page.getByRole("button", { name: "View Ticket" }).click();
    await expect(page).toHaveURL(/\/tickets\/\d+$/);
    const ownedTicketUrl = page.url();

    // AC-18: switching Requester clears the previous Requester's data.
    await changeRequester(page, 1);

    // AC-11: Requester B's list must not contain Requester A's ticket.
    await page.getByPlaceholder(/search by ticket number/i).fill(ticketNumber);
    await expect(page.getByText(/no tickets match your filters/i)).toBeVisible();
    await expect(page.getByText(summary)).toHaveCount(0);

    // AC-03/BR-35: direct URL access is refused without leaking the data.
    await page.goto(ownedTicketUrl);
    await expect(page.getByText("Ticket not found.")).toBeVisible();
    await expect(page.getByText(summary)).toHaveCount(0);
    await expect(page.getByText(ticketNumber)).toHaveCount(0);
  });
});
