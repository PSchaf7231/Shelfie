import { DatabaseSync } from "node:sqlite";
import { PostgresDatabase } from "../src/lib/postgres";
import { IntakeError } from "../src/lib/errors";
import { migrateDatabase } from "./database";

const tables = ["sessions", "reports", "photo_batches", "photos", "photo_attempts", "ingredient_drafts"] as const;
type Row = Record<string, string | number | bigint | Uint8Array | null>;
const email = (value: Row[string]) => String(value).trim().toLowerCase();

export async function importSqlite(sourcePath: string, connectionString: string | undefined) {
  // Open read-only and take a consistent snapshot. Never reset or modify the
  // SQLite source; preserve it as a rollback reference after the switch.
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const snapshot = {} as Record<typeof tables[number], Row[]>;
  try {
    source.exec("BEGIN");
    const present = new Set((source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map(row => row.name));
    if (!present.has("sessions") || !present.has("reports")) throw new IntakeError("The source is not a Shelfie database.");
    for (const table of tables) snapshot[table] = present.has(table) ? source.prepare(`SELECT * FROM ${table}${table === "photos" ? " ORDER BY rowid" : ""}`).all() as Row[] : [];
    source.exec("COMMIT");
  } finally { source.close(); }
  await migrateDatabase(connectionString);
  const database = new PostgresDatabase(connectionString);
  try {
    await database.transaction(async db => {
      // Run the import before reopening the app. This lock also prevents a live
      // request from adding data between the empty-target check and inserts.
      await db.query(`LOCK TABLE ${tables.join(", ")} IN ACCESS EXCLUSIVE MODE`);
      for (const table of tables) {
        if ((await db.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) throw new IntakeError("The PostgreSQL target already contains Shelfie data. Import stopped without overwriting it.", 409);
      }
      for (const row of snapshot.sessions) await db.query("INSERT INTO sessions (id, name, email, pregnancy, glp1, code_hash, expires, attempts, verified, created) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [row.id, row.name, email(row.email), row.pregnancy, row.glp1, row.code_hash, row.expires, row.attempts, row.verified, row.created]);
      for (const row of snapshot.reports) await db.query("INSERT INTO reports (email, report_id, content, completed) VALUES ($1,$2,$3::jsonb,$4)", [email(row.email), row.report_id, row.content, row.completed]);
      for (const row of snapshot.photo_batches) await db.query("INSERT INTO photo_batches (email, revision, expires) VALUES ($1,$2,$3)", [email(row.email), row.revision, row.expires]);
      const positions = new Map<string, number>();
      for (const row of snapshot.photos) {
        const owner = email(row.email);
        const position = positions.get(owner) ?? 0;
        positions.set(owner, position + 1);
        await db.query("INSERT INTO photos (id, email, bytes, width, height, position) VALUES ($1,$2,$3,$4,$5,$6)", [row.id, owner, Buffer.from(row.bytes as Uint8Array), row.width, row.height, position]);
      }
      for (const row of snapshot.photo_attempts) await db.query("INSERT INTO photo_attempts (email, started, total) VALUES ($1,$2,$3)", [email(row.email), row.started, row.total]);
      for (const row of snapshot.ingredient_drafts) await db.query("INSERT INTO ingredient_drafts (email, revision, modes, catalog_version, content) VALUES ($1,$2,$3::jsonb,$4,$5::jsonb)", [email(row.email), row.revision, row.modes, row.catalog_version, row.content]);
    });
    return Object.fromEntries(tables.map(table => [table, snapshot[table].length]));
  } finally { await database.close(); }
}
