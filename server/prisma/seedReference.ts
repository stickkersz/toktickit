import type { PrismaClient } from "@prisma/client";

// BR-37: idempotent seed, upsert-keyed on each model's unique field.
export const CATEGORIES: { name: string; isActive: boolean }[] = [
  { name: "Account and Access", isActive: true },
  { name: "Hardware", isActive: true },
  { name: "Software", isActive: true },
  { name: "Network", isActive: true },
  { name: "Telephony", isActive: false },
];

export const RELATED_SYSTEMS: { name: string; isActive: boolean }[] = [
  { name: "Student Portal", isActive: true },
  { name: "Library Catalog System", isActive: true },
  { name: "Dormitory Wi-Fi", isActive: true },
  { name: "Course Registration System", isActive: true },
  { name: "E-Learning Platform", isActive: true },
  { name: "Staff VPN", isActive: true },
  { name: "Cafeteria Payment Kiosk", isActive: true },
  { name: "Legacy Alumni Portal", isActive: false },
];

// BR-37: idempotent, upsert-keyed on each model's unique field. Split out of the
// seed script so the test helpers can seed reference data into a throwaway
// database without running the whole seed.
export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (const { name, isActive } of CATEGORIES) {
    await prisma.category.upsert({
      where: { name },
      update: { isActive },
      create: { name, isActive },
    });
  }

  for (const { name, isActive } of RELATED_SYSTEMS) {
    await prisma.relatedSystem.upsert({
      where: { name },
      update: { isActive },
      create: { name, isActive },
    });
  }
}
