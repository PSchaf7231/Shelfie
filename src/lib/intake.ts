import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { ProductAnalysis } from "./ingredients/analyze";
import { isReportAnalysis, type CompletedReport } from "./report";
import { IntakeError } from "./errors";
import { PostgresDatabase, type Queryable } from "./postgres";
export { IntakeError } from "./errors";

export type Intake = { name: string; email: string; pregnancy: boolean; glp1: boolean };
export type StoredPhoto = { id: string; bytes: Buffer; width: number; height: number };
type Session = Omit<Intake, "pregnancy" | "glp1"> & { id: string; pregnancy: number; glp1: number; code_hash: string; expires: string; attempts: number; verified: number; created: string; used: boolean };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function validateIntake(value: unknown): Intake {
  if (!value || typeof value !== "object") throw new IntakeError("Please enter your name and email.");
  const data = value as Record<string, unknown>;
  if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 100) throw new IntakeError("Please enter a name of up to 100 characters.");
  if (typeof data.email !== "string" || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) throw new IntakeError("Please enter a valid email address.");
  if (typeof data.pregnancy !== "boolean" || typeof data.glp1 !== "boolean") throw new IntakeError("Please select your report preferences.");
  return { name: data.name.trim(), email: data.email.trim().toLowerCase(), pregnancy: data.pregnancy, glp1: data.glp1 };
}

export class IntakeStore {
  private database: PostgresDatabase;
  closed = false;
  constructor(connectionString: string | undefined) { this.database = new PostgresDatabase(connectionString); }
  async close() { if (!this.closed) { this.closed = true; await this.database.close(); } }
  private async session(database: Queryable, token: string, lock = false) {
    const result = await database.query<Session>(`SELECT s.*, EXISTS (SELECT 1 FROM reports r WHERE r.email = s.email) AS used FROM sessions s WHERE id = $1${lock ? " FOR UPDATE OF s" : ""}`, [hash(token)]);
    return result.rows[0];
  }
  private async statusOn(database: Queryable, token: string, now: number) {
    const session = await this.session(database, token);
    if (!session || Number(session.expires) <= now) return { state: "intake" as const };
    if (!session.verified) return { state: "pending" as const, email: session.email };
    return { state: "verified" as const, name: session.name, email: session.email, pregnancy: !!session.pregnancy, glp1: !!session.glp1, eligible: !session.used };
  }
  private async requireEligibleOn(database: Queryable, token: string, now: number) {
    const status = await this.statusOn(database, token, now);
    if (status.state !== "verified") throw new IntakeError("Verify your email first.", 401);
    if (!status.eligible) throw new IntakeError("This email has already received its free report.", 409);
    return status;
  }
  private async lockEmail(database: Queryable, token: string, now: number) {
    const status = await this.statusOn(database, token, now);
    if (status.state !== "verified") throw new IntakeError("Verify your email first.", 401);
    // Transaction locks work across Vercel instances and through transaction
    // poolers. Every email mutation rechecks eligibility after obtaining the lock.
    await database.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`shelfie:email:${status.email}`]);
  }
  async create(value: Intake, now = Date.now()) {
    const input = validateIntake(value);
    return this.database.transaction(async database => {
      // Preserve the shared hourly intake limit, including simultaneous requests.
      await database.query("SELECT pg_advisory_xact_lock(hashtextextended('shelfie:intake', 0))");
      await database.query("DELETE FROM sessions WHERE expires < $1", [now - 86400000]);
      const latest = (await database.query<{ created: string }>("SELECT created FROM sessions WHERE email = $1 ORDER BY created DESC LIMIT 1", [input.email])).rows[0];
      const recent = (await database.query<{ total: string }>("SELECT COUNT(*) AS total FROM sessions WHERE created > $1", [now - 3600000])).rows[0];
      const perEmail = (await database.query<{ total: string }>("SELECT COUNT(*) AS total FROM sessions WHERE email = $1 AND created > $2", [input.email, now - 3600000])).rows[0];
      if (latest && now - Number(latest.created) < 60000 || Number(perEmail.total) >= 5 || Number(recent.total) >= 100) throw new IntakeError("Please wait before requesting another code.", 429);
      const token = randomBytes(32).toString("hex");
      const code = randomInt(0, 1000000).toString().padStart(6, "0");
      await database.query("INSERT INTO sessions (id, name, email, pregnancy, glp1, code_hash, expires, created) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [hash(token), input.name, input.email, Number(input.pregnancy), Number(input.glp1), hash(token + code), now + 600000, now]);
      return { token, code };
    });
  }
  async discard(token: string) { await this.database.read(async database => { await database.query("DELETE FROM sessions WHERE id = $1", [hash(token)]); }); }
  async verify(token: string, code: string, now = Date.now()) {
    const result = await this.database.transaction<{ token: string } | { error: IntakeError }>(async database => {
      const session = await this.session(database, token, true);
      if (!session || Number(session.expires) <= now || session.verified || session.attempts >= 5) throw new IntakeError("This code has expired or was already used. Request a new code.");
      await database.query("UPDATE sessions SET attempts = attempts + 1 WHERE id = $1", [session.id]);
      const valid = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(session.code_hash, "hex"), Buffer.from(hash(token + code), "hex"));
      // Commit an incorrect attempt before returning its error; rolling it back
      // would allow an unlimited number of guesses across server instances.
      if (!valid) return { error: new IntakeError("That code didn’t match. Please check it and try again.") };
      const nextToken = randomBytes(32).toString("hex");
      await database.query("UPDATE sessions SET id = $1, verified = 1, code_hash = '', expires = $2 WHERE id = $3", [hash(nextToken), now + 86400000, session.id]);
      return { token: nextToken };
    });
    if ("error" in result) throw result.error;
    return result.token;
  }
  async status(token: string, now = Date.now()) { return this.database.read(database => this.statusOn(database, token, now)); }
  async requireEligible(token: string, now = Date.now()) { return this.database.read(database => this.requireEligibleOn(database, token, now)); }
  private async prunePhotos(database: Queryable, email: string, now: number) {
    // Cascading foreign keys remove expired photos and drafts atomically.
    await database.query("DELETE FROM photo_batches WHERE email = $1 AND expires <= $2", [email, now]);
    await database.query("DELETE FROM photo_attempts WHERE email = $1 AND started < $2", [email, now - 86400000]);
  }
  private async photoBatchOn(database: Queryable, token: string, now: number) {
    const { email } = await this.requireEligibleOn(database, token, now);
    await this.prunePhotos(database, email, now);
    const batch = (await database.query<{ revision: number }>("SELECT revision FROM photo_batches WHERE email = $1", [email])).rows[0];
    const photos = (await database.query<StoredPhoto>("SELECT id, bytes, width, height FROM photos WHERE email = $1 ORDER BY position", [email])).rows;
    return { revision: batch?.revision ?? 0, photos: photos.map(photo => ({ ...photo, bytes: Buffer.from(photo.bytes) })) };
  }
  async photoBatch(token: string, now = Date.now()) {
    return this.database.transaction(async database => { await this.lockEmail(database, token, now); return this.photoBatchOn(database, token, now); });
  }
  async photoAttempt(token: string, now = Date.now()) {
    await this.database.transaction(async database => {
      await this.lockEmail(database, token, now);
      const { email } = await this.requireEligibleOn(database, token, now);
      const row = (await database.query<{ started: string; total: number }>("SELECT started, total FROM photo_attempts WHERE email = $1", [email])).rows[0];
      const current = row && now - Number(row.started) < 60000;
      if (current && row.total >= 10) throw new IntakeError("Please wait a minute before checking more photos.", 429);
      await database.query("INSERT INTO photo_attempts (email, started, total) VALUES ($1, $2, $3) ON CONFLICT(email) DO UPDATE SET started = excluded.started, total = excluded.total", [email, current ? Number(row.started) : now, current ? row.total + 1 : 1]);
    });
  }
  async savePhotos(token: string, revision: number, images: { bytes: Buffer; width: number; height: number }[], now = Date.now()) {
    if (!images.length || images.length > 6) throw new IntakeError("Choose between one and six photos of this product.");
    return this.database.transaction(async database => {
      await this.lockEmail(database, token, now);
      const { email } = await this.requireEligibleOn(database, token, now);
      const current = await this.photoBatchOn(database, token, now);
      if (current.revision !== revision) throw new IntakeError("Your photos changed in another tab. Refresh before trying again.", 409);
      await database.query("DELETE FROM photos WHERE email = $1", [email]);
      await database.query("DELETE FROM ingredient_drafts WHERE email = $1", [email]);
      await database.query("INSERT INTO photo_batches (email, revision, expires) VALUES ($1, $2, $3) ON CONFLICT(email) DO UPDATE SET revision = excluded.revision, expires = excluded.expires", [email, revision + 1, now + 86400000]);
      for (let position = 0; position < images.length; position++) {
        const image = images[position];
        await database.query("INSERT INTO photos (id, email, bytes, width, height, position) VALUES ($1, $2, $3, $4, $5, $6)", [randomUUID(), email, image.bytes, image.width, image.height, position]);
      }
      return this.photoBatchOn(database, token, now);
    });
  }
  async sharePhotoReview(token: string, images: { bytes: Buffer; width: number; height: number }[], reason: string, now = Date.now()) {
    if (!reason.trim() || reason.length > 400 || !images.length || images.length > 6 || images.some(image => !image.bytes.length || image.bytes.length > 600000 || image.width < 1 || image.height < 1 || image.width > 1600 || image.height > 1600)) throw new IntakeError("Choose up to six label photos to share for review.");
    return this.database.transaction(async database => {
      await this.lockEmail(database, token, now);
      const { email } = await this.requireEligibleOn(database, token, now);
      await database.query("DELETE FROM photo_reviews WHERE expires <= $1", [now]);
      const count = (await database.query<{ total: string }>("SELECT COUNT(*) AS total FROM photo_reviews WHERE email = $1", [email])).rows[0];
      if (Number(count.total) >= 3) throw new IntakeError("You’ve already shared three photo checks for review today. Please keep their reference numbers.", 429);
      const reference = randomUUID(), expiresAt = now + 86400000;
      await database.query("INSERT INTO photo_reviews (id, email, reason, consent_version, created, expires) VALUES ($1, $2, $3, 'photo-review-v1', $4, $5)", [reference, email, reason.trim(), now, expiresAt]);
      for (let position = 0; position < images.length; position++) {
        const image = images[position];
        await database.query("INSERT INTO photo_review_images (review_id, position, bytes, width, height) VALUES ($1, $2, $3, $4, $5)", [reference, position, image.bytes, image.width, image.height]);
      }
      return { reference, expiresAt };
    });
  }
  async deletePhotoReview(token: string, reference: string, now = Date.now()) {
    if (!/^[a-f0-9-]{36}$/.test(reference)) throw new IntakeError("This review reference is invalid.");
    await this.database.transaction(async database => {
      await this.lockEmail(database, token, now);
      const status = await this.statusOn(database, token, now);
      if (status.state !== "verified") throw new IntakeError("Verify your email first.", 401);
      await database.query("DELETE FROM photo_reviews WHERE id = $1 AND email = $2", [reference, status.email]);
    });
  }
  private async ingredientAnalysisOn(database: Queryable, token: string, revision: number, catalogVersion: string, now: number): Promise<ProductAnalysis | null> {
    const session = await this.requireEligibleOn(database, token, now);
    const batch = await this.photoBatchOn(database, token, now);
    if (!batch.photos.length || batch.revision !== revision) throw new IntakeError("Your label photos changed or expired. Please check them again.", 409);
    const modes = JSON.stringify({ pregnancy: session.pregnancy, glp1: session.glp1 });
    const row = (await database.query<{ content: ProductAnalysis }>("SELECT content FROM ingredient_drafts WHERE email = $1 AND revision = $2 AND modes = $3::jsonb AND catalog_version = $4", [session.email, revision, modes, catalogVersion])).rows[0];
    return row?.content ?? null;
  }
  async ingredientAnalysis(token: string, revision: number, catalogVersion: string, now = Date.now()) {
    return this.database.transaction(async database => { await this.lockEmail(database, token, now); return this.ingredientAnalysisOn(database, token, revision, catalogVersion, now); });
  }
  async saveIngredientAnalysis(token: string, revision: number, analysis: ProductAnalysis, now = Date.now()) {
    await this.database.transaction(async database => {
      await this.lockEmail(database, token, now);
      const session = await this.requireEligibleOn(database, token, now);
      const batch = await this.photoBatchOn(database, token, now);
      if (!batch.photos.length || batch.revision !== revision) throw new IntakeError("Your label photos changed while they were being read. Please try again.", 409);
      if (analysis.modes.pregnancy !== session.pregnancy || analysis.modes.glp1 !== session.glp1) throw new IntakeError("Your report preferences changed. Please try again.", 409);
      await database.query("INSERT INTO ingredient_drafts (email, revision, modes, catalog_version, content) VALUES ($1, $2, $3::jsonb, $4, $5::jsonb) ON CONFLICT(email) DO UPDATE SET revision = excluded.revision, modes = excluded.modes, catalog_version = excluded.catalog_version, content = excluded.content", [session.email, revision, JSON.stringify(analysis.modes), analysis.catalogVersion, JSON.stringify(analysis)]);
    });
  }
  private async getReportOn(database: Queryable, token: string, now: number): Promise<CompletedReport | null> {
    const session = await this.statusOn(database, token, now);
    if (session.state !== "verified") throw new IntakeError("Verify your email first.", 401);
    const row = (await database.query<{ report_id: string; content: unknown; completed: string }>("SELECT report_id, content, completed FROM reports WHERE email = $1", [session.email])).rows[0];
    if (!row) return null;
    if (!isReportAnalysis(row.content)) throw new IntakeError("We couldn’t open your saved report. Please try again; no additional report is used.", 503);
    return { id: row.report_id, completed: Number(row.completed), analysis: row.content };
  }
  async getReport(token: string, now = Date.now()) { return this.database.read(database => this.getReportOn(database, token, now)); }
  async completeIngredientReport(token: string, revision: number, catalogVersion: string, now = Date.now()): Promise<CompletedReport> {
    return this.database.transaction(async database => {
      await this.lockEmail(database, token, now);
      const existing = await this.getReportOn(database, token, now);
      if (existing) return existing;
      const session = await this.requireEligibleOn(database, token, now);
      const analysis = await this.ingredientAnalysisOn(database, token, revision, catalogVersion, now);
      if (!analysis) throw new IntakeError("Read your current label photos before opening the report.", 409);
      if (!isReportAnalysis(analysis) || analysis.catalogVersion !== catalogVersion) throw new IntakeError("The ingredient draft is incomplete. Please read your label photos again; your free report is unchanged.", 503);
      const report = { id: randomUUID(), completed: now, analysis };
      await database.query("INSERT INTO reports (email, report_id, content, completed) VALUES ($1, $2, $3::jsonb, $4)", [session.email, report.id, JSON.stringify(analysis), now]);
      return report;
    });
  }
  // Server-only hook retained for trusted completion callers; never accepts a
  // client-supplied report. The report API uses completeIngredientReport above.
  async completeReport(token: string, reportId: string, content: Record<string, unknown>, now = Date.now()) {
    if (!reportId.trim() || !content || !Object.keys(content).length) throw new IntakeError("A completed report is required.");
    await this.database.transaction(async database => {
      await this.lockEmail(database, token, now);
      const session = await this.requireEligibleOn(database, token, now);
      await database.query("INSERT INTO reports (email, report_id, content, completed) VALUES ($1, $2, $3::jsonb, $4)", [session.email, reportId, JSON.stringify(content), now]);
    });
  }
}

let store: IntakeStore | undefined;
let configuredUrl: string | undefined;
export function intakeStore() {
  const url = process.env.DATABASE_URL;
  if (!store || store.closed || url !== configuredUrl) { store = new IntakeStore(url); configuredUrl = url; }
  return store;
}
