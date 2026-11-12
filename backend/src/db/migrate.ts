import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./client.js";

/** Applies all pending SQL migrations from ./drizzle. Safe to run on every start. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, pool } = createDb(databaseUrl);
  try {
    const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const url =
    process.env.DATABASE_URL ??
    "postgres://competitorpulse:competitorpulse@localhost:5432/competitorpulse";
  runMigrations(url)
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
