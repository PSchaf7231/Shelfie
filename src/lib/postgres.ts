import { Pool, type PoolClient, type PoolConfig } from "pg";
import { IntakeError } from "./errors";

export type Queryable = Pick<PoolClient, "query">;
export function databaseOptions(connectionString: string | undefined): PoolConfig {
  let url: URL;
  try {
    if (!connectionString) throw new Error();
    url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error();
  } catch { throw new IntakeError("Database connection is not configured. Please try again later.", 503); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // Hosted connections verify both the certificate and host. Local test clusters
  // may use an unencrypted loopback connection. Never log the connection URL.
  if (!local) {
    url.searchParams.delete("ssl");
    url.searchParams.set("sslmode", "verify-full");
  }
  return { connectionString: url.toString(), max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 15000, allowExitOnIdle: true };
}

export class PostgresDatabase {
  readonly pool: Pool;
  private closed = false;
  constructor(connectionString: string | undefined) {
    this.pool = new Pool(databaseOptions(connectionString));
    // Idle connection errors must not crash the process or log credentials.
    // A subsequent operation fails through the same redacted error below.
    this.pool.on("error", () => {});
  }
  async read<T>(work: (database: Queryable) => Promise<T>): Promise<T> {
    try { return await work(this.pool); }
    catch (error) { throw this.failure(error); }
  }
  async transaction<T>(work: (database: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client) { try { await client.query("ROLLBACK"); } catch {} }
      throw this.failure(error);
    } finally { client?.release(); }
  }
  private failure(error: unknown) {
    return error instanceof IntakeError ? error : new IntakeError("Storage is temporarily unavailable. Please try again; reopening a completed report never uses another report.", 503);
  }
  async close() { if (!this.closed) { this.closed = true; await this.pool.end(); } }
}
