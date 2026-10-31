import type { Page } from "@playwright/test";
import { expect, test } from "./console.js";
import { ADMIN, apiSignedIn, hasNoHorizontalScroll, LANDING, logout, REQUESTERS, signIn, STAFF, VIEWPORTS } from "../lab-03/helpers.js";

// E2E-05, E2E-06, E2E-07 and RESP-01 from docs/lab-04/tests.md: both dashboards against the seeded
// database, each figure followed to the list it opens.

const shot = (group: "staff-dashboard" | "requester-dashboard", name: string) => `artifacts/lab-04/screenshots/${group}/${name}.png`;
const SIZES = [
  ["desktop", VIEWPORTS.desktop],
  ["tablet", VIEWPORTS.tablet],
  ["mobile", VIEWPORTS.mobile],
] as const;

// The total a list reports once it has loaded: "Showing 1 to 10 of 23 tickets" on the queue, "Showing
// 1–10 of 23" on My Tickets, or its no-match sentence for 0.
async function listTotal(page: Page): Promise<number> {
  const showing = page.getByText(/^Showing \d+\D+\d+ of \d+/);
  const none = page.getByText(/^No tickets match/);
  await expect(showing.or(none).first()).toBeVisible();
  if (await none.first().isVisible()) return 0;
  return Number((await showing.first().textContent())!.match(/of (\d+)/)![1]);
}

// A metric card's count, read from its accessible name ("Unassigned: 4 tickets. View in ...").
const cardCount = async (page: Page, label: string) => {
  const name = await page.getByRole("link", { name: new RegExp(`^${label}: \\d+ tickets?\\. View in`) }).getAttribute("aria-label");
  return Number(name!.match(/: (\d+) ticket/)![1]);
};

test.describe("Dashboards", () => {
  // E2E-07 (AC-36): each role lands on its Dashboard with Dashboard marked as the current page.
  test("signs each role in to its own Dashboard with Dashboard marked current", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    for (const [email, landing, subheading] of [
      [REQUESTERS[1].email, LANDING.REQUESTER, "Your tickets at a glance"],
      [STAFF.email, LANDING.IT_STAFF, "Your work and the queue at a glance"],
      [ADMIN.email, LANDING.ADMINISTRATOR, "Your work and the queue at a glance"],
    ] as const) {
      await signIn(page, email, landing);
      await expect(page.getByText(subheading)).toBeVisible();
      await expect(page.locator('#main-nav a[aria-current="page"]'), email).toHaveText("Dashboard");
      await logout(page);
    }
  });

  // E2E-05 (AC-31) and RESP-01 for the IT Staff Dashboard.
  test("IT Staff open every dashboard card and the queue shows the same count", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await expect(page.getByRole("link", { name: /^Unassigned: / })).toBeVisible();

    for (const [name, size] of SIZES) {
      await page.setViewportSize(size);
      await expect(page.getByRole("link", { name: /^Unassigned: / })).toBeVisible();
      expect(await hasNoHorizontalScroll(page), name).toBe(true);
      await page.screenshot({ path: shot("staff-dashboard", `loaded-${name}`), fullPage: true });
    }
    await page.setViewportSize(VIEWPORTS.desktop);

    const cards = page.locator(".zg-metric-grid a, .zg-status-chip");
    const count = await cards.count();
    expect(count).toBe(3 + 8);
    for (let i = 0; i < count; i++) {
      const card = page.locator(".zg-metric-grid a, .zg-status-chip").nth(i);
      const label = (await card.getAttribute("aria-label"))!;
      const figure = Number(label.match(/: (\d+) ticket/)![1]);
      const href = (await card.getAttribute("href"))!;
      await card.click();
      await expect(page).toHaveURL(new RegExp(`${href.replace(/[?]/g, "\\?")}$`));
      expect(await listTotal(page), label).toBe(figure);
      await page.goBack();
      await expect(page.getByRole("link", { name: /^Unassigned: / })).toBeVisible();
    }

    // A11Y-04's rule for the new links: a card, a status chip and a list row show the solid Zen Green
    // outline on keyboard focus, never only a faint halo.
    for (const control of [page.locator(".zg-metric-card").first(), page.locator(".zg-status-chip").first(), page.locator(".zg-dashboard-row").first()]) {
      await page.keyboard.press("Shift");
      await control.focus();
      const ring = await control.evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.outlineStyle, color: s.outlineColor, width: parseFloat(s.outlineWidth) };
      });
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);
      expect(ring.color).toBe("rgb(11, 122, 70)");
    }
  });

  // E2E-06 (AC-32, AC-34) and RESP-01 for the Requester Dashboard.
  test("two Requesters each see only their own figures, and My Tickets matches each card", async ({ page }) => {
    for (const requester of [REQUESTERS[1], REQUESTERS[2]]) {
      await page.setViewportSize(VIEWPORTS.desktop);
      await signIn(page, requester.email, LANDING.REQUESTER);
      await expect(page.getByRole("link", { name: /^Open: / })).toBeVisible();

      // The figures on screen are this Requester's own, as the server counts them for that session.
      const api = await apiSignedIn(requester.email);
      const own = (await (await api.get("/api/dashboard/requester")).json()).metrics;
      await api.dispose();
      expect(await cardCount(page, "Open")).toBe(own.open.count);
      expect(await cardCount(page, "Waiting for you")).toBe(own.waitingForYou.count);
      expect(await cardCount(page, "Recently updated")).toBe(own.recentlyUpdated.count);
      expect(await cardCount(page, "Recently resolved")).toBe(own.recentlyResolved.count);

      if (requester === REQUESTERS[1]) {
        for (const [name, size] of SIZES) {
          await page.setViewportSize(size);
          await expect(page.getByRole("link", { name: /^Open: / })).toBeVisible();
          expect(await hasNoHorizontalScroll(page), name).toBe(true);
          await page.screenshot({ path: shot("requester-dashboard", `loaded-${name}`), fullPage: true });
        }
        await page.setViewportSize(VIEWPORTS.desktop);
      }

      for (const label of ["Open", "Waiting for you", "Recently updated", "Recently resolved"]) {
        const figure = await cardCount(page, label);
        await page.getByRole("link", { name: new RegExp(`^${label}: `) }).click();
        await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
        expect(await listTotal(page), `${requester.email} ${label}`).toBe(figure);
        await page.goBack();
        await expect(page.getByRole("link", { name: /^Open: / })).toBeVisible();
      }
      await logout(page);
    }
  });

  // RESP-01 and ui-spec section 15: the remaining states. Empty, loading and failure answer the dashboard
  // request in the browser, since the seeded database always has Tickets; the screens are the real ones.
  test("captures the empty, loading, failure, forbidden, Administrator and drill-down states", async ({ page, consoleMessages }) => {
    const zeroStaff = {
      generatedAt: new Date().toISOString(),
      timeZone: "Asia/Bangkok",
      metrics: {
        unassigned: { count: 0, link: "/staff/tickets?owner=needs-owner" },
        myTickets: { count: 0, link: "/staff/tickets?owner=me&statusGroup=active" },
        urgent: { count: 0, link: "/staff/tickets?itPriority=HIGH&statusGroup=active" },
        byStatus: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"].map((status) => ({ status, count: 0, link: `/staff/tickets?status=${status}` })),
      },
      myPlannedActions: { count: 0, items: [] },
      recentlyUpdated: [],
    };
    const zeroRequester = {
      generatedAt: new Date().toISOString(),
      timeZone: "Asia/Bangkok",
      metrics: {
        open: { count: 0, link: "/tickets?statusGroup=active" },
        waitingForYou: { count: 0, link: "/tickets?status=WAITING_FOR_REQUESTER" },
        recentlyUpdated: { count: 0, windowDays: 7, link: "/tickets?updatedWithinDays=7&sort=-updatedAt" },
        recentlyResolved: { count: 0, windowDays: 30, link: "/tickets?resolvedWithinDays=30&sort=-updatedAt" },
      },
      recentlyUpdated: [],
      recentlyResolved: [],
    };
    await page.setViewportSize(VIEWPORTS.desktop);

    // IT Staff: empty, loading, failure, then the queue drill-down at three sizes.
    await signIn(page, STAFF.email, LANDING.IT_STAFF);
    await page.route("**/api/dashboard/staff", (route) => route.fulfill({ json: zeroStaff }));
    await page.reload();
    await expect(page.getByText("No tickets need an owner")).toBeVisible();
    await page.screenshot({ path: shot("staff-dashboard", "empty-desktop"), fullPage: true });
    await page.unroute("**/api/dashboard/staff");
    await page.route("**/api/dashboard/staff", () => {});
    await page.reload();
    await expect(page.getByRole("status", { name: "Loading the dashboard" })).toBeVisible();
    await page.screenshot({ path: shot("staff-dashboard", "loading-desktop"), fullPage: true });
    await page.unroute("**/api/dashboard/staff");
    await page.route("**/api/dashboard/staff", (route) => route.fulfill({ status: 500, json: { error: "INTERNAL_ERROR", message: "Unable to load the dashboard." } }));
    await page.reload();
    await expect(page.getByText("The dashboard could not be loaded.")).toBeVisible();
    await page.screenshot({ path: shot("staff-dashboard", "failure-desktop"), fullPage: true });
    await page.unroute("**/api/dashboard/staff");
    for (const [name, size] of SIZES) {
      await page.setViewportSize(size);
      await page.goto("/staff/dashboard");
      await page.getByRole("link", { name: /^Urgent: / }).click();
      await expect(page.getByText("Active tickets only")).toBeVisible();
      expect(await hasNoHorizontalScroll(page), name).toBe(true);
      await page.screenshot({ path: shot("staff-dashboard", `drill-down-queue-${name}`), fullPage: true });
    }
    await page.setViewportSize(VIEWPORTS.desktop);
    // IT Staff on the Requester dashboard: the forbidden state.
    await page.goto("/dashboard");
    await expect(page.getByText("You do not have access to this dashboard.")).toBeVisible();
    await page.screenshot({ path: shot("requester-dashboard", "forbidden-desktop"), fullPage: true });
    await logout(page);

    // The Administrator's dashboard with the Accounts card.
    await signIn(page, ADMIN.email, LANDING.ADMINISTRATOR);
    await expect(page.getByRole("link", { name: /^Accounts: / })).toBeVisible();
    await page.screenshot({ path: shot("staff-dashboard", "administrator-desktop"), fullPage: true });
    await logout(page);

    // Requester: empty, failure, forbidden, then the My Tickets drill-down at three sizes.
    await signIn(page, REQUESTERS[1].email, LANDING.REQUESTER);
    await page.route("**/api/dashboard/requester", (route) => route.fulfill({ json: zeroRequester }));
    await page.reload();
    await expect(page.getByText("Nothing is waiting for you.")).toBeVisible();
    await page.screenshot({ path: shot("requester-dashboard", "empty-desktop"), fullPage: true });
    await page.unroute("**/api/dashboard/requester");
    await page.route("**/api/dashboard/requester", (route) => route.fulfill({ status: 500, json: { error: "INTERNAL_ERROR", message: "Unable to load the dashboard." } }));
    await page.reload();
    await expect(page.getByText("The dashboard could not be loaded.")).toBeVisible();
    await page.screenshot({ path: shot("requester-dashboard", "failure-desktop"), fullPage: true });
    await page.unroute("**/api/dashboard/requester");
    await page.goto("/staff/dashboard");
    await expect(page.getByText("You do not have access to this dashboard.")).toBeVisible();
    await page.screenshot({ path: shot("staff-dashboard", "forbidden-desktop"), fullPage: true });
    for (const [name, size] of SIZES) {
      await page.setViewportSize(size);
      await page.goto("/dashboard");
      await page.getByRole("link", { name: /^Recently updated: / }).click();
      await expect(page.getByText("Updated in the last 7 days").first()).toBeVisible();
      expect(await hasNoHorizontalScroll(page), name).toBe(true);
      await page.screenshot({ path: shot("requester-dashboard", `drill-down-my-tickets-${name}`), fullPage: true });
    }
    // E2E-09: the 500s this test answered on purpose (one per request; the development server's StrictMode
    // loads twice) are the browser reporting them, not a fault. Drop exactly those and keep everything else
    // for the check at the end of the test.
    const provoked = /status of 500 .*\/api\/dashboard\/(staff|requester)\)$/;
    expect(consoleMessages.filter((m) => provoked.test(m)).length).toBeGreaterThan(0);
    consoleMessages.splice(0, consoleMessages.length, ...consoleMessages.filter((m) => !provoked.test(m)));
  });
});
