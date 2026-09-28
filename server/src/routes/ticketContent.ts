import { Router, type Request, type Response } from "express";
import { Prisma, type PrismaClient, type UserRole } from "@prisma/client";
import { getPrisma } from "../prisma.js";
import { sendError } from "../httpErrors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { isValidId } from "../ids.js";
import { validateContentBody } from "../contentValidation.js";
import { TERMINAL_STATUSES } from "../ticketStatus.js";

// Public Comments and Internal Notes (api-spec.md endpoints 11 and 12).
//
// They are two tables, not one table with a visibility flag (spec, design decisions): the notes
// endpoint is the only code that ever reads the note table, and it is closed to a Requester by
// role before anything is looked up, so a Requester-facing query cannot reach a note by
// forgetting a `where` clause.
export const ticketContentRouter = Router();

const anyRole = [requireAuth, requireRole("REQUESTER", "IT_STAFF", "ADMINISTRATOR")];
// BR-35: never a Requester, including on their own Ticket. 403 comes from the role alone.
const staffOnly = [requireAuth, requireRole("IT_STAFF", "ADMINISTRATOR")];

interface ContentRow {
  id: number;
  body: string;
  authorRole: UserRole;
  createdAt: Date;
  author: { name: string };
}

// The one shape for both kinds. The author's email and id are never sent (endpoint 11). The role
// is the one stored on the row when it was written, so a later role change does not relabel it (BR-61).
function serialize(row: ContentRow) {
  return { id: row.id, body: row.body, authorName: row.author.name, authorRole: row.authorRole, createdAt: row.createdAt };
}

const withAuthor = { author: { select: { name: true } } } as const;

// The only thing that differs between a comment and a note is the table.
interface ContentStore {
  list(prisma: PrismaClient, ticketId: number): Promise<ContentRow[]>;
  create(
    prisma: Prisma.TransactionClient | PrismaClient,
    data: { ticketId: number; authorId: number; authorRole: UserRole; body: string },
  ): Promise<ContentRow>;
}

const ordered = [{ createdAt: "asc" }, { id: "asc" }] as const;

const commentStore: ContentStore = {
  list: (prisma, ticketId) => prisma.publicComment.findMany({ where: { ticketId }, include: withAuthor, orderBy: [...ordered] }),
  create: (prisma, data) => prisma.publicComment.create({ data, include: withAuthor }),
};

const noteStore: ContentStore = {
  list: (prisma, ticketId) => prisma.internalNote.findMany({ where: { ticketId }, include: withAuthor, orderBy: [...ordered] }),
  create: (prisma, data) => prisma.internalNote.create({ data, include: withAuthor }),
};

const notFound = (res: Response) => sendError(res, 404, "NOT_FOUND", "Ticket not found.");

// A Ticket id in the path that is not a positive integer names no Ticket: 404, as everywhere.
function ticketIdFrom(req: Request): number | null {
  const id = Number(req.params.id);
  return isValidId(id) ? id : null;
}

// Which Tickets a caller may reach (BR-15, BR-54, BR-60): a Requester their own; IT Staff and
// Administrators any Ticket, including one whose Requester is inactive. A deactivated Requester
// never gets this far: their sessions no longer resolve, so requireAuth has already answered 401 (BR-38).
function reachable(req: Request, ticketId: number): Prisma.TicketWhereInput {
  return req.user!.role === "REQUESTER" ? { id: ticketId, requesterId: req.user!.id } : { id: ticketId };
}

function mount(path: "comments" | "notes", guards: typeof anyRole, store: ContentStore, label: string) {
  ticketContentRouter.get(`/api/tickets/:id/${path}`, ...guards, async (req: Request, res: Response) => {
    try {
      const ticketId = ticketIdFrom(req);
      if (ticketId === null) return notFound(res);
      const prisma = getPrisma();
      if (!(await prisma.ticket.findFirst({ where: reachable(req, ticketId), select: { id: true } }))) return notFound(res);
      res.status(200).json((await store.list(prisma, ticketId)).map(serialize));
    } catch {
      sendError(res, 500, "INTERNAL_ERROR", `Unable to load the ${label}s.`);
    }
  });

  ticketContentRouter.post(`/api/tickets/:id/${path}`, ...guards, async (req: Request, res: Response) => {
    try {
      const ticketId = ticketIdFrom(req);
      if (ticketId === null) return notFound(res);
      // The request is checked before the Ticket, as on endpoint 10, so a caller learns their
      // input is wrong before anything about the Ticket. Author and time are never read from the
      // body: they come from the session and the server clock (BR-32).
      const checked = validateContentBody(req.body?.body);
      if (checked.error) return sendError(res, 400, "VALIDATION_ERROR", checked.error, { body: checked.error });

      const prisma = getPrisma();
      if (!(await prisma.ticket.findFirst({ where: reachable(req, ticketId), select: { id: true } }))) return notFound(res);

      const data = { ticketId, authorId: req.user!.id, authorRole: req.user!.role, body: checked.value! };

      // BR-34: a Requester may not comment on a CLOSED or CANCELLED Ticket. The check and the
      // insert are one transaction holding a share lock on the Ticket row, so a close that lands
      // in between waits for the comment, or the comment waits for it and then sees the new status.
      // Without the lock a comment could be written just after the Ticket was closed.
      if (path === "comments" && req.user!.role === "REQUESTER") {
        const created = await prisma.$transaction(async (tx) => {
          const open = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
            SELECT "id" FROM "Ticket"
            WHERE "id" = ${ticketId} AND "currentStatus"::text NOT IN (${Prisma.join([...TERMINAL_STATUSES])})
            FOR SHARE`);
          return open.length === 0 ? null : store.create(tx, data);
        });
        if (!created) return sendError(res, 409, "TICKET_TERMINAL", "This Ticket is closed, so comments can no longer be added.");
        return res.status(201).json(serialize(created));
      }

      res.status(201).json(serialize(await store.create(prisma, data)));
    } catch {
      sendError(res, 500, "INTERNAL_ERROR", `Unable to add the ${label}.`);
    }
  });
}

// Endpoint 11: a Requester for their own Ticket, IT Staff and Administrators for any Ticket.
mount("comments", anyRole, commentStore, "comment");
// Endpoint 12: IT Staff and Administrators only.
mount("notes", staffOnly, noteStore, "note");
