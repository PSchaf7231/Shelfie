import { loadEnvConfig } from "@next/env";
import { migrateDatabase } from "./database";
loadEnvConfig(process.cwd());
migrateDatabase(process.env.DATABASE_URL).then(() => {
  console.log("PostgreSQL schema is ready.");
}).catch(() => {
  console.error("Database setup failed. Check DATABASE_URL, database availability, and migration permissions; credentials have not been printed.");
  process.exitCode = 1;
});
