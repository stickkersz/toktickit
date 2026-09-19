import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { getPrisma } from "../prisma.js";

// BR-05: cookie name and attributes. BR-06: absolute 8 hour expiry.
export const SESSION_COOKIE = "toktickit_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
    sessionId?: number;
  }
}

// BR-04: the token is 32 random bytes; only its SHA-256 digest is ever stored.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Small first-party parser, kept in place of the cookie-parser dependency.
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// Secure is omitted only outside production because the lab stack runs over
// plain HTTP (BR-05).
function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export async function createSession(userId: number): Promise<string> {
  const token = generateToken();
  await getPrisma().session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return token;
}

// BR-06, BR-08: an expired session is an absent one, and the user's isActive is
// re-checked on every request so a deactivated user loses access immediately.
export async function resolveSession(
  token: string,
): Promise<{ sessionId: number; user: AuthUser } | null> {
  const session = await getPrisma().session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await getPrisma().session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (!session.user.isActive) return null;
  const { id, name, email, role, mustChangePassword } = session.user;
  return { sessionId: session.id, user: { id, name, email, role, mustChangePassword } };
}

// BR-07: logout deletes the row. Deleting an absent row is not an error.
export async function revokeSessionByToken(token: string): Promise<void> {
  await getPrisma().session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

// BR-10, BR-41, BR-45: revoke a user's sessions, optionally sparing the acting one.
export async function revokeUserSessions(userId: number, exceptSessionId?: number): Promise<void> {
  await getPrisma().session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}
