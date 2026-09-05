import { expect, Page } from "@playwright/test";

export const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
} as const;

// Picks a Development Requester by its position in the seeded active list, so
// the specs do not hard-code seed names that BR-37 lets us change.
export async function selectRequester(page: Page, index = 0): Promise<string> {
  await page.goto("/select-requester");

  const select = page.getByLabel(/development requester \*/i);
  await expect(select).toBeVisible();

  const name = await select.locator("option").nth(index + 1).textContent();
  const value = await select.locator("option").nth(index + 1).getAttribute("value");
  await select.selectOption(value!);

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/tickets$/);

  return (name ?? "").trim();
}

export async function changeRequester(page: Page, index: number): Promise<string> {
  await page.getByRole("button", { name: /change requester/i }).click();
  await expect(page).toHaveURL(/\/select-requester$/);
  return selectRequester(page, index);
}

export interface CreatedTicket {
  ticketNumber: string;
  summary: string;
}

// Fills and submits Create Ticket, optionally attaching one file, and returns
// the Ticket Number the success panel reports.
export async function createTicket(
  page: Page,
  summary: string,
  options: { attachment?: { name: string; mimeType: string; body: Buffer } } = {},
): Promise<CreatedTicket> {
  await page.goto("/tickets/new");

  await page.getByLabel(/^category \*/i).selectOption({ index: 1 });
  await page.getByLabel(/^related system \*/i).selectOption({ index: 1 });
  await page.getByLabel(/^requested priority \*/i).selectOption("MEDIUM");
  await page.getByLabel(/^summary \*/i).fill(summary);
  await page
    .getByLabel(/^description \*/i)
    .fill("Created by the Lab 2 Playwright end-to-end suite to verify the full requester flow.");

  if (options.attachment) {
    await page.getByLabel(/^attachments/i).setInputFiles({
      name: options.attachment.name,
      mimeType: options.attachment.mimeType,
      buffer: options.attachment.body,
    });
  }

  await page.getByRole("button", { name: "Submit Ticket" }).click();

  const successPanel = page.getByText(/created\./i);
  await expect(successPanel).toBeVisible({ timeout: 15_000 });

  const panelText = (await successPanel.textContent()) ?? "";
  const match = panelText.match(/TKT-\d{4}-\d{6}/);
  expect(match, `expected a Ticket Number in "${panelText}"`).not.toBeNull();

  return { ticketNumber: match![0], summary };
}

// True when the page fits its viewport horizontally (ui-spec.md §10, AC-19).
export async function hasNoHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}
