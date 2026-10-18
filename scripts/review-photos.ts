// Private support tool. There is deliberately no public photo-review viewer.
import { loadEnvConfig } from "@next/env";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresDatabase } from "../src/lib/postgres";

loadEnvConfig(process.cwd());
async function main() {
const reference = process.argv[2];
if (reference && !/^[a-f0-9-]{36}$/.test(reference)) throw new Error("Supply a valid review reference or omit it to list current shared checks.");
const database = new PostgresDatabase(process.env.DATABASE_URL);
try {
  await database.read(async db => { await db.query("DELETE FROM photo_reviews WHERE expires <= $1", [Date.now()]); });
  if (!reference) {
    const rows = await database.read(async db => (await db.query("SELECT r.id AS reference, r.reason, r.created, r.expires, COUNT(p.position)::int AS photos FROM photo_reviews r JOIN photo_review_images p ON p.review_id = r.id WHERE r.expires > $1 GROUP BY r.id ORDER BY r.created DESC LIMIT 20", [Date.now()])).rows);
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const rows = await database.read(async db => (await db.query("SELECT p.position, p.bytes FROM photo_review_images p JOIN photo_reviews r ON r.id = p.review_id WHERE r.id = $1 AND r.expires > $2 ORDER BY p.position", [reference, Date.now()])).rows);
    if (!rows.length) console.log("This shared check is unavailable or expired.");
    else {
      const directory = mkdtempSync(join(tmpdir(), "shelfie-shared-photos-"));
      for (const row of rows) writeFileSync(join(directory, `photo-${row.position + 1}.jpg`), row.bytes, { mode: 0o600 });
      console.log(JSON.stringify({ reference, photos: rows.length, directory }));
    }
  }
} catch { console.error("Photo review is unavailable. Check the private database connection and migrations; credentials have not been printed."); process.exitCode = 1; }
finally { await database.close(); }
}
main().catch(() => { console.error("Photo review is unavailable. Use a valid reference and the private database connection."); process.exitCode = 1; });
