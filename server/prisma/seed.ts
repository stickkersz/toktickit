import { getPrisma } from "../src/prisma.js";
import { CATEGORIES, RELATED_SYSTEMS, seedReferenceData } from "./seedReference.js";
import { SEED_TICKET_NUMBERS, seedTickets } from "./seedTickets.js";
import { SEED_USERS, seedUsers } from "./seedUsers.js";

async function main() {
  const prisma = getPrisma();

  await seedReferenceData(prisma);
  await seedUsers(prisma);
  await seedTickets(prisma);

  console.log(
    `Seeded ${CATEGORIES.length} categories, ${RELATED_SYSTEMS.length} related systems, ${SEED_USERS.length} users, ${SEED_TICKET_NUMBERS.length} tickets.`,
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
