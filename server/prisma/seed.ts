import { getPrisma } from "../src/prisma.js";

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

const REQUESTERS: { name: string; email: string; isActive: boolean }[] = [
  { name: "Kanokwan Srisuwan", email: "kanokwan.srisuwan@toktickit.test", isActive: true },
  { name: "Thanapon Wattana", email: "thanapon.wattana@toktickit.test", isActive: true },
  { name: "Nutchanon Boonmee", email: "nutchanon.boonmee@toktickit.test", isActive: true },
  { name: "Ploypailin Chaisiri", email: "ploypailin.chaisiri@toktickit.test", isActive: true },
  { name: "Somsak Rattanakosin", email: "somsak.rattanakosin@toktickit.test", isActive: false },
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

  for (const { name, email, isActive } of REQUESTERS) {
    await prisma.requesterUser.upsert({
      where: { email },
      update: { name, isActive },
      create: { name, email, isActive },
    });
  }

  console.log(
    `Seeded ${CATEGORIES.length} categories, ${RELATED_SYSTEMS.length} related systems, ${REQUESTERS.length} requesters.`,
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
