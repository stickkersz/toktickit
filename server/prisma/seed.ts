import { getPrisma } from "../src/prisma.js";
import { SEED_USERS, seedUsers } from "./seedUsers.js";

// BR-37: idempotent seed, upsert-keyed on each model's unique field.
const CATEGORIES: { name: string; isActive: boolean }[] = [
  { name: "Account and Access", isActive: true },
  { name: "Hardware", isActive: true },
  { name: "Software", isActive: true },
  { name: "Network", isActive: true },
  { name: "Telephony", isActive: false },
];

const RELATED_SYSTEMS: { name: string; isActive: boolean }[] = [
  { name: "Student Portal", isActive: true },
  { name: "Library Catalog System", isActive: true },
  { name: "Dormitory Wi-Fi", isActive: true },
  { name: "Course Registration System", isActive: true },
  { name: "E-Learning Platform", isActive: true },
  { name: "Staff VPN", isActive: true },
  { name: "Cafeteria Payment Kiosk", isActive: true },
  { name: "Legacy Alumni Portal", isActive: false },
];

async function main() {
  const prisma = getPrisma();

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

  await seedUsers(prisma);

  console.log(
    `Seeded ${CATEGORIES.length} categories, ${RELATED_SYSTEMS.length} related systems, ${SEED_USERS.length} users.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
