import { loadEnvConfig } from "@next/env";
import { importSqlite } from "./sqlite-import";
loadEnvConfig(process.cwd());
const path = process.argv[2];
if (!path) { console.error("Usage: npm run db:import-sqlite -- /path/to/old-shelfie.sqlite"); process.exitCode = 1; }
else importSqlite(path, process.env.DATABASE_URL).then(counts => {
  console.log("SQLite snapshot imported into PostgreSQL. Source file retained.");
  console.log(JSON.stringify(counts));
}).catch(() => {
  console.error("Import failed without overwriting existing data. Check the source, DATABASE_URL, and that the PostgreSQL target contains no Shelfie data. Credentials have not been printed.");
  process.exitCode = 1;
});
