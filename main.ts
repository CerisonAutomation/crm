// Standalone CRUD demo against the Neon-backed Prisma client.
// Run with: bun run src/main.ts   (or: bun run db:crud-demo)
import { db } from "@/lib/db";

async function main() {
  // CREATE
  const org = await db.organisation.create({
    data: { name: "Demo Organisation", slug: "demo-org" },
  });
  console.log("created:", org.id, org.name);

  // READ
  const found = await db.organisation.findUnique({ where: { id: org.id } });
  console.log("read:", found?.name);

  // UPDATE
  const updated = await db.organisation.update({
    where: { id: org.id },
    data: { name: "Demo Organisation (updated)" },
  });
  console.log("updated:", updated.name);

  // DELETE
  await db.organisation.delete({ where: { id: org.id } });
  const gone = await db.organisation.findUnique({ where: { id: org.id } });
  console.log("deleted:", gone === null);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
