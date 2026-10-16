import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function main() {
  let connectionString = process.env.SHELFIE_TEST_DATABASE_URL;
  let cluster: EmbeddedPostgres | undefined;
  let directory: string | undefined;
  try {
    if (!connectionString) {
      directory = mkdtempSync(join(tmpdir(), "shelfie-postgres-tests-"));
      const port = await freePort();
      const user = "shelfie_test";
      const password = randomBytes(24).toString("hex");
      cluster = new EmbeddedPostgres({ databaseDir: join(directory, "cluster"), user, password, port, persistent: false, authMethod: "scram-sha-256", postgresFlags: ["-h", "127.0.0.1"], onLog: () => {}, onError: () => {} });
      await cluster.initialise(); await cluster.start();
      const url = new URL(`postgresql://127.0.0.1:${port}/postgres`);
      url.username = user; url.password = password;
      connectionString = url.toString();
    }
    console.log("Running all tests against PostgreSQL with isolated test schemas.");
    const files = readdirSync("tests").filter(file => /\.test\.tsx?$/.test(file)).sort().map(file => join("tests", file));
    const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit", env: { ...process.env, SHELFIE_TEST_DATABASE_URL: connectionString } });
    process.exitCode = await new Promise<number>(resolve => { child.once("error", () => resolve(1)); child.once("exit", code => resolve(code ?? 1)); });
  } finally { if (cluster) await cluster.stop(); if (directory) rmSync(directory, { recursive: true, force: true }); }
}
main().catch(() => { console.error("PostgreSQL test setup failed. Supply SHELFIE_TEST_DATABASE_URL for a separate test database if a local cluster cannot run."); process.exitCode = 1; });
