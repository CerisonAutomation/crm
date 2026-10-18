import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";

export async function createTestDb(): Promise<{
  db: PrismaClient;
  close: () => Promise<void>;
}> {
  const pglite = new PGlite();
  await pglite.waitReady;
  const sql = readFileSync(
    join(process.cwd(), "prisma", "pglite-init.sql"),
    "utf8",
  );
  await pglite.exec(sql);
  const adapter = new PrismaPGlite(pglite);
  const db = new PrismaClient({ adapter });
  return {
    db,
    close: async () => {
      await db.$disconnect();
      await pglite.close();
    },
  };
}
