import { APIRequestContext, expect, Page, request as pwRequest } from "@playwright/test";

export const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
} as const;

// Matches playwright.config.ts's own API_PORT. Not exported from there, so
// pinned here too rather than threading it through every spec's imports.
export const API_URL = "http://127.0.0.1:3001";

// ---------------------------------------------------------------------------
// Lab 3: real sign-in replaces the Development Requester selector (BR-49).
//
// The seed gives every account the documented initial password and forces a change
// at first login. The specs need to run repeatedly against the same database, so
// prepareAccount() puts an account into a known state: it uses E2E_PASSWORD when that
// already works, and otherwise takes the account through its one-time initial
// password change to E2E_PASSWORD. It never touches an account that holds some
// other password, and says so instead of guessing.
// ---------------------------------------------------------------------------
export const SEED_INITIAL_PASSWORD = "ChangeMe!23";
export const E2E_PASSWORD = "E2e!Passw0rd7";

// The active seeded Requesters, in seed order. Specs pick by position so two specs
// can be kept apart by using different indices (0/1 and 2/3).
export const REQUESTERS = [
  { name: "Kanokwan Srisuwan", email: "kanokwan.srisuwan@toktickit.test" },
  { name: "Thanapon Wattana", email: "thanapon.wattana@toktickit.test" },
  { name: "Nutchanon Boonmee", email: "nutchanon.boonmee@toktickit.test" },
  { name: "Ploypailin Chaisiri", email: "ploypailin.chaisiri@toktickit.test" },
] as const;

// An API context signed in as the account, holding its session cookie.
export async function apiSignedIn(email: string): Promise<APIRequestContext> {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const usual = await api.post("/api/auth/login", { data: { email, password: E2E_PASSWORD } });
  if (usual.ok()) return api;

  const initial = await api.post("/api/auth/login", { data: { email, password: SEED_INITIAL_PASSWORD } });
  if (!initial.ok()) {
    await api.dispose();
    throw new Error(
      `${email} accepts neither the e2e password nor the seed's initial password (login ${initial.status()}). ` +
        "Re-run the seed after resetting that account, or use a freshly seeded database.",
    );
  }
  const changed = await api.post("/api/auth/change-password", {
    data: { currentPassword: SEED_INITIAL_PASSWORD, newPassword: E2E_PASSWORD, confirmPassword: E2E_PASSWORD },
  });
  if (!changed.ok()) {
    await api.dispose();
    throw new Error(`could not take ${email} through its initial password change (${changed.status()}): ${await changed.text()}`);
  }
  return api;
}

export async function prepareAccount(email: string): Promise<void> {
  const api = await apiSignedIn(email);
  await api.dispose();
}

// Signs in through the Login screen, exactly as a person would.
export async function login(page: Page, email: string, password = E2E_PASSWORD): Promise<void> {
  await prepareAccount(email);
  await page.goto("/login");
  await page.getByLabel("Email address *").fill(email);
  await page.getByLabel("Password *", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

// Signs in as the seeded Requester at that position and returns their name.
export async function signInAsRequester(page: Page, index = 0): Promise<string> {
  const { name, email } = REQUESTERS[index];
  await login(page, email);
  return name;
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

// Replaces Lab 2's "Change Requester": sign out, then sign in as someone else.
export async function switchRequester(page: Page, index: number): Promise<string> {
  await logout(page);
  return signInAsRequester(page, index);
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

export interface SeedTicketSpec {
  summary: string;
  categoryId: number;
  relatedSystemId: number;
  requestedPriority: "LOW" | "MEDIUM" | "HIGH";
}

// Creates Tickets directly through the API rather than the UI: My Tickets'
// pagination (PAGE_SIZE = 10) and its filter/sort/search evidence need more
// rows than driving the Create Ticket form that many times is worth. `api` is a
// context signed in as the Requester who will own them (see apiSignedIn), because the
// Ticket belongs to the session and no requesterId is sent (BR-11).
export async function seedTickets(api: APIRequestContext, tickets: SeedTicketSpec[]): Promise<void> {
  for (const t of tickets) {
    const response = await api.post("/api/tickets", {
      data: {
        categoryId: t.categoryId,
        relatedSystemId: t.relatedSystemId,
        summary: t.summary,
        description: "Seeded directly via the API for Lab 2 submission-evidence screenshots.",
        requestedPriority: t.requestedPriority,
      },
    });
    if (!response.ok()) {
      throw new Error(`seedTickets: POST /api/tickets failed (${response.status()}): ${await response.text()}`);
    }
  }
}

// The id of a seeded Category by name, so specs do not hard-code seed order.
export async function categoryId(name: string): Promise<number> {
  const api = await pwRequest.newContext({ baseURL: API_URL });
  const categories = (await (await api.get("/api/categories")).json()) as { id: number; name: string }[];
  await api.dispose();
  const found = categories.find((c) => c.name === name);
  if (!found) throw new Error(`no active Category named ${name}`);
  return found.id;
}

// True when the page fits its viewport horizontally (ui-spec.md §10, AC-19).
export async function hasNoHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}
