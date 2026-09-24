import { Router, type Request, type Response } from "express";
import { Prisma, type UserRole } from "@prisma/client";
import { getPrisma } from "../prisma.js";
import { sendError } from "../httpErrors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { hashPassword } from "../auth/password.js";
import { isValidId } from "../ids.js";
import { escapeLike } from "../searchText.js";
import { validateEmail, validateInitialPassword, validateIsActive, validateName, validateRole } from "../userValidation.js";

// Administrator user management (api-spec.md endpoints 13 to 16, FR-16 to FR-20).
//
// Only an Administrator gets past the guard, and the role alone decides it, before an id or a body is
// looked at (BR-37). No endpoint returns a password hash (BR-03) or accepts a delete (BR-44).
export const adminUsersRouter = Router();

const adminOnly = [requireAuth, requireRole("ADMINISTRATOR")];

const publicUser = { id: true, name: true, email: true, role: true, isActive: true, mustChangePassword: true } as const;
type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUser }>;

const notFound = (res: Response) => sendError(res, 404, "NOT_FOUND", "User not found.");
const EMAIL_TAKEN = "That email address is already in use.";

function userIdFrom(req: Request): number | null {
  const id = Number(req.params.id);
  return isValidId(id) ? id : null;
}

// One place that turns a body into either clean values or a message per field. A field that is not
// sent is not checked; `required` lists the ones that must be.
function checkFields(body: Record<string, unknown>, required: readonly string[]) {
  const fields: Record<string, string> = {};
  const values: { name?: string; email?: string; role?: UserRole; isActive?: boolean; initialPassword?: string } = {};
  const checks = {
    name: validateName,
    email: validateEmail,
    role: validateRole,
    isActive: validateIsActive,
    initialPassword: validateInitialPassword,
  } as const;
  for (const key of Object.keys(checks) as (keyof typeof checks)[]) {
    if (body[key] === undefined && !required.includes(key)) continue;
    const checked = checks[key](body[key]);
    if (checked.error) fields[key] = checked.error;
    else (values as Record<string, unknown>)[key] = checked.value;
  }
  return { fields, values };
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const emailTaken = (res: Response) => sendError(res, 409, "EMAIL_TAKEN", EMAIL_TAKEN, { email: EMAIL_TAKEN });

// GET /api/admin/users (endpoint 13). Name or email, partial and case-insensitive, and an optional
// role. No pagination: the handout excludes it for this screen.
adminUsersRouter.get("/api/admin/users", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const where: Prisma.UserWhereInput = {};
    if (req.query.role !== undefined) {
      const role = validateRole(req.query.role);
      if (role.error) return sendError(res, 400, "VALIDATION_ERROR", role.error, { role: role.error });
      where.role = role.value;
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) {
      const text = escapeLike(search);
      where.OR = [{ name: { contains: text, mode: "insensitive" } }, { email: { contains: text, mode: "insensitive" } }];
    }
    res.status(200).json(await getPrisma().user.findMany({ where, select: publicUser, orderBy: [{ name: "asc" }, { id: "asc" }] }));
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to load the users.");
  }
});

// POST /api/admin/users (endpoint 14). Created with mustChangePassword true (BR-38); the password is
// hashed here and never returned or logged.
adminUsersRouter.post("/api/admin/users", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const { fields, values } = checkFields(req.body ?? {}, ["name", "email", "role", "initialPassword"]);
    if (Object.keys(fields).length > 0) return sendError(res, 400, "VALIDATION_ERROR", "Some fields are not valid.", fields);

    const prisma = getPrisma();
    // Compared case-insensitively (BR-39), which also catches an older row stored in mixed case. The
    // unique index catches two identical addresses submitted at the same moment.
    if (await prisma.user.findFirst({ where: { email: { equals: values.email!, mode: "insensitive" } }, select: { id: true } })) return emailTaken(res);

    const passwordHash = await hashPassword(values.initialPassword!);
    try {
      const created = await prisma.user.create({
        data: {
          name: values.name!,
          email: values.email!,
          role: values.role!,
          isActive: values.isActive ?? true,
          passwordHash,
          mustChangePassword: true,
        },
        select: publicUser,
      });
      res.status(201).json(created);
    } catch (e) {
      if (isUniqueViolation(e)) return emailTaken(res);
      throw e;
    }
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to create the user.");
  }
});

interface LockedUser {
  id: number;
  role: UserRole;
  isActive: boolean;
}

// Locks, for the rest of the transaction, the acting Administrator, the user being changed and every
// active Administrator, in id order so two of these can never wait on each other. A second change
// that touches the same people therefore waits, and when it runs it sees what the first one did.
// Without this two Administrators removing each other at the same moment would each see the other
// still active and both succeed, leaving none (BR-43).
async function lockPeople(tx: Prisma.TransactionClient, actorId: number, targetId: number): Promise<LockedUser[]> {
  return tx.$queryRaw<LockedUser[]>(Prisma.sql`
    SELECT "id", "role"::text AS "role", "isActive" FROM "User"
    WHERE "id" IN (${actorId}, ${targetId}) OR ("role" = 'ADMINISTRATOR' AND "isActive")
    ORDER BY "id"
    FOR UPDATE`);
}

// An Administrator whose account was deactivated or demoted a moment after their request was accepted
// no longer has the right to make it (BR-08 applies to a change already under way as much as to a new request).
const stillAdministrator = (people: LockedUser[], actorId: number) => {
  const actor = people.find((p) => p.id === actorId);
  return actor !== undefined && actor.isActive && actor.role === "ADMINISTRATOR";
};

type Outcome = { ok: true; user: PublicUser } | { ok: false; status: number; error: string; message: string; fields?: Record<string, string> };

// PATCH /api/admin/users/:id (endpoint 15). Checked in this order: the role (403), the id (404), the
// body (400), that the caller still is an Administrator, that the user exists (404), then the two
// guards on the Administrator role, then the address (409). All of it, and the session revocation, in
// one transaction.
adminUsersRouter.patch("/api/admin/users/:id", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const targetId = userIdFrom(req);
    if (targetId === null) return notFound(res);
    const { fields, values } = checkFields(req.body ?? {}, []);
    delete values.initialPassword; // not editable here: only endpoint 16 issues a password
    if (Object.keys(fields).length > 0) return sendError(res, 400, "VALIDATION_ERROR", "Some fields are not valid.", fields);
    if (values.name === undefined && values.email === undefined && values.role === undefined && values.isActive === undefined) {
      return sendError(res, 400, "VALIDATION_ERROR", "Send at least one of name, email, role and isActive.", {});
    }
    const actorId = req.user!.id;

    const run = async (): Promise<Outcome> =>
      getPrisma().$transaction(async (tx): Promise<Outcome> => {
        const people = await lockPeople(tx, actorId, targetId);
        if (!stillAdministrator(people, actorId)) {
          return { ok: false, status: 403, error: "FORBIDDEN", message: "You do not have permission to do that." };
        }
        const target = people.find((p) => p.id === targetId);
        if (!target) return { ok: false, status: 404, error: "NOT_FOUND", message: "User not found." };

        const changesRole = values.role !== undefined && values.role !== target.role;
        const deactivates = values.isActive === false && target.isActive;

        // BR-43: the last active Administrator stays, whoever asks. Reported before the self rule, so an
        // Administrator who is the only one is told why, which is the more basic reason.
        if (target.role === "ADMINISTRATOR" && target.isActive && (deactivates || (values.role !== undefined && values.role !== "ADMINISTRATOR"))) {
          const remaining = people.filter((p) => p.role === "ADMINISTRATOR" && p.isActive && p.id !== target.id).length;
          if (remaining === 0) {
            return { ok: false, status: 409, error: "LAST_ADMINISTRATOR", message: "At least one active Administrator is required." };
          }
        }
        // BR-42.
        if (target.id === actorId && (deactivates || changesRole)) {
          return {
            ok: false,
            status: 409,
            error: "SELF_DEACTIVATION",
            message: deactivates ? "You cannot deactivate your own account." : "You cannot change your own role.",
          };
        }
        if (values.email !== undefined) {
          const clash = await tx.user.findFirst({ where: { email: { equals: values.email, mode: "insensitive" }, id: { not: target.id } }, select: { id: true } });
          if (clash) return { ok: false, status: 409, error: "EMAIL_TAKEN", message: EMAIL_TAKEN, fields: { email: EMAIL_TAKEN } };
        }

        const user = await tx.user.update({
          where: { id: target.id },
          data: { name: values.name, email: values.email, role: values.role, isActive: values.isActive },
          select: publicUser,
        });
        // BR-45: a privilege change cannot be outlived by a session opened before it. Nothing else is
        // written: Tickets, comments, notes and Attachments keep pointing at the same person (BR-56).
        if (changesRole || deactivates) await tx.session.deleteMany({ where: { userId: target.id } });
        return { ok: true, user };
      });

    let outcome: Outcome;
    try {
      outcome = await run();
    } catch (e) {
      if (isUniqueViolation(e)) return emailTaken(res);
      throw e;
    }
    if (outcome.ok) return res.status(200).json(outcome.user);
    return sendError(res, outcome.status, outcome.error, outcome.message, outcome.fields);
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to update the user.");
  }
});

// POST /api/admin/users/:id/initial-password (endpoint 16). Re-flags the change and revokes every
// session of that user (BR-41). It answers with the user only: the password is never echoed or logged.
adminUsersRouter.post("/api/admin/users/:id/initial-password", ...adminOnly, async (req: Request, res: Response) => {
  try {
    const targetId = userIdFrom(req);
    if (targetId === null) return notFound(res);
    const checked = validateInitialPassword(req.body?.initialPassword);
    if (checked.error) return sendError(res, 400, "VALIDATION_ERROR", checked.error, { initialPassword: checked.error });

    // Hashing is slow on purpose, so it happens before the transaction and never holds a lock.
    const passwordHash = await hashPassword(checked.value!);
    const actorId = req.user!.id;
    const outcome = await getPrisma().$transaction(async (tx) => {
      const people = await lockPeople(tx, actorId, targetId);
      if (!stillAdministrator(people, actorId)) return "forbidden" as const;
      if (!people.some((p) => p.id === targetId)) return "missing" as const;
      const user = await tx.user.update({ where: { id: targetId }, data: { passwordHash, mustChangePassword: true }, select: publicUser });
      await tx.session.deleteMany({ where: { userId: targetId } });
      return user;
    });
    if (outcome === "forbidden") return sendError(res, 403, "FORBIDDEN", "You do not have permission to do that.");
    if (outcome === "missing") return notFound(res);
    res.status(200).json(outcome);
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to set the initial password.");
  }
});
