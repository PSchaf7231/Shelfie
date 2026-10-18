import { readFileSync } from "node:fs";
import { PostgresDatabase } from "../src/lib/postgres";

export async function migrateDatabase(connectionString: string | undefined) {
  const database = new PostgresDatabase(connectionString);
  try {
    await database.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('shelfie:schema-migrations', 0))");
      await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", ["001_initial"]);
      if (!applied.rowCount) {
        await client.query(readFileSync(new URL("../migrations/001_initial.sql", import.meta.url), "utf8"));
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", ["001_initial"]);
      }
    });
  } finally { await database.close(); }
}
