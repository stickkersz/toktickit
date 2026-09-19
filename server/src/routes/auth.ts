import { Router, type Request, type Response } from "express";
import { getPrisma } from "../prisma.js";
import { sendError } from "../httpErrors.js";
import {
  hashPassword,
  validatePasswordChange,
  verifyAgainstDummy,
  verifyPassword,
} from "../auth/password.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  readCookie,
  revokeSessionByToken,
  revokeUserSessions,
  setSessionCookie,
} from "../auth/session.js";
import { requireAuthAllowingPasswordChange } from "../middleware/requireAuth.js";

export const authRouter = Router();

function publicUser(user: { id: number; name: string; email: string; role: string; mustChangePassword: boolean }) {
  const { id, name, email, role, mustChangePassword } = user;
  return { id, name, email, role, mustChangePassword };
}

const INTERNAL = (res: Response, message: string) => sendError(res, 500, "INTERNAL_ERROR", message);

// POST /api/auth/login (api-spec.md endpoint 1, FR-01, BR-01, BR-09)
authRouter.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    const fields: Record<string, string> = {};
    if (typeof email !== "string" || email.trim() === "") fields.email = "Email is required.";
    if (typeof password !== "string" || password === "") fields.password = "Password is required.";
    if (typeof email !== "string" || typeof password !== "string" || Object.keys(fields).length > 0) {
      return sendError(res, 400, "VALIDATION_ERROR", "Email and password are required.", fields);
    }

    const user = await getPrisma().user.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Same scrypt work whether or not the email exists (timing, BR-09).
    const passwordOk = user ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);
    if (!user || !passwordOk) {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
    // Reported only after the password verified, so it never confirms that an
    // address exists to someone who does not hold its credentials.
    if (!user.isActive) {
      return sendError(res, 401, "ACCOUNT_INACTIVE", "This account is inactive. Contact an administrator.");
    }

    setSessionCookie(res, await createSession(user.id));
    res.status(200).json(publicUser(user));
  } catch {
    INTERNAL(res, "Unable to sign in.");
  }
});

// POST /api/auth/logout (endpoint 2, FR-03, BR-07)
authRouter.post("/api/auth/logout", requireAuthAllowingPasswordChange, async (req: Request, res: Response) => {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await revokeSessionByToken(token);
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
  } catch {
    INTERNAL(res, "Unable to sign out.");
  }
});

// GET /api/auth/me (endpoint 3, FR-04)
authRouter.get("/api/auth/me", requireAuthAllowingPasswordChange, (req: Request, res: Response) => {
  res.status(200).json(publicUser(req.user!));
});

// POST /api/auth/change-password (endpoint 4, FR-02, BR-10)
authRouter.post(
  "/api/auth/change-password",
  requireAuthAllowingPasswordChange,
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = {
        currentPassword: typeof body.currentPassword === "string" ? body.currentPassword : "",
        newPassword: typeof body.newPassword === "string" ? body.newPassword : "",
        confirmPassword: typeof body.confirmPassword === "string" ? body.confirmPassword : "",
      };
      const fields = validatePasswordChange(input);
      if (input.currentPassword === "") fields.currentPassword = "Current password is required.";
      if (Object.keys(fields).length > 0) {
        return sendError(res, 400, "VALIDATION_ERROR", Object.values(fields)[0], fields);
      }

      const prisma = getPrisma();
      const stored = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!stored || !(await verifyPassword(input.currentPassword, stored.passwordHash))) {
        return sendError(res, 401, "INVALID_CREDENTIALS", "Current password is incorrect.");
      }

      const updated = await prisma.user.update({
        where: { id: stored.id },
        data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
      });
      // BR-10: every other session for this user is revoked; the acting one survives.
      await revokeUserSessions(updated.id, req.sessionId);
      res.status(200).json(publicUser(updated));
    } catch {
      INTERNAL(res, "Unable to change the password.");
    }
  },
);
