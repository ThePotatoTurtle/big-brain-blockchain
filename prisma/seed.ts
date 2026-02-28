import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString =
  process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

const adapter = new PrismaPg({ connectionString: connectionString! });
const prisma = new PrismaClient({ adapter });

const users = [
  { name: "Danny", email: null },
  { name: "Andy", email: null },
  { name: "Timmy", email: null },
  { name: "Jayden", email: null },
  { name: "Calvin", email: null },
  { name: "Henry", email: null },
  { name: "Leon", email: null },
];

async function main() {
  for (const user of users) {
    await prisma.user.upsert({
      where: { name: user.name },
      update: {},
      create: user,
    });
  }
  console.log("Seeded 7 users");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
