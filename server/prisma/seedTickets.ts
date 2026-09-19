import type { PrismaClient, TicketPriority, TicketStatus } from "@prisma/client";

interface SeedTicket {
  ticketNumber: string;
  requester: string; // email
  category: string; // name
  relatedSystem: string; // name
  summary: string;
  description: string;
  requestedPriority: TicketPriority;
  itPriority: TicketPriority;
  status: TicketStatus;
  owner: string | null; // email
  resolutionSummary?: string;
  requesterResolutionFlagged?: boolean;
}

// BR-50: Tickets spread across Requesters, statuses, priorities, and both assigned and
// unassigned ownership. Two are deliberately owned by the inactive IT Staff account, and
// one Requester is inactive, so the queue's "Needs new owner" and "(inactive)" markers
// (BR-57, BR-59) have real rows to show. Nothing here is sensitive.
//
// Fixed ticket numbers in the 9xxxxx range keep the seed idempotent (upsert on the
// unique number) and clear of the generated sequence, which starts at 000001.
const TICKETS: SeedTicket[] = [
  { ticketNumber: "TKT-2026-900001", requester: "kanokwan.srisuwan@toktickit.test", category: "Network", relatedSystem: "Staff VPN", summary: "Cannot connect to the VPN from home", description: "The VPN client fails at the login step with a timeout every time since Monday morning.", requestedPriority: "HIGH", itPriority: "HIGH", status: "NEW", owner: null },
  { ticketNumber: "TKT-2026-900002", requester: "thanapon.wattana@toktickit.test", category: "Hardware", relatedSystem: "Cafeteria Payment Kiosk", summary: "Kiosk card reader does not respond", description: "The card reader on the ground floor kiosk shows a blank screen and ignores every card.", requestedPriority: "MEDIUM", itPriority: "MEDIUM", status: "OPEN", owner: "pimchanok.somboon@toktickit.test" },
  { ticketNumber: "TKT-2026-900003", requester: "nutchanon.boonmee@toktickit.test", category: "Software", relatedSystem: "E-Learning Platform", summary: "Course page shows an error after upload", description: "Uploading a PDF to my course page ends with an error banner, and the file never appears.", requestedPriority: "LOW", itPriority: "LOW", status: "IN_PROGRESS", owner: "wichai.charoen@toktickit.test" },
  { ticketNumber: "TKT-2026-900004", requester: "ploypailin.chaisiri@toktickit.test", category: "Account and Access", relatedSystem: "Student Portal", summary: "Locked out of the student portal", description: "After three wrong attempts the portal says my account is locked and I cannot reset it.", requestedPriority: "HIGH", itPriority: "MEDIUM", status: "WAITING_FOR_REQUESTER", owner: "anucha.prasert@toktickit.test" },
  { ticketNumber: "TKT-2026-900005", requester: "kanokwan.srisuwan@toktickit.test", category: "Network", relatedSystem: "Dormitory Wi-Fi", summary: "Wi-Fi drops every few minutes in dorm B", description: "The connection in dorm B room 214 drops every few minutes and reconnects slowly.", requestedPriority: "MEDIUM", itPriority: "HIGH", status: "RESOLVED", owner: "pimchanok.somboon@toktickit.test", resolutionSummary: "Replaced the faulty access point on the second floor and confirmed a stable connection." },
  { ticketNumber: "TKT-2026-900006", requester: "thanapon.wattana@toktickit.test", category: "Hardware", relatedSystem: "Library Catalog System", summary: "Library terminal keyboard has stuck keys", description: "Several keys on the second floor catalog terminal keyboard stick and repeat characters.", requestedPriority: "LOW", itPriority: "LOW", status: "CLOSED", owner: "wichai.charoen@toktickit.test", resolutionSummary: "Swapped the keyboard for a spare one and tested every key." },
  { ticketNumber: "TKT-2026-900007", requester: "nutchanon.boonmee@toktickit.test", category: "Software", relatedSystem: "Course Registration System", summary: "Registration page freezes on submit", description: "The registration page freezes for a minute after I press submit and then shows nothing.", requestedPriority: "MEDIUM", itPriority: "MEDIUM", status: "REOPENED", owner: "aekkarat.wongsa@toktickit.test" },
  { ticketNumber: "TKT-2026-900008", requester: "ploypailin.chaisiri@toktickit.test", category: "Account and Access", relatedSystem: "Student Portal", summary: "Request submitted twice by mistake", description: "I submitted the same access request twice by accident and would like one of them cancelled.", requestedPriority: "LOW", itPriority: "LOW", status: "CANCELLED", owner: null },
  { ticketNumber: "TKT-2026-900009", requester: "kanokwan.srisuwan@toktickit.test", category: "Hardware", relatedSystem: "Staff VPN", summary: "Laptop battery drains within an hour", description: "The laptop battery falls from full to empty in under an hour even with the screen dimmed.", requestedPriority: "HIGH", itPriority: "HIGH", status: "OPEN", owner: "sunisa.kaewmanee@toktickit.test" },
  { ticketNumber: "TKT-2026-900010", requester: "thanapon.wattana@toktickit.test", category: "Network", relatedSystem: "Dormitory Wi-Fi", summary: "No network in the lab annex", description: "The lab annex has had no wired or wireless network since the power cut last night.", requestedPriority: "MEDIUM", itPriority: "MEDIUM", status: "IN_PROGRESS", owner: "sunisa.kaewmanee@toktickit.test" },
  { ticketNumber: "TKT-2026-900011", requester: "somsak.rattanakosin@toktickit.test", category: "Software", relatedSystem: "E-Learning Platform", summary: "Cannot open the grades export", description: "The grades export downloads as an empty file no matter which browser I use.", requestedPriority: "LOW", itPriority: "LOW", status: "NEW", owner: null },
  { ticketNumber: "TKT-2026-900012", requester: "nutchanon.boonmee@toktickit.test", category: "Account and Access", relatedSystem: "Student Portal", summary: "Need access to the shared course folder", description: "I was added to the course team but the shared folder still says I do not have permission.", requestedPriority: "HIGH", itPriority: "HIGH", status: "NEW", owner: null },
  { ticketNumber: "TKT-2026-900013", requester: "ploypailin.chaisiri@toktickit.test", category: "Network", relatedSystem: "Staff VPN", summary: "VPN works again, was it fixed?", description: "The VPN connected on its own this morning, so I think the problem may be resolved now.", requestedPriority: "LOW", itPriority: "MEDIUM", status: "OPEN", owner: "pimchanok.somboon@toktickit.test", requesterResolutionFlagged: true },
  { ticketNumber: "TKT-2026-900014", requester: "kanokwan.srisuwan@toktickit.test", category: "Software", relatedSystem: "Library Catalog System", summary: "Catalog search returns no results", description: "Every search in the catalog returns no results even for titles I know the library holds.", requestedPriority: "MEDIUM", itPriority: "MEDIUM", status: "CLOSED", owner: "sunisa.kaewmanee@toktickit.test", resolutionSummary: "Rebuilt the search index and confirmed known titles are found again." },
];

export const SEED_TICKET_NUMBERS = TICKETS.map((t) => t.ticketNumber);

// Idempotent, upserting on the ticket number and leaving an existing row exactly as it is,
// so re-seeding never undoes work done through the application. The users and reference
// data it points at must already be seeded.
export async function seedTickets(prisma: PrismaClient): Promise<void> {
  const users = new Map((await prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]));
  const categories = new Map((await prisma.category.findMany({ select: { id: true, name: true } })).map((c) => [c.name, c.id]));
  const systems = new Map((await prisma.relatedSystem.findMany({ select: { id: true, name: true } })).map((s) => [s.name, s.id]));
  const need = (map: Map<string, number>, key: string, what: string): number => {
    const id = map.get(key);
    if (id === undefined) throw new Error(`seedTickets: no ${what} "${key}", seed the users and reference data first`);
    return id;
  };

  const now = Date.now();
  for (const [index, t] of TICKETS.entries()) {
    // Spread over the last two weeks so the default newest-first order is stable.
    const createdAt = new Date(now - (index + 1) * 20 * 60 * 60 * 1000);
    await prisma.ticket.upsert({
      where: { ticketNumber: t.ticketNumber },
      update: {},
      create: {
        ticketNumber: t.ticketNumber,
        requesterId: need(users, t.requester, "requester"),
        categoryId: need(categories, t.category, "category"),
        relatedSystemId: need(systems, t.relatedSystem, "related system"),
        summary: t.summary,
        description: t.description,
        requestedPriority: t.requestedPriority,
        itPriority: t.itPriority,
        currentStatus: t.status,
        ownerId: t.owner ? need(users, t.owner, "owner") : null,
        resolutionSummary: t.resolutionSummary ?? null,
        requesterResolutionFlaggedAt: t.requesterResolutionFlagged ? new Date(now - 2 * 60 * 60 * 1000) : null,
        createdAt,
      },
    });
  }
}
