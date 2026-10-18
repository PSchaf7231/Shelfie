import { randomUUID } from "node:crypto";
import { PostgresDatabase } from "../../src/lib/postgres";
import { IntakeStore } from "../../src/lib/intake";
import { migrateDatabase } from "../../scripts/database";

export async function testDatabase() {
  const base = process.env.SHELFIE_TEST_DATABASE_URL;
  if (!base) throw new Error("Run npm test to start the isolated PostgreSQL test database.");
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new PostgresDatabase(base);
  await admin.read(async db => { await db.query(`CREATE SCHEMA "${schema}"`); });
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const connectionString = url.toString();
  try { await migrateDatabase(connectionString); }
  catch (error) { await admin.read(async db => { await db.query(`DROP SCHEMA "${schema}" CASCADE`); }); await admin.close(); throw error; }
  const connections: IntakeStore[] = [];
  return {
    url: connectionString,
    connect() { const store = new IntakeStore(connectionString); connections.push(store); return store; },
    async cleanup() {
      for (const store of connections) await store.close();
      try { await admin.read(async db => { await db.query(`DROP SCHEMA "${schema}" CASCADE`); }); }
      finally { await admin.close(); }
    },
  };
}
