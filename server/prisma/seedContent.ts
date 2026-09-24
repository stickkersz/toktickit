import type { PrismaClient } from "@prisma/client";

interface SeedEntry {
  ticket: string; // ticket number
  author: string; // email
  kind: "comment" | "note";
  // When it was written, as minutes after the Ticket was created. Fixed per entry, so a row's
  // identity (Ticket, author, time) is the same on every run.
  minutesAfter: number;
  body: string;
}

// BR-50: example Public Comments and Internal Notes on the seeded Tickets, containing nothing
// sensitive: no personal data, no credentials, no real addresses. They follow the rules the
// application enforces (BR-32 to BR-36, BR-61): a Requester only ever writes on their own Ticket,
// never after it is closed or cancelled, notes are written by staff, and each body is 2 to 2000
// characters. Some Tickets have none, so the empty states have real rows too. Two are written by the
// inactive IT Staff account, as the owner they used to be.
const STAFF1 = "pimchanok.somboon@toktickit.test";
const STAFF2 = "wichai.charoen@toktickit.test";
const STAFF3 = "anucha.prasert@toktickit.test";
const FORMER = "sunisa.kaewmanee@toktickit.test"; // inactive
const ADMIN = "aekkarat.wongsa@toktickit.test";
const KANOKWAN = "kanokwan.srisuwan@toktickit.test";
const THANAPON = "thanapon.wattana@toktickit.test";
const NUTCHANON = "nutchanon.boonmee@toktickit.test";

const ENTRIES: SeedEntry[] = [
  { ticket: "TKT-2026-900001", author: KANOKWAN, kind: "comment", minutesAfter: 30, body: "It also fails on mobile data, so I do not think it is my home network." },

  { ticket: "TKT-2026-900002", author: STAFF1, kind: "comment", minutesAfter: 60, body: "Thanks for the report. We will check the card reader on the ground floor kiosk today." },
  { ticket: "TKT-2026-900002", author: STAFF1, kind: "note", minutesAfter: 75, body: "Firmware is current. Suspect the USB cable to the reader, will swap it during the round." },

  { ticket: "TKT-2026-900003", author: STAFF2, kind: "comment", minutesAfter: 45, body: "I can reproduce the error with a PDF over 10 MB. Looking at the upload limit." },
  { ticket: "TKT-2026-900003", author: NUTCHANON, kind: "comment", minutesAfter: 120, body: "Thank you. Smaller files upload fine for me, in case that helps." },
  { ticket: "TKT-2026-900003", author: STAFF2, kind: "note", minutesAfter: 150, body: "The proxy limit is 10 MB but the app allows 20 MB. Raise both together and retest." },

  { ticket: "TKT-2026-900004", author: STAFF3, kind: "comment", minutesAfter: 40, body: "Your account is unlocked. Please try signing in again and tell us if the lock returns." },
  { ticket: "TKT-2026-900004", author: STAFF3, kind: "note", minutesAfter: 50, body: "The lock came from the automatic three-attempts rule. Nothing unusual in the log." },

  { ticket: "TKT-2026-900005", author: STAFF1, kind: "comment", minutesAfter: 90, body: "We replaced the access point on the second floor. Please tell us if the drops come back." },
  { ticket: "TKT-2026-900005", author: STAFF1, kind: "note", minutesAfter: 100, body: "The old access point had a failing power supply. Sent for disposal." },
  { ticket: "TKT-2026-900005", author: KANOKWAN, kind: "comment", minutesAfter: 600, body: "It has been stable since yesterday, thank you." },

  { ticket: "TKT-2026-900006", author: STAFF2, kind: "comment", minutesAfter: 60, body: "The keyboard has been replaced with a spare and every key tested." },
  { ticket: "TKT-2026-900006", author: STAFF2, kind: "note", minutesAfter: 70, body: "Faulty keyboard logged for the hardware return batch." },

  { ticket: "TKT-2026-900007", author: NUTCHANON, kind: "comment", minutesAfter: 200, body: "The freeze is back after the last change. It happens on every submit." },
  { ticket: "TKT-2026-900007", author: ADMIN, kind: "comment", minutesAfter: 260, body: "Thanks for letting us know. I am looking at it again." },
  { ticket: "TKT-2026-900007", author: ADMIN, kind: "note", minutesAfter: 270, body: "Second occurrence. Check the registration service logs around the submit time." },

  { ticket: "TKT-2026-900008", author: STAFF1, kind: "comment", minutesAfter: 10, body: "Cancelled as a duplicate at your request. The first request stays open." },

  { ticket: "TKT-2026-900009", author: FORMER, kind: "comment", minutesAfter: 30, body: "We have started looking at the battery report from your laptop." },
  { ticket: "TKT-2026-900009", author: STAFF1, kind: "note", minutesAfter: 900, body: "The previous owner is no longer active, so this Ticket needs a new owner." },

  { ticket: "TKT-2026-900010", author: FORMER, kind: "note", minutesAfter: 60, body: "Power is back but the annex switch did not come up. Needs an on-site check." },
  { ticket: "TKT-2026-900010", author: THANAPON, kind: "comment", minutesAfter: 90, body: "Some rooms in the annex have network again but not all of them." },

  { ticket: "TKT-2026-900013", author: STAFF1, kind: "comment", minutesAfter: 50, body: "Glad it is working. We will leave this open a little longer to be sure." },
  { ticket: "TKT-2026-900013", author: STAFF1, kind: "note", minutesAfter: 55, body: "The Requester says it works again. Close after one more day without drops." },

  { ticket: "TKT-2026-900014", author: FORMER, kind: "comment", minutesAfter: 80, body: "The search index has been rebuilt and known titles are found again." },
];

export const SEED_CONTENT_COUNT = ENTRIES.length;

// Held for the whole run, so two seeds started together cannot both find a row missing and both add it.
const SEED_CONTENT_LOCK = 4_270_701;

// Idempotent. A row's identity is its Ticket, author and time, all fixed above, not its body, so a
// row that already exists is left exactly as it is: never duplicated, never rewritten, and a body
// edited afterwards is not restored. Comments and notes added through the application are never touched.
// The Tickets and users it points at must already be seeded.
export async function seedContent(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_CONTENT_LOCK})`;

    const users = new Map((await tx.user.findMany({ select: { id: true, email: true, role: true } })).map((u) => [u.email, u]));
    const tickets = new Map(
      (await tx.ticket.findMany({ where: { ticketNumber: { in: [...new Set(ENTRIES.map((e) => e.ticket))] } }, select: { id: true, ticketNumber: true, createdAt: true } })).map((t) => [t.ticketNumber, t]),
    );

    for (const entry of ENTRIES) {
      const ticket = tickets.get(entry.ticket);
      const author = users.get(entry.author);
      if (!ticket) throw new Error(`seedContent: no Ticket "${entry.ticket}", seed the Tickets first`);
      if (!author) throw new Error(`seedContent: no user "${entry.author}", seed the users first`);

      const createdAt = new Date(ticket.createdAt.getTime() + entry.minutesAfter * 60_000);
      const identity = { ticketId: ticket.id, authorId: author.id, createdAt };
      const data = { ...identity, authorRole: author.role, body: entry.body };

      if (entry.kind === "comment") {
        if (!(await tx.publicComment.findFirst({ where: identity, select: { id: true } }))) await tx.publicComment.create({ data });
      } else if (!(await tx.internalNote.findFirst({ where: identity, select: { id: true } }))) {
        await tx.internalNote.create({ data });
      }
    }
  });
}
