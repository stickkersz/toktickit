import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { sendError } from "../httpErrors.js";

// Must run after requireAuth. BR-14: an authenticated caller whose role is not
// permitted gets 403 with no protected content in the body.
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return sendError(res, 403, "FORBIDDEN", "You do not have permission to do that.");
    }
    next();
  };
}
