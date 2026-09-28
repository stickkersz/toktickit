import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { UserRole } from "@prisma/client";
import { app } from "../../src/app.js";
import { createUser, loginAs, signedIn, useIsolatedDatabase } from "./helpers.js";

// Administrator user management (api-spec.md endpoints 13 to 16), against a throwaway database.
const iso = useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
const SHAPE = ["email", "id", "isActive", "mustChangePassword", "name", "role"];
const GOOD_PASSWORD = "Zen$Green7";
let admin: Session;
let adminId: number;
let staff: Session;
let requester: Session;
let n = 0;

const email = (label = "u") => `${label}-${++n}@toktickit.test`;
const stored = (id: number) => iso.db.client.user.findUniqueOrThrow({ where: { id } });
const userCount = () => iso.db.client.user.count();
const sessionCount = (userId: number) => iso.db.client.session.count({ where: { userId } });

async function makeUser(role: UserRole = "REQUESTER", opts: { isActive?: boolean; name?: string } = {}) {
  const made = await createUser({ role, isActive: opts.isActive });
  if (opts.name) await iso.db.client.user.update({ where: { id: made.user.id }, data: { name: opts.name } });
  return { ...made, session: await signedIn(made.user) };
}

// Leaves `keep` as the only active Administrator, without going through the endpoints under test.
async function leaveOnlyAdministrator(keep: number) {
  await iso.db.client.user.updateMany({ where: { role: "ADMINISTRATOR", id: { not: keep } }, data: { isActive: false } });
}
const restoreAdministrators = (ids: number[]) => iso.db.client.user.updateMany({ where: { id: { in: ids } }, data: { role: "ADMINISTRATOR", isActive: true } });

beforeAll(async () => {
  const a = await createUser({ role: "ADMINISTRATOR" });
  [admin, adminId] = [await signedIn(a.user), a.user.id];
  staff = await signedIn((await createUser({ role: "IT_STAFF" })).user);
  requester = await signedIn((await createUser()).user);
});

describe("who may use it", () => {
  // AC-33, BR-37 (API-12 covers the whole set again in the final sweep)
  it("refuses IT Staff and a Requester with 403 and an anonymous caller with 401 on every endpoint, with no user data, changing nothing", async () => {
    const target = await makeUser("REQUESTER", { name: "Untouchable Person" });
    const before = await stored(target.user.id);
    const usersBefore = await userCount();
    const calls: [string, (s: Session) => Promise<request.Response>][] = [
      ["list", (s) => s.get("/api/admin/users")],
      ["create", (s) => s.post("/api/admin/users").send({ name: "New Person", email: email(), role: "REQUESTER", initialPassword: GOOD_PASSWORD })],
      ["update", (s) => s.patch(`/api/admin/users/${target.user.id}`).send({ isActive: false })],
      ["initial password", (s) => s.post(`/api/admin/users/${target.user.id}/initial-password`).send({ initialPassword: GOOD_PASSWORD })],
    ];
    for (const [label, call] of calls) {
      for (const who of [staff, requester]) {
        const res = await call(who);
        expect(res.status, label).toBe(403);
        expect(res.body.error).toBe("FORBIDDEN");
        expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
        expect(JSON.stringify(res.body)).not.toContain("Untouchable");
      }
    }
    expect((await request(app).get("/api/admin/users")).status).toBe(401);
    expect((await request(app).post("/api/admin/users").send({})).status).toBe(401);
    expect((await request(app).patch(`/api/admin/users/${target.user.id}`).send({ isActive: false })).status).toBe(401);
    expect((await request(app).post(`/api/admin/users/${target.user.id}/initial-password`).send({ initialPassword: GOOD_PASSWORD })).status).toBe(401);
    expect(await stored(target.user.id)).toEqual(before);
    expect(await userCount()).toBe(usersBefore);
  });

  it("checks the role before the id or the body: the same 403 for a user that does not exist or a body that is invalid", async () => {
    for (const res of [
      await staff.patch("/api/admin/users/999999").send({ isActive: false }),
      await staff.patch("/api/admin/users/abc").send({}),
      await staff.post("/api/admin/users").send({ role: "NOPE" }),
      await staff.post("/api/admin/users/999999/initial-password").send({}),
    ]) {
      expect(res.status).toBe(403);
    }
  });
});

describe("listing", () => {
  // API-34 / FR-16, BR-03
  it("filters by a name search, an email search and a role, partial and case-insensitive, and never sends a password hash", async () => {
    const tag = `zq${++n}`;
    const a = await makeUser("IT_STAFF", { name: `Wanida ${tag} Prasert` });
    const b = await makeUser("REQUESTER", { name: `Somchai Boonmee` });
    await iso.db.client.user.update({ where: { id: b.user.id }, data: { email: `${tag}.somchai@toktickit.test` } });

    const byName = await admin.get("/api/admin/users").query({ search: `WANIDA ${tag.toUpperCase()}` });
    expect(byName.status).toBe(200);
    expect(byName.body.map((u: { id: number }) => u.id)).toEqual([a.user.id]);

    const byEmail = await admin.get("/api/admin/users").query({ search: `${tag}.SOMCHAI` });
    expect(byEmail.body.map((u: { id: number }) => u.id)).toEqual([b.user.id]);

    const both = await admin.get("/api/admin/users").query({ search: tag });
    expect(both.body.map((u: { id: number }) => u.id).sort()).toEqual([a.user.id, b.user.id].sort());

    const staffOnly = await admin.get("/api/admin/users").query({ search: tag, role: "IT_STAFF" });
    expect(staffOnly.body.map((u: { id: number }) => u.id)).toEqual([a.user.id]);

    const roleOnly = await admin.get("/api/admin/users").query({ role: "ADMINISTRATOR" });
    expect(roleOnly.body.length).toBeGreaterThan(0);
    expect(roleOnly.body.every((u: { role: string }) => u.role === "ADMINISTRATOR")).toBe(true);

    for (const u of [...byName.body, ...both.body, ...roleOnly.body]) {
      expect(Object.keys(u).sort()).toEqual(SHAPE);
    }
    expect(JSON.stringify([byName.body, both.body, roleOnly.body])).not.toMatch(/passwordHash|scrypt/);
    expect((await admin.get("/api/admin/users").query({ search: `${tag}-nothing-matches` })).body).toEqual([]);
  });

  it("orders by name, includes inactive users, and is not paginated", async () => {
    const tag = `pg${++n}`;
    for (let i = 0; i < 13; i += 1) await makeUser("REQUESTER", { name: `${tag} Person ${String(i).padStart(2, "0")}`, isActive: i % 2 === 0 });
    const res = await admin.get("/api/admin/users").query({ search: tag });
    expect(res.body).toHaveLength(13);
    const names = res.body.map((u: { name: string }) => u.name);
    expect(names).toEqual([...names].sort());
    expect(res.body.some((u: { isActive: boolean }) => !u.isActive)).toBe(true);
    expect(res.body.some((u: { isActive: boolean }) => u.isActive)).toBe(true);
  });

  it("treats % and _ in a search as the characters they are, not as wildcards", async () => {
    const tag = `wc${++n}`;
    const literal = await makeUser("REQUESTER", { name: `${tag} 100% sure` });
    await makeUser("REQUESTER", { name: `${tag} 100 percent sure` });
    const res = await admin.get("/api/admin/users").query({ search: "100%" });
    expect(res.body.map((u: { id: number }) => u.id)).toContain(literal.user.id);
    expect(res.body.every((u: { name: string; email: string }) => (u.name + u.email).toLowerCase().includes("100%"))).toBe(true);
    expect((await admin.get("/api/admin/users").query({ search: "_" })).body.every((u: { name: string; email: string }) => (u.name + u.email).includes("_"))).toBe(true);
  });

  it("rejects a role filter that is not one of the three, with 400", async () => {
    const res = await admin.get("/api/admin/users").query({ role: "SUPERUSER" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.fields.role).toBeDefined();
  });
});

describe("creating a user", () => {
  // API-35 / FR-17, BR-38
  it("creates a user with mustChangePassword true, stores a hash rather than the password, and lets them sign in with it and nothing else until they change it", async () => {
    const address = email("created");
    const res = await admin.post("/api/admin/users").send({ name: "  Alex Thompson  ", email: address.toUpperCase(), role: "IT_STAFF", isActive: true, initialPassword: GOOD_PASSWORD });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(SHAPE);
    expect(res.body).toMatchObject({ name: "Alex Thompson", email: address, role: "IT_STAFF", isActive: true, mustChangePassword: true });
    expect(JSON.stringify(res.body)).not.toContain(GOOD_PASSWORD);

    const row = await stored(res.body.id);
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(GOOD_PASSWORD);

    const cookie = await loginAs(address, GOOD_PASSWORD);
    const blocked = await request(app).get("/api/staff/owners").set("Cookie", cookie);
    expect(blocked.status).toBe(403); // must change the password first
  });

  it("defaults to active, and creates an inactive account that cannot sign in when told to", async () => {
    const dflt = await admin.post("/api/admin/users").send({ name: "Default Active", email: email(), role: "REQUESTER", initialPassword: GOOD_PASSWORD });
    expect(dflt.status).toBe(201);
    expect(dflt.body.isActive).toBe(true);
    const address = email("inactive");
    const off = await admin.post("/api/admin/users").send({ name: "Born Inactive", email: address, role: "REQUESTER", isActive: false, initialPassword: GOOD_PASSWORD });
    expect(off.status).toBe(201);
    expect(off.body.isActive).toBe(false);
    const login = await request(app).post("/api/auth/login").send({ email: address, password: GOOD_PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.error).toBe("ACCOUNT_INACTIVE");
  });

  // API-33 / AC-29, BR-39
  it("refuses a duplicate email, in any letter case and with padding, with 409 EMAIL_TAKEN and creates no user", async () => {
    const address = email("dup");
    const first = await admin.post("/api/admin/users").send({ name: "First Owner", email: address, role: "REQUESTER", initialPassword: GOOD_PASSWORD });
    expect(first.status).toBe(201);
    const before = await userCount();
    for (const variant of [address, address.toUpperCase(), `  ${address}  `, address.replace(/^./, (c) => c.toUpperCase())]) {
      const res = await admin.post("/api/admin/users").send({ name: "Second Owner", email: variant, role: "IT_STAFF", initialPassword: GOOD_PASSWORD });
      expect(res.status, variant).toBe(409);
      expect(res.body.error).toBe("EMAIL_TAKEN");
      expect(res.body.fields?.email).toMatch(/already in use/);
    }
    expect(await userCount()).toBe(before);
  });

  it("also refuses an address that differs only in case from an older row that was stored in mixed case", async () => {
    const legacy = await createUser();
    await iso.db.client.user.update({ where: { id: legacy.user.id }, data: { email: `Legacy.Mixed-${++n}@Toktickit.Test` } });
    const clash = (await stored(legacy.user.id)).email.toLowerCase();
    const res = await admin.post("/api/admin/users").send({ name: "Clashing", email: clash, role: "REQUESTER", initialPassword: GOOD_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("EMAIL_TAKEN");
  });

  it("creates exactly one user when the same address is submitted twice at once", async () => {
    const address = email("race");
    const send = () => admin.post("/api/admin/users").send({ name: "Race Person", email: address, role: "REQUESTER", initialPassword: GOOD_PASSWORD });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await iso.db.client.user.count({ where: { email: address } })).toBe(1);
  });

  it("reports every invalid field at once, and creates nothing", async () => {
    const before = await userCount();
    const res = await admin.post("/api/admin/users").send({ name: "A", email: "not-an-email", role: "WIZARD", isActive: "yes", initialPassword: "weak" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(Object.keys(res.body.fields).sort()).toEqual(["email", "initialPassword", "isActive", "name", "role"]);
    expect((await admin.post("/api/admin/users").send({})).body.fields).toMatchObject({
      name: expect.any(String),
      email: expect.any(String),
      role: expect.any(String),
      initialPassword: expect.any(String),
    });
    expect(await userCount()).toBe(before);
  });

  // API-40 / BR-46
  it("refuses an unknown role and two roles with 400, and creates nothing", async () => {
    const before = await userCount();
    for (const role of ["SUPERUSER", "requester", ["IT_STAFF", "ADMINISTRATOR"], "IT_STAFF,ADMINISTRATOR", null, ""]) {
      const res = await admin.post("/api/admin/users").send({ name: "Role Test", email: email(), role, initialPassword: GOOD_PASSWORD });
      expect(res.status, JSON.stringify(role)).toBe(400);
      expect(res.body.fields.role).toBeDefined();
    }
    expect((await admin.post("/api/admin/users").send({ name: "Role Test", email: email(), role: "IT_STAFF", roles: ["ADMINISTRATOR"], initialPassword: GOOD_PASSWORD })).body.role).toBe("IT_STAFF");
    expect(await userCount()).toBe(before + 1);
  });

  it("does not let a request set mustChangePassword, the password hash or the id", async () => {
    const res = await admin.post("/api/admin/users").send({ name: "Mass Assign", email: email(), role: "REQUESTER", initialPassword: GOOD_PASSWORD, mustChangePassword: false, passwordHash: "x", id: 1 });
    expect(res.status).toBe(201);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.id).not.toBe(1);
    expect((await stored(res.body.id)).passwordHash).toMatch(/^scrypt\$/);
  });
});

describe("updating a user", () => {
  // API-35 / FR-18, FR-19
  it("updates name, email, role and activation, together or one at a time, and returns the user in the list shape", async () => {
    const t = await makeUser("REQUESTER", { name: "Before Name" });
    const one = await admin.patch(`/api/admin/users/${t.user.id}`).send({ name: "  After Name  " });
    expect(one.status).toBe(200);
    expect(Object.keys(one.body).sort()).toEqual(SHAPE);
    expect(one.body).toMatchObject({ id: t.user.id, name: "After Name", role: "REQUESTER", isActive: true });

    const address = email("changed");
    const all = await admin.patch(`/api/admin/users/${t.user.id}`).send({ email: address.toUpperCase(), role: "IT_STAFF", isActive: false });
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ name: "After Name", email: address, role: "IT_STAFF", isActive: false });
    expect(await stored(t.user.id)).toMatchObject({ name: "After Name", email: address, role: "IT_STAFF", isActive: false });

    const back = await admin.patch(`/api/admin/users/${t.user.id}`).send({ isActive: true });
    expect(back.body.isActive).toBe(true);
  });

  it("ignores fields that are not editable here: mustChangePassword, passwordHash, id", async () => {
    const t = await makeUser();
    const before = await stored(t.user.id);
    const res = await admin.patch(`/api/admin/users/${t.user.id}`).send({ name: "Renamed Only", mustChangePassword: true, passwordHash: "!", id: 999 });
    expect(res.status).toBe(200);
    const after = await stored(t.user.id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.mustChangePassword).toBe(before.mustChangePassword);
    expect(after.id).toBe(t.user.id);
    expect(after.name).toBe("Renamed Only");
  });

  it("refuses an empty request, invalid values, and a user that does not exist, changing nothing", async () => {
    const t = await makeUser();
    const before = await stored(t.user.id);
    expect((await admin.patch(`/api/admin/users/${t.user.id}`).send({})).status).toBe(400);
    for (const body of [{ name: "A" }, { email: "nope" }, { role: "WIZARD" }, { role: ["IT_STAFF", "REQUESTER"] }, { isActive: "false" }]) {
      const res = await admin.patch(`/api/admin/users/${t.user.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    }
    expect(await stored(t.user.id)).toEqual(before);
    for (const id of ["999999", "0", "-1", "abc"]) {
      expect((await admin.patch(`/api/admin/users/${id}`).send({ name: "Nobody Here" })).status, id).toBe(404);
    }
  });

  // AC-29 / BR-39
  it("refuses an email already used by someone else, in any case, but lets a user keep their own address in a different case", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const before = await stored(b.user.id);
    for (const variant of [a.email, a.email.toUpperCase()]) {
      const res = await admin.patch(`/api/admin/users/${b.user.id}`).send({ email: variant });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("EMAIL_TAKEN");
    }
    expect((await stored(b.user.id)).email).toBe(before.email);
    const own = await admin.patch(`/api/admin/users/${b.user.id}`).send({ email: b.email.toUpperCase() });
    expect(own.status).toBe(200);
    expect(own.body.email).toBe(b.email.toLowerCase());
  });

  it("also refuses an address that differs only in case from an older row stored in mixed case", async () => {
    const legacy = await createUser();
    await iso.db.client.user.update({ where: { id: legacy.user.id }, data: { email: `Legacy.Update-${++n}@Toktickit.Test` } });
    const clash = (await stored(legacy.user.id)).email.toLowerCase();
    const t = await makeUser();
    const res = await admin.patch(`/api/admin/users/${t.user.id}`).send({ email: clash });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("EMAIL_TAKEN");
    expect((await stored(t.user.id)).email).toBe(t.email);
  });

  it("refuses a change from an Administrator who was deactivated a moment after their request was accepted, and writes nothing", async () => {
    const acting = await makeUser("ADMINISTRATOR");
    const t = await makeUser("REQUESTER", { name: "Stay The Same" });
    const before = await stored(t.user.id);
    let result: request.Response | undefined;
    let pending: Promise<void> | undefined;
    // The deactivation is in flight (uncommitted) when the request arrives, as it is when two Administrators act at once.
    await iso.db.client.$transaction(async (tx) => {
      await tx.user.update({ where: { id: acting.user.id }, data: { isActive: false } });
      pending = acting.session.patch(`/api/admin/users/${t.user.id}`).send({ name: "Changed Anyway" }).then((r) => void (result = r));
      await new Promise((r) => setTimeout(r, 400));
      expect(result, "the change must wait for the deactivation, not decide on the old state").toBeUndefined();
    });
    await pending;
    expect(result!.status).toBe(403);
    expect(await stored(t.user.id)).toEqual(before);
  });

  it("and the same for issuing an initial password", async () => {
    const acting = await makeUser("ADMINISTRATOR");
    const t = await makeUser();
    const before = await stored(t.user.id);
    let result: request.Response | undefined;
    let pending: Promise<void> | undefined;
    await iso.db.client.$transaction(async (tx) => {
      await tx.user.update({ where: { id: acting.user.id }, data: { role: "REQUESTER" } });
      pending = acting.session.post(`/api/admin/users/${t.user.id}/initial-password`).send({ initialPassword: GOOD_PASSWORD }).then((r) => void (result = r));
      await new Promise((r) => setTimeout(r, 400));
      expect(result).toBeUndefined();
    });
    await pending;
    expect(result!.status).toBe(403);
    expect((await stored(t.user.id)).passwordHash).toBe(before.passwordHash);
    expect(await sessionCount(t.user.id)).toBeGreaterThan(0);
  });

  it("never offers a delete: no route removes a user (BR-44)", async () => {
    const t = await makeUser();
    for (const url of [`/api/admin/users/${t.user.id}`, `/api/users/${t.user.id}`]) {
      const res = await request(app).delete(url).set("Cookie", admin.cookie);
      expect(res.status, url).toBe(404);
    }
    expect(await stored(t.user.id)).toBeDefined();
  });
});

describe("a new initial password", () => {
  // API-36 / AC-30, BR-41
  it("re-flags the change, revokes every session of that user, and the new password works while the old one does not", async () => {
    const t = await makeUser();
    await iso.db.client.user.update({ where: { id: t.user.id }, data: { mustChangePassword: false } });
    const before = await stored(t.user.id);
    const second = await loginAs(t.email, "Str0ng!Pass");
    expect(await sessionCount(t.user.id)).toBeGreaterThanOrEqual(2);
    expect((await request(app).get("/api/auth/me").set("Cookie", second)).status).toBe(200);

    const res = await admin.post(`/api/admin/users/${t.user.id}/initial-password`).send({ initialPassword: "Fresh#Start9" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(SHAPE);
    expect(res.body.mustChangePassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/Fresh#Start9|scrypt/);

    expect(await sessionCount(t.user.id)).toBe(0);
    expect((await request(app).get("/api/auth/me").set("Cookie", second)).status).toBe(401);
    expect((await t.session.get("/api/auth/me")).status).toBe(401);
    expect((await stored(t.user.id)).passwordHash).not.toBe(before.passwordHash);

    expect((await request(app).post("/api/auth/login").send({ email: t.email, password: "Str0ng!Pass" })).status).toBe(401);
    const login = await request(app).post("/api/auth/login").send({ email: t.email, password: "Fresh#Start9" });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
  });

  it("leaves other users' sessions alone", async () => {
    const t = await makeUser();
    const other = await makeUser();
    await admin.post(`/api/admin/users/${t.user.id}/initial-password`).send({ initialPassword: "Fresh#Start9" });
    expect((await other.session.get("/api/auth/me")).status).toBe(200);
  });

  it("refuses a password that breaks BR-10, and a user that does not exist, changing nothing", async () => {
    const t = await makeUser();
    const before = await stored(t.user.id);
    for (const initialPassword of ["weak", "nouppercase1!", "NOLOWERCASE1!", "NoNumber!!", "NoSpecial12", undefined, null, 12345678]) {
      const res = await admin.post(`/api/admin/users/${t.user.id}/initial-password`).send({ initialPassword });
      expect(res.status, String(initialPassword)).toBe(400);
      expect(res.body.fields.initialPassword).toBeDefined();
    }
    expect(await stored(t.user.id)).toEqual(before);
    expect(await sessionCount(t.user.id)).toBeGreaterThan(0);
    expect((await admin.post("/api/admin/users/999999/initial-password").send({ initialPassword: GOOD_PASSWORD })).status).toBe(404);
    expect((await admin.post("/api/admin/users/abc/initial-password").send({ initialPassword: GOOD_PASSWORD })).status).toBe(404);
  });

  it("never writes the password to the log", async () => {
    const t = await makeUser();
    const seen: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => {
      const original = console[k];
      console[k] = (...args: unknown[]) => void seen.push(args.map(String).join(" "));
      return () => (console[k] = original);
    });
    try {
      await admin.post(`/api/admin/users/${t.user.id}/initial-password`).send({ initialPassword: "Log#Check77" });
      await admin.post("/api/admin/users").send({ name: "Log Check", email: email(), role: "REQUESTER", initialPassword: "Log#Check77" });
    } finally {
      spies.forEach((restore) => restore());
    }
    expect(seen.join("\n")).not.toContain("Log#Check77");
  });
});

describe("sessions after a role change or a deactivation", () => {
  // API-39 / BR-45, AC-10
  it("revokes the user's sessions the moment their role changes, and not for a change that is not one", async () => {
    const t = await makeUser("IT_STAFF");
    expect((await t.session.get("/api/staff/owners")).status).toBe(200);
    for (const harmless of [{ name: "Only A New Name" }, { role: "IT_STAFF" }, { isActive: true }, { email: email() }]) {
      expect((await admin.patch(`/api/admin/users/${t.user.id}`).send(harmless)).status).toBe(200);
      expect(await sessionCount(t.user.id), JSON.stringify(harmless)).toBeGreaterThan(0);
    }
    const res = await admin.patch(`/api/admin/users/${t.user.id}`).send({ role: "REQUESTER" });
    expect(res.status).toBe(200);
    expect(await sessionCount(t.user.id)).toBe(0);
    expect((await t.session.get("/api/staff/owners")).status).toBe(401);
  });

  it("revokes the user's sessions when they are deactivated, so their next request is 401 without a logout", async () => {
    const t = await makeUser("REQUESTER");
    const other = await makeUser("REQUESTER");
    expect((await t.session.get("/api/tickets")).status).toBe(200);
    expect((await admin.patch(`/api/admin/users/${t.user.id}`).send({ isActive: false })).status).toBe(200);
    expect(await sessionCount(t.user.id)).toBe(0);
    expect((await t.session.get("/api/tickets")).status).toBe(401);
    expect((await other.session.get("/api/tickets")).status).toBe(200);
  });

  it("does not sign a user out for changing someone else's data, and signs them in fresh with their new role after re-login", async () => {
    const t = await makeUser("REQUESTER");
    await admin.patch(`/api/admin/users/${t.user.id}`).send({ role: "IT_STAFF" });
    const cookie = await loginAs(t.email, "Str0ng!Pass");
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.body.role).toBe("IT_STAFF");
  });
});

describe("the Administrator's own account", () => {
  // API-37 / AC-31, BR-42
  it("refuses deactivating their own account and changing their own role with 409 SELF_DEACTIVATION, writing nothing, while other Administrators exist", async () => {
    const other = await makeUser("ADMINISTRATOR");
    const me = await makeUser("ADMINISTRATOR");
    const before = await stored(me.user.id);
    for (const body of [{ isActive: false }, { role: "IT_STAFF" }, { role: "REQUESTER" }, { isActive: false, role: "IT_STAFF" }]) {
      const res = await me.session.patch(`/api/admin/users/${me.user.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.body.error).toBe("SELF_DEACTIVATION");
    }
    expect(await stored(me.user.id)).toEqual(before);
    expect(await sessionCount(me.user.id)).toBeGreaterThan(0);
    expect((await me.session.get("/api/admin/users")).status).toBe(200);
    // The other Administrator is free to do either to them, and it is not refused as a self change.
    void other;
  });

  it("still lets them edit their own name and email, and send their own current role and active flag unchanged", async () => {
    const other = await makeUser("ADMINISTRATOR");
    const me = await makeUser("ADMINISTRATOR");
    const res = await me.session.patch(`/api/admin/users/${me.user.id}`).send({ name: "My New Name", email: email("mine"), role: "ADMINISTRATOR", isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("My New Name");
    void other;
  });
});

describe("the last active Administrator", () => {
  // API-38 / AC-32, BR-43
  it("cannot be deactivated or moved to another role: 409 LAST_ADMINISTRATOR, nothing written and their sessions intact", async () => {
    const solo = await makeUser("ADMINISTRATOR");
    const others = (await iso.db.client.user.findMany({ where: { role: "ADMINISTRATOR", isActive: true, id: { not: solo.user.id } } })).map((u) => u.id);
    await leaveOnlyAdministrator(solo.user.id);
    try {
      const before = await stored(solo.user.id);
      for (const body of [{ isActive: false }, { role: "IT_STAFF" }, { role: "REQUESTER" }]) {
        const res = await solo.session.patch(`/api/admin/users/${solo.user.id}`).send(body);
        expect(res.status, JSON.stringify(body)).toBe(409);
        expect(res.body.error).toBe("LAST_ADMINISTRATOR");
        expect(res.body.message).toMatch(/at least one active administrator/i);
      }
      expect(await stored(solo.user.id)).toEqual(before);
      expect(await sessionCount(solo.user.id)).toBeGreaterThan(0);
      expect(await iso.db.client.user.count({ where: { role: "ADMINISTRATOR", isActive: true } })).toBe(1);
    } finally {
      await restoreAdministrators(others);
    }
  });

  it("is protected against two Administrators removing each other at the same moment: never both succeed, one active Administrator always remains", async () => {
    await iso.db.client.user.updateMany({ where: { role: "ADMINISTRATOR", isActive: true }, data: { isActive: false } });
    try {
      for (let round = 0; round < 8; round += 1) {
        const a = await makeUser("ADMINISTRATOR");
        const b = await makeUser("ADMINISTRATOR");
        const [ra, rb] = await Promise.all([
          a.session.patch(`/api/admin/users/${b.user.id}`).send({ isActive: false }),
          b.session.patch(`/api/admin/users/${a.user.id}`).send({ isActive: false }),
        ]);
        const active = await iso.db.client.user.count({ where: { role: "ADMINISTRATOR", isActive: true, id: { in: [a.user.id, b.user.id] } } });
        expect(active, `round ${round}: ${ra.status} and ${rb.status}`).toBeGreaterThanOrEqual(1);
        expect([ra.status, rb.status].filter((s) => s === 200)).toHaveLength(1);
        await iso.db.client.user.updateMany({ where: { id: { in: [a.user.id, b.user.id] } }, data: { isActive: false } });
      }
    } finally {
      await iso.db.client.user.update({ where: { id: adminId }, data: { isActive: true } });
    }
  });

  it("is protected the same way against two Administrators demoting each other at once", async () => {
    await iso.db.client.user.updateMany({ where: { role: "ADMINISTRATOR", isActive: true }, data: { isActive: false } });
    try {
      for (let round = 0; round < 8; round += 1) {
        const a = await makeUser("ADMINISTRATOR");
        const b = await makeUser("ADMINISTRATOR");
        const [ra, rb] = await Promise.all([
          a.session.patch(`/api/admin/users/${b.user.id}`).send({ role: "REQUESTER" }),
          b.session.patch(`/api/admin/users/${a.user.id}`).send({ role: "REQUESTER" }),
        ]);
        const admins = await iso.db.client.user.count({ where: { role: "ADMINISTRATOR", isActive: true, id: { in: [a.user.id, b.user.id] } } });
        expect(admins, `round ${round}: ${ra.status} and ${rb.status}`).toBeGreaterThanOrEqual(1);
        await iso.db.client.user.updateMany({ where: { id: { in: [a.user.id, b.user.id] } }, data: { isActive: false } });
      }
    } finally {
      await iso.db.client.user.update({ where: { id: adminId }, data: { isActive: true } });
    }
  });

  it("does not count an inactive Administrator as one who remains", async () => {
    const solo = await makeUser("ADMINISTRATOR");
    const sleeping = await makeUser("ADMINISTRATOR", { isActive: false });
    const others = (await iso.db.client.user.findMany({ where: { role: "ADMINISTRATOR", isActive: true, id: { not: solo.user.id } } })).map((u) => u.id);
    await leaveOnlyAdministrator(solo.user.id);
    try {
      const res = await solo.session.patch(`/api/admin/users/${solo.user.id}`).send({ isActive: false });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("LAST_ADMINISTRATOR");
      // Reactivating the sleeping one makes the first free to step down... through the other's hands, not their own.
      const wake = await solo.session.patch(`/api/admin/users/${sleeping.user.id}`).send({ isActive: true });
      expect(wake.status).toBe(200);
      const woken = await signedIn(sleeping.user);
      expect((await woken.patch(`/api/admin/users/${solo.user.id}`).send({ isActive: false })).status).toBe(200);
    } finally {
      await restoreAdministrators([...others, solo.user.id]);
    }
  });
});
