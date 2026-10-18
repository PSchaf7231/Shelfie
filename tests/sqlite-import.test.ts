import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { testDatabase } from './helpers/postgres';
import { importSqlite } from '../scripts/sqlite-import';
import { analyzeIngredients } from '../src/lib/ingredients/analyze';
import { CATALOG_VERSION } from '../src/lib/ingredients/catalog';
import { PostgresDatabase } from '../src/lib/postgres';

const now = 1800000000000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const schema = `CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, email TEXT, pregnancy INTEGER, glp1 INTEGER, code_hash TEXT, expires INTEGER, attempts INTEGER, verified INTEGER, created INTEGER);
CREATE TABLE reports (email TEXT PRIMARY KEY, report_id TEXT, content TEXT, completed INTEGER);
CREATE TABLE photo_batches (email TEXT PRIMARY KEY, revision INTEGER, expires INTEGER);
CREATE TABLE photos (id TEXT PRIMARY KEY, email TEXT, bytes BLOB, width INTEGER, height INTEGER);
CREATE TABLE photo_attempts (email TEXT PRIMARY KEY, started INTEGER, total INTEGER);
CREATE TABLE ingredient_drafts (email TEXT PRIMARY KEY, revision INTEGER, modes TEXT, catalog_version TEXT, content TEXT);`;
function reportAnalysis() { return analyzeIngredients({ rawText: 'Cetyl Alcohol', complete: true, certain: true, confidence: 0.99, ingredients: [{ text: 'Cetyl Alcohol', confidence: 0.99 }] }, { pregnancy: false, glp1: false }); }

test('SQLite import preserves completed reports, used credits, verification hashes, photo order and unfinished drafts without changing the source', async () => {
  const fixture = await testDatabase(); const dir = mkdtempSync(join(tmpdir(), 'shelfie-import-test-'));
  const path = join(dir, 'old.sqlite'); const source = new DatabaseSync(path);
  try {
    source.exec(schema); const analysis = reportAnalysis();
    const usedToken = randomBytes(32).toString('hex'), activeToken = randomBytes(32).toString('hex'), pendingToken = randomBytes(32).toString('hex');
    const code = '123456';
    const add = source.prepare('INSERT INTO sessions VALUES (?, ?, ?, 0, 0, ?, ?, 0, ?, ?)');
    add.run(hash(usedToken), 'Ada', 'used@example.com', '', now + 86400000, 1, now);
    add.run(hash(activeToken), 'Ada', 'active@example.com', '', now + 86400000, 1, now);
    add.run(hash(pendingToken), 'Ada', 'pending@example.com', hash(pendingToken + code), now + 600000, 0, now);
    source.prepare('INSERT INTO reports VALUES (?, ?, ?, ?)').run('used@example.com', 'original-report', JSON.stringify(analysis), now);
    source.prepare('INSERT INTO photo_batches VALUES (?, ?, ?)').run('active@example.com', 3, now + 86400000);
    const insert = source.prepare('INSERT INTO photos VALUES (?, ?, ?, ?, ?)');
    insert.run('photo-first', 'active@example.com', Buffer.from('first'), 900, 1000);
    insert.run('photo-second', 'active@example.com', Buffer.from('second'), 900, 1000);
    source.prepare('INSERT INTO ingredient_drafts VALUES (?, ?, ?, ?, ?)').run('active@example.com', 3, JSON.stringify(analysis.modes), CATALOG_VERSION, JSON.stringify(analysis));
    source.prepare('INSERT INTO photo_attempts VALUES (?, ?, ?)').run('active@example.com', now, 2);
    const counts = await importSqlite(path, fixture.url);
    assert.deepEqual(counts, { sessions: 3, reports: 1, photo_batches: 1, photos: 2, photo_attempts: 1, ingredient_drafts: 1 });
    const store = fixture.connect();
    assert.equal((await store.getReport(usedToken, now))?.id, 'original-report');
    await assert.rejects(store.requireEligible(usedToken, now), /already/);
    assert.deepEqual((await store.photoBatch(activeToken, now)).photos.map(photo => photo.bytes.toString()), ['first', 'second']);
    assert.deepEqual(await store.ingredientAnalysis(activeToken, 3, CATALOG_VERSION, now), analysis);
    assert.equal((await store.requireEligible(activeToken, now)).eligible, true);
    const verified = await store.verify(pendingToken, code, now);
    assert.equal((await store.requireEligible(verified, now)).eligible, true);
    assert.equal((source.prepare('SELECT COUNT(*) AS total FROM reports').get() as { total: number }).total, 1);
    assert.equal((source.prepare('SELECT verified FROM sessions WHERE id = ?').get(hash(pendingToken)) as { verified: number }).verified, 0);
    await assert.rejects(importSqlite(path, fixture.url), /already contains/);
    assert.equal((await store.getReport(usedToken, now))?.id, 'original-report');
  } finally { source.close(); await fixture.cleanup(); rmSync(dir, { recursive: true, force: true }); }
});

test('a conflicting SQLite import rolls back all inserted data instead of picking a report or resetting an email credit', async () => {
  const fixture = await testDatabase(); const dir = mkdtempSync(join(tmpdir(), 'shelfie-import-conflict-'));
  const path = join(dir, 'old.sqlite'); const source = new DatabaseSync(path); const inspect = new PostgresDatabase(fixture.url);
  try {
    source.exec(schema);
    const report = JSON.stringify(reportAnalysis());
    const insert = source.prepare('INSERT INTO reports VALUES (?, ?, ?, ?)');
    insert.run('used@example.com', 'report-one', report, now);
    insert.run(' USED@EXAMPLE.COM ', 'report-two', report, now);
    await assert.rejects(importSqlite(path, fixture.url), /temporarily unavailable/);
    await inspect.read(async db => { assert.equal((await db.query('SELECT COUNT(*) AS total FROM reports')).rows[0].total, '0'); });
    assert.equal((source.prepare('SELECT COUNT(*) AS total FROM reports').get() as { total: number }).total, 2);
  } finally { source.close(); await inspect.close(); await fixture.cleanup(); rmSync(dir, { recursive: true, force: true }); }
});
