import type { PrismaClient, UserRole } from "@prisma/client";
import { UNUSABLE_PASSWORD_HASH, hashPassword } from "../src/auth/password.js";

// LOCAL DEVELOPMENT CREDENTIAL ONLY (BR-48). Every seeded and migrated account
// starts with this password and is forced to replace it at first login. It is
// documented in the README on purpose; it is never a real person's password.
export const DEV_INITIAL_PASSWORD = "ChangeMe!23";

export interface SeedUser {
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

// BR-50: 4 active and 1 inactive Requester, 3 active and 1 inactive IT Staff,
// 1 active Administrator. The five Requesters stay first so that on a fresh
// database they keep ids 1 to 5, which the Lab 2 tests rely on.
export const SEED_USERS: SeedUser[] = [
  { name: "Kanokwan Srisuwan", email: "kanokwan.srisuwan@toktickit.test", role: "REQUESTER", isActive: true },
  { name: "Thanapon Wattana", email: "thanapon.wattana@toktickit.test", role: "REQUESTER", isActive: true },
  { name: "Nutchanon Boonmee", email: "nutchanon.boonmee@toktickit.test", role: "REQUESTER", isActive: true },
  { name: "Ploypailin Chaisiri", email: "ploypailin.chaisiri@toktickit.test", role: "REQUESTER", isActive: true },
  { name: "Somsak Rattanakosin", email: "somsak.rattanakosin@toktickit.test", role: "REQUESTER", isActive: false },
  { name: "Pimchanok Somboon", email: "pimchanok.somboon@toktickit.test", role: "IT_STAFF", isActive: true },
  { name: "Wichai Charoen", email: "wichai.charoen@toktickit.test", role: "IT_STAFF", isActive: true },
  { name: "Anucha Prasert", email: "anucha.prasert@toktickit.test", role: "IT_STAFF", isActive: true },
  { name: "Sunisa Kaewmanee", email: "sunisa.kaewmanee@toktickit.test", role: "IT_STAFF", isActive: false },
  { name: "Aekkarat Wongsa", email: "aekkarat.wongsa@toktickit.test", role: "ADMINISTRATOR", isActive: true },
];

// BR-52: idempotent, upserting on email. Identity fields of the fixture rows are
// re-asserted on every run. A credential is issued only to a new row or to a row
// still holding the BR-51 marker, and never over a well-formed hash, so
// re-seeding cannot reset a password a user chose or an Administrator issued.
// The marker rule covers every row in the table, not only the fixture emails: a
// migrated Lab 2 user who is not a fixture must not be left with no credential.
export async function seedUsers(prisma: PrismaClient): Promise<void> {
  for (const { name, email, role, isActive } of SEED_USERS) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          name,
          email,
          role,
          isActive,
          passwordHash: await hashPassword(DEV_INITIAL_PASSWORD),
          mustChangePassword: true,
        },
      });
      continue;
    }
    const needsCredential = existing.passwordHash === UNUSABLE_PASSWORD_HASH;
    await prisma.user.update({
      where: { email },
      data: {
        name,
        role,
        isActive,
        ...(needsCredential
          ? { passwordHash: await hashPassword(DEV_INITIAL_PASSWORD), mustChangePassword: true }
          : {}),
      },
    });
  }

  const stranded = await prisma.user.findMany({
    where: { passwordHash: UNUSABLE_PASSWORD_HASH },
    select: { id: true },
  });
  for (const { id } of stranded) {
    await prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(DEV_INITIAL_PASSWORD), mustChangePassword: true },
    });
  }
}
