import type { NextFunction, Request, Response } from "express";
import { sendError } from "../httpErrors.js";
import { SESSION_COOKIE, readCookie, resolveSession } from "../auth/session.js";

async function authenticate(req: Request, res: Response, next: NextFunction, allowPasswordChange: boolean) {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    const resolved = token ? await resolveSession(token) : null;
    if (!resolved) {
      return sendError(res, 401, "UNAUTHENTICATED", "You must be signed in to do that.");
    }
    req.user = resolved.user;
    req.sessionId = resolved.sessionId;
    // BR-02: until the initial password is replaced, only the three endpoints
    // that opt in (me, change-password, logout) are reachable.
    if (resolved.user.mustChangePassword && !allowPasswordChange) {
      return sendError(res, 403, "PASSWORD_CHANGE_REQUIRED", "You must change your password before continuing.");
    }
    next();
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to verify your session.");
  }
}

// Default guard for every protected endpoint: 401 without a live session, 403
// while a password change is outstanding.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  return authenticate(req, res, next, false);
}

// For POST /api/auth/logout, GET /api/auth/me and POST /api/auth/change-password
// only: a user who must change their password may still reach these (BR-02).
export function requireAuthAllowingPasswordChange(req: Request, res: Response, next: NextFunction) {
  return authenticate(req, res, next, true);
}
