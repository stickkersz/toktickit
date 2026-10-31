import { beforeAll, describe, expect, it } from "vitest";
import type { TicketPriority, TicketStatus } from "@prisma/client";
import { seedContent } from "../../prisma/seedContent.js";
import { seedActions, seedStatusHistory } from "../../prisma/seedLab4.js";
import { seedTickets } from "../../prisma/seedTickets.js";
import { seedUsers } from "../../prisma/seedUsers.js";
import { signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// PERF-01 and PERF-02 (AC-47, AC-38, BR-28): the two dashboards and the queue on a database holding the
// full seed plus enough Tickets to make about 500, on its own throwaway database. A smoke test, not a
// benchmark: it catches a query that scans or a body that grows with the data, not small regressions.
const iso = useIsolatedDatabase({ referenceData: true });

type Caller = Awaited<ReturnType<typeof signedIn>>;
let staff: Caller, admin: Caller, requester: Caller;
const TARGET = 500;
const CALLS = 20;
const STATUSES: TicketStatus[] = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"];
const PRIORITIES: TicketPriority[] = ["LOW", "MEDIUM", "HIGH"];

beforeAll(async () => {
  const db = iso.db.client;
  await seedUsers(db);
  await seedTickets(db);
  await seedContent(db);
  await seedStatusHistory(db);
  await seedActions(db);
  const user = (email: string) => db.user.findUniqueOrThrow({ where: { email } });
  const pim = await user("pimchanok.somboon@toktickit.test");
  const kanokwan = await user("kanokwan.srisuwan@toktickit.test");
  const requesters = await db.user.findMany({ where: { role: "REQUESTER", isActive: true } });
  const have = await db.ticket.count();
  // Spread over every status, priority and Requester, a third owned by the staff member, a spread of last
  // activity over 60 days, so every figure and window has rows to count.
  await db.ticket.createMany({
    data: Array.from({ length: TARGET - have }, (_, i) => ({
      ticketNumber: `TKT-2026-7${String(i).padStart(5, "0")}`,
      requesterId: i % 4 === 0 ? kanokwan.id : requesters[i % requesters.length].id,
      categoryId: 1,
      relatedSystemId: 1,
      summary: `Performance fixture ${i}`,
      description: "A fixture for the dashboard and queue performance smoke test.",
      requestedPriority: PRIORITIES[i % 3],
      itPriority: PRIORITIES[(i + 1) % 3],
      currentStatus: STATUSES[i % STATUSES.length],
      ownerId: i % 3 === 0 ? pim.id : null,
      createdAt: new Date(Date.now() - (i % 60) * 86_400_000 - 3_600_000),
      updatedAt: new Date(Date.now() - (i % 60) * 86_400_000),
    })),
  });
  staff = await signedIn(pim);
  admin = await signedIn(await user("aekkarat.wongsa@toktickit.test"));
  requester = await signedIn(kanokwan);
  await db.user.updateMany({ data: { mustChangePassword: false } });
}, 120_000);

async function timed(caller: Caller, path: string) {
  // One warm-up call, so the first query plan and connection are not counted.
  await caller.get(path);
  const ms: number[] = [];
  let size = 0;
  for (let i = 0; i < CALLS; i++) {
    const start = performance.now();
    const res = await caller.get(path);
    ms.push(performance.now() - start);
    expect(res.status, path).toBe(200);
    size = Buffer.byteLength(res.text);
  }
  ms.sort((a, b) => a - b);
  return { median: (ms[CALLS / 2 - 1] + ms[CALLS / 2]) / 2, max: ms[CALLS - 1], size };
}

describe("performance smoke with about 500 Tickets", () => {
  it("holds about 500 Tickets", async () => {
    expect(await iso.db.client.ticket.count()).toBe(TARGET);
  });

  // PERF-01 / AC-47 and PERF-02 / AC-38, BR-28
  it.each([
    ["staff dashboard (IT Staff)", () => staff, "/api/dashboard/staff", true],
    ["staff dashboard (Administrator)", () => admin, "/api/dashboard/staff", true],
    ["Requester dashboard", () => requester, "/api/dashboard/requester", true],
    ["Ticket Queue, first page", () => staff, "/api/staff/tickets?sort=-updatedAt", false],
    ["Ticket Queue, needs-owner and active", () => staff, "/api/staff/tickets?owner=needs-owner&statusGroup=active", false],
  ] as const)("answers the %s with a median under 300 ms, none over 1 second", async (name, caller, path, dashboard) => {
    const { median, max, size } = await timed(caller(), path);
    console.info(`PERF ${name}: median ${median.toFixed(1)} ms, max ${max.toFixed(1)} ms, ${size} bytes`);
    expect(median, `${name} median`).toBeLessThan(300);
    expect(max, `${name} max`).toBeLessThan(1000);
    // PERF-02: a dashboard body stays small whatever the data, because it carries counts and at most 5 items.
    if (dashboard) expect(size, `${name} body`).toBeLessThan(10 * 1024);
  });
});
