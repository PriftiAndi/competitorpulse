import { sql } from "drizzle-orm";
import pg from "pg";
import { createDb, type Db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";

const DEFAULT_ADMIN_URL = "postgres://competitorpulse:competitorpulse@localhost:5432/competitorpulse";
const TEST_DB = "competitorpulse_test";

/**
 * Connects to a dedicated test database, creating and migrating it on first
 * use. TEST_DATABASE_URL overrides the admin connection (CI points it at a
 * service container). Each test file calls `reset()` to start from empty tables.
 */
export async function testDb(): Promise<{ db: Db; reset: () => Promise<void>; close: () => Promise<void> }> {
  const adminUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_ADMIN_URL;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = $1", [TEST_DB]);
  if (exists.rowCount === 0) await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const testUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
  await runMigrations(testUrl);
  const { db, pool } = createDb(testUrl);

  return {
    db,
    reset: async () => {
      await db.execute(sql`truncate table snapshots, competitors, llm_usage restart identity cascade`);
    },
    close: async () => {
      await pool.end();
    },
  };
}

export const silentLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return silentLogger;
  },
  level: "silent",
} as unknown as import("fastify").FastifyBaseLogger;
