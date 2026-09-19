import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { TEST_PASSWORD, buildProbeApp, createUser, loginAs, uniqueEmail } from "./helpers.js";

// Requires the DB to be migrated first. Every test builds its own users with a
// unique email and never asserts on a global row count.
describe("POST /api/auth/login", () => {
  // API-01 / AC-01, BR-04, BR-05
  it("signs in a valid user, sets a hardened cookie, and returns a safe body", async () => {
    const { user, email, password } = await createUser({ role: "IT_STAFF" });
    const res = await request(app).post("/api/auth/login").send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: user.id,
      name: "Test User",
      email,
      role: "IT_STAFF",
      mustChangePassword: false,
    });
    expect(Object.keys(res.body).sort()).toEqual(["email", "id", "mustChangePassword", "name", "role"]);

    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toMatch(/^toktickit_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=28800/);
    expect(cookie).not.toMatch(/Secure/);

    // BR-04: only the SHA-256 digest of the token is stored.
    const token = cookie.split(";")[0].split("=")[1];
    const rows = await getPrisma().session.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(rows[0].tokenHash).not.toBe(token);
    const ttl = rows[0].expiresAt.getTime() - rows[0].createdAt.getTime();
    expect(Math.abs(ttl - 8 * 60 * 60 * 1000)).toBeLessThan(5000);
  });

  it("rejects a missing email or password with a field-keyed 400", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "", password: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.fields).toEqual({ email: "Email is required.", password: "Password is required." });
  });

  it("matches the email case-insensitively", async () => {
    const { email, password } = await createUser();
    const res = await request(app).post("/api/auth/login").send({ email: email.toUpperCase(), password });
    expect(res.status).toBe(200);
  });

  // API-02 / AC-06, BR-09
  it("returns the identical 401 for an unknown email and for a wrong password", async () => {
    const { email } = await createUser();
    const unknown = await request(app).post("/api/auth/login").send({ email: uniqueEmail("ghost"), password: TEST_PASSWORD });
    const wrong = await request(app).post("/api/auth/login").send({ email, password: "Wrong!Pass123" });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual({ error: "INVALID_CREDENTIALS", message: "Invalid email or password." });
    expect(wrong.body).toEqual(unknown.body);
    expect(unknown.headers["set-cookie"]).toBeUndefined();
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  // API-03 / AC-05, BR-01, BR-09
  it("reports an inactive account only after the password verifies, and creates no session", async () => {
    const { user, email, password } = await createUser({ isActive: false });

    const right = await request(app).post("/api/auth/login").send({ email, password });
    expect(right.status).toBe(401);
    expect(right.body.error).toBe("ACCOUNT_INACTIVE");
    expect(right.body.message).toBe("This account is inactive. Contact an administrator.");
    expect(right.headers["set-cookie"]).toBeUndefined();
    expect(await getPrisma().session.count({ where: { userId: user.id } })).toBe(0);

    // Without the password the response is the generic one: no account disclosure.
    const wrong = await request(app).post("/api/auth/login").send({ email, password: "Wrong!Pass123" });
    expect(wrong.body.error).toBe("INVALID_CREDENTIALS");
  });

  it("returns 500 with a safe body when the database fails", async () => {
    const { vi } = await import("vitest");
    const prismaModule = await import("../../src/prisma.js");
    const spy = vi.spyOn(prismaModule, "getPrisma").mockReturnValue({
      user: { findUnique: () => Promise.reject(new Error("connection refused: secret detail")) },
    } as never);
    try {
      const res = await request(app).post("/api/auth/login").send({ email: "a@b.test", password: "x" });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "INTERNAL_ERROR", message: "Unable to sign in." });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("password change requirement", () => {
  // API-04 / AC-02, BR-02
  it("blocks every protected endpoint with 403 until the password is changed, except me, change-password and logout", async () => {
    const probe = buildProbeApp();
    const { email, password } = await createUser({ mustChangePassword: true });
    const cookie = await loginAs(email, password);

    const blocked = await request(probe).get("/probe/any").set("Cookie", cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("PASSWORD_CHANGE_REQUIRED");

    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).body.mustChangePassword).toBe(true);

    const changed = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: password, newPassword: "Fresh!Pass456", confirmPassword: "Fresh!Pass456" });
    expect(changed.status).toBe(200);

    expect((await request(probe).get("/probe/any").set("Cookie", cookie)).status).toBe(200);

    const { email: e2, password: p2 } = await createUser({ mustChangePassword: true });
    const c2 = await loginAs(e2, p2);
    expect((await request(app).post("/api/auth/logout").set("Cookie", c2)).status).toBe(200);
  });

  it("enforces role on top of authentication with 403 and no body content", async () => {
    const probe = buildProbeApp();
    const requester = await createUser({ role: "REQUESTER" });
    const staff = await createUser({ role: "IT_STAFF" });
    const rc = await loginAs(requester.email, requester.password);
    const sc = await loginAs(staff.email, staff.password);

    const denied = await request(probe).get("/probe/staff").set("Cookie", rc);
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "FORBIDDEN", message: "You do not have permission to do that." });
    expect((await request(probe).get("/probe/staff").set("Cookie", sc)).status).toBe(200);
    expect((await request(probe).get("/probe/admin").set("Cookie", sc)).status).toBe(403);
    expect((await request(probe).get("/probe/any")).status).toBe(401);
  });
});

describe("POST /api/auth/change-password", () => {
  // API-05 / AC-07, BR-10
  it("rejects each unmet rule with a field message and leaves the old password in force", async () => {
    const { email, password } = await createUser();
    const cookie = await loginAs(email, password);
    const send = (body: object) => request(app).post("/api/auth/change-password").set("Cookie", cookie).send(body);

    const cases: [string, string, string][] = [
      ["Aa1!aaa", "Aa1!aaa", "Password must be at least 8 characters."],
      ["aa1!aaaa", "aa1!aaaa", "Password must include at least one upper case letter."],
      ["AA1!AAAA", "AA1!AAAA", "Password must include at least one lower case letter."],
      ["Aaa!aaaa", "Aaa!aaaa", "Password must include at least one number."],
      ["Aa1aaaaa", "Aa1aaaaa", "Password must include at least one special character."],
      [password, password, "New password must be different from the current password."],
    ];
    for (const [newPassword, confirmPassword, message] of cases) {
      const res = await send({ currentPassword: password, newPassword, confirmPassword });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
      expect(res.body.fields.newPassword).toBe(message);
    }

    const mismatch = await send({ currentPassword: password, newPassword: "Fresh!Pass456", confirmPassword: "Fresh!Pass457" });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.fields.confirmPassword).toBe("Password confirmation does not match.");

    const wrongCurrent = await send({ currentPassword: "Wrong!Pass123", newPassword: "Fresh!Pass456", confirmPassword: "Fresh!Pass456" });
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.body.error).toBe("INVALID_CREDENTIALS");

    // Nothing above changed the credential.
    expect((await request(app).post("/api/auth/login").send({ email, password })).status).toBe(200);
  });

  // API-06 / AC-08, BR-10
  it("clears the flag, revokes every other session, and keeps the acting one", async () => {
    const { user, email, password } = await createUser({ mustChangePassword: true });
    const acting = await loginAs(email, password);
    const other = await loginAs(email, password);

    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", acting)
      .send({ currentPassword: password, newPassword: "Fresh!Pass456", confirmPassword: "Fresh!Pass456" });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/hash/i);

    expect((await request(app).get("/api/auth/me").set("Cookie", acting)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", other)).status).toBe(401);
    expect(await getPrisma().session.count({ where: { userId: user.id } })).toBe(1);

    expect((await request(app).post("/api/auth/login").send({ email, password })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email, password: "Fresh!Pass456" })).status).toBe(200);
  });
});

describe("session lifecycle", () => {
  // API-07 / AC-09, BR-07
  it("returns 401 on the same cookie after logout, and logout is repeatable", async () => {
    const { email, password } = await createUser();
    const cookie = await loginAs(email, password);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);

    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    expect((out.headers["set-cookie"] as unknown as string[])[0]).toMatch(/toktickit_session=;.*Expires=Thu, 01 Jan 1970/);

    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    // A second logout with the dead cookie is an ordinary 401, not a crash.
    expect((await request(app).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(401);
  });

  // API-08 / AC-10, BR-06, BR-08
  it("returns 401 for a user deactivated mid-session, and for an expired session, without an explicit logout", async () => {
    const { user, email, password } = await createUser();
    const cookie = await loginAs(email, password);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);

    await getPrisma().user.update({ where: { id: user.id }, data: { isActive: false } });
    const after = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(401);
    expect(after.body.error).toBe("UNAUTHENTICATED");

    const fresh = await createUser();
    const expired = await loginAs(fresh.email, fresh.password);
    await getPrisma().session.updateMany({
      where: { userId: fresh.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await request(app).get("/api/auth/me").set("Cookie", expired)).status).toBe(401);
    // The expired row is cleaned up rather than left behind.
    expect(await getPrisma().session.count({ where: { userId: fresh.user.id } })).toBe(0);
  });

  it("treats a missing, garbage, or foreign cookie as unauthenticated", async () => {
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", "toktickit_session=not-a-real-token")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", "other=1; toktickit_session=%E0%A4%A")).status).toBe(401);
  });
});
