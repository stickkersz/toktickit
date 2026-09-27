import { randomUUID } from "node:crypto";
import { APIRequestContext, expect, Page } from "@playwright/test";
import { apiSignedIn, E2E_PASSWORD, prepareAccount, REQUESTERS, SEED_INITIAL_PASSWORD } from "../lab-02/helpers.js";

export { apiSignedIn, E2E_PASSWORD, hasNoHorizontalScroll, REQUESTERS, SEED_INITIAL_PASSWORD, VIEWPORTS } from "../lab-02/helpers.js";

// Lab 3 specs use seeded Requester 1 so they stay apart from the Lab 2 specs' own
// assertions, which lean on Requesters 0, 2 and 3.
export const REQUESTER = REQUESTERS[1];
export const STAFF = { name: "Pimchanok Somboon", email: "pimchanok.somboon@toktickit.test" };
export const OTHER_STAFF = { name: "Wichai Charoen", email: "wichai.charoen@toktickit.test" };
export const ADMIN = { name: "Aekkarat Wongsa", email: "aekkarat.wongsa@toktickit.test" };
// Seeded inactive and never signed in, so it still holds the seed's initial password.
export const INACTIVE_REQUESTER = { name: "Somsak Rattanakosin", email: "somsak.rattanakosin@toktickit.test" };

// What a user created by these specs is given as an initial password.
export const INITIAL_PASSWORD = "Init!Pass8";

export const LANDING = { REQUESTER: /\/tickets$/, IT_STAFF: /\/staff\/tickets$/, ADMINISTRATOR: /\/admin\/users$/ } as const;

const SHOTS = "artifacts/lab-03/screenshots";
export const shot = (group: string, name: string) => `${SHOTS}/${group}/${name}.png`;

export const short = () => randomUUID().slice(0, 8);

// Types into the Login screen exactly as a person would.
export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address *").fill(email);
  await page.getByLabel("Password *", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

// Signs a seeded account in through the Login screen and waits for its role's landing screen.
export async function signIn(page: Page, email: string, landing: RegExp): Promise<void> {
  await prepareAccount(email);
  await fillLogin(page, email, E2E_PASSWORD);
  await expect(page).toHaveURL(landing);
}

export async function logout(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

export interface CreatedUser {
  id: number;
  name: string;
  email: string;
}

// A brand new account created by the Administrator through the API, holding
// INITIAL_PASSWORD. Each run makes its own, so no spec depends on an earlier run's accounts.
export async function createUserAsAdmin(role: "REQUESTER" | "IT_STAFF", label: string): Promise<CreatedUser> {
  const admin = await apiSignedIn(ADMIN.email);
  const id = short();
  const res = await admin.post("/api/admin/users", {
    data: { name: `E2E ${label} ${id}`, email: `e2e-${label}-${id}@toktickit.test`, role, initialPassword: INITIAL_PASSWORD },
  });
  const body = await res.json();
  await admin.dispose();
  if (res.status() !== 201) throw new Error(`createUserAsAdmin: ${res.status()} ${JSON.stringify(body)}`);
  return { id: body.id, name: body.name, email: body.email };
}

export interface CreatedTicket {
  id: number;
  ticketNumber: string;
  summary: string;
}

// The Category and Related System every Lab 3 Ticket is filed under, found by name so the
// specs never depend on the ids a particular database happened to assign.
export const TICKET_CATEGORY = "Account and Access";
export const TICKET_RELATED_SYSTEM = "Staff VPN";

// The id of the active entry with this name in a public reference list.
export async function referenceId(api: APIRequestContext, list: "/api/categories" | "/api/related-systems", name: string): Promise<number> {
  const res = await api.get(list);
  if (!res.ok()) throw new Error(`referenceId: GET ${list} failed (${res.status()})`);
  const entries = (await res.json()) as { id: number; name: string }[];
  const found = entries.find((entry) => entry.name === name);
  if (!found) throw new Error(`referenceId: no active entry named "${name}" in ${list} (found: ${entries.map((e) => e.name).join(", ")})`);
  return found.id;
}

// A Ticket owned by the Lab 3 Requester, created through the API.
export async function createTicketAsRequester(summary: string): Promise<CreatedTicket> {
  const api = await apiSignedIn(REQUESTER.email);
  const res = await api.post("/api/tickets", {
    data: {
      categoryId: await referenceId(api, "/api/categories", TICKET_CATEGORY),
      relatedSystemId: await referenceId(api, "/api/related-systems", TICKET_RELATED_SYSTEM),
      summary,
      description: "Created by the Lab 3 Playwright suite to drive the staff workflow.",
      requestedPriority: "MEDIUM",
    },
  });
  const body = await res.json();
  await api.dispose();
  if (res.status() !== 201) throw new Error(`createTicketAsRequester: ${res.status()} ${JSON.stringify(body)}`);
  return { id: body.id, ticketNumber: body.ticketNumber, summary };
}

// Runs one staff API call as the Administrator and fails loudly if it is refused.
export async function asAdmin(work: (api: APIRequestContext) => Promise<{ ok(): boolean; status(): number; text(): Promise<string> }>) {
  const api = await apiSignedIn(ADMIN.email);
  const res = await work(api);
  const failure = res.ok() ? null : `${res.status()} ${await res.text()}`;
  await api.dispose();
  if (failure) throw new Error(`admin API call refused: ${failure}`);
}

// The role navigation items, in order, as rendered in the header.
export async function navItems(page: Page): Promise<string[]> {
  return page.locator("#main-nav .navbar-nav a").allTextContents();
}
