import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { testDatabase } from './helpers/postgres';
import { IntakeStore, IntakeError } from '../src/lib/intake';
import { PostgresDatabase, databaseOptions } from '../src/lib/postgres';
import { analyzeIngredients } from '../src/lib/ingredients/analyze';
import { CATALOG_VERSION } from '../src/lib/ingredients/catalog';
import { migrateDatabase } from '../scripts/database';

const now = 1800000000000;
const input = { name: 'Ada', email: 'postgres@example.com', pregnancy: true, glp1: true };
const photo = { bytes: Buffer.from('first private photo'), width: 900, height: 1000 };
const label = { rawText: 'Aqua, Retinol', complete: true, certain: true, confidence: 0.99, ingredients: [{ text: 'Aqua', confidence: 0.99 }, { text: 'Retinol', confidence: 0.99 }] };
const analysis = () => analyzeIngredients(label, { pregnancy: true, glp1: true });

test('independent PostgreSQL pools complete simultaneously but save exactly one immutable report per normalized email', async () => {
  const fixture = await testDatabase(); const inspect = new PostgresDatabase(fixture.url);
  try {
    const a = fixture.connect(), b = fixture.connect();
    const pendingA = await a.create({ ...input, email: ' POSTGRES@EXAMPLE.COM ' }, now);
    const tokenA = await a.verify(pendingA.token, pendingA.code, now);
    const pendingB = await b.create(input, now + 60001);
    const tokenB = await b.verify(pendingB.token, pendingB.code, now + 60001);
    await a.savePhotos(tokenA, 0, [photo], now);
    await a.saveIngredientAnalysis(tokenA, 1, analysis(), now);
    const reports = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).completeIngredientReport(i % 2 ? tokenA : tokenB, 1, CATALOG_VERSION, now + 60001)));
    assert.equal(new Set(reports.map(report => report.id)).size, 1);
    await inspect.read(async db => {
      assert.equal((await db.query('SELECT COUNT(*) AS total FROM reports')).rows[0].total, '1');
      assert.equal((await db.query('SELECT email FROM reports')).rows[0].email, input.email);
    });
    await assert.rejects(a.requireEligible(tokenA, now + 60001), /already/);
    await a.close(); await b.close();
    assert.deepEqual(await fixture.connect().getReport(tokenB, now + 60001), reports[0]);
  } finally { await inspect.close(); await fixture.cleanup(); }
});

test('database constraints reject a second or non-normalized report even when application locks are bypassed', async () => {
  const fixture = await testDatabase(); const database = new PostgresDatabase(fixture.url);
  try {
    await database.read(async db => { await db.query('INSERT INTO reports (email, report_id, content, completed) VALUES ($1,$2,$3::jsonb,$4)', [input.email, 'first-report', JSON.stringify(analysis()), now]); });
    for (const address of [input.email, ' POSTGRES@EXAMPLE.COM ']) {
      await assert.rejects(database.transaction(async db => { await db.query('INSERT INTO reports (email, report_id, content, completed) VALUES ($1,$2,$3::jsonb,$4)', [address, 'second-report', JSON.stringify(analysis()), now]); }), error => error instanceof IntakeError && error.status === 503);
    }
    await database.read(async db => { assert.equal((await db.query('SELECT COUNT(*) AS total FROM reports')).rows[0].total, '1'); });
  } finally { await database.close(); await fixture.cleanup(); }
});

test('simultaneous retakes cannot overwrite one another and a retake racing completion has only one winner', async () => {
  const fixture = await testDatabase();
  try {
    const a = fixture.connect(), b = fixture.connect();
    const pending = await a.create(input, now); const token = await a.verify(pending.token, pending.code, now);
    await a.savePhotos(token, 0, [photo], now);
    const retakes = await Promise.allSettled([a.savePhotos(token, 1, [photo], now), b.savePhotos(token, 1, [photo], now)]);
    assert.equal(retakes.filter(result => result.status === 'fulfilled').length, 1);
    const refused = retakes.find(result => result.status === 'rejected');
    assert.ok(refused?.status === 'rejected' && refused.reason.status === 409);
    assert.equal((await a.photoBatch(token, now)).revision, 2);
    assert.equal((await a.requireEligible(token, now)).eligible, true);
    await a.saveIngredientAnalysis(token, 2, analysis(), now);
    const [report, retake] = await Promise.allSettled([a.completeIngredientReport(token, 2, CATALOG_VERSION, now), b.savePhotos(token, 2, [photo], now)]);
    assert.equal(Number(report.status === 'fulfilled') + Number(retake.status === 'fulfilled'), 1);
    if (report.status === 'fulfilled') {
      assert.deepEqual(await b.getReport(token, now), report.value);
      assert.ok(retake.status === 'rejected' && retake.reason.status === 409);
      await assert.rejects(b.requireEligible(token, now), /already/);
    } else {
      assert.equal(report.reason.status, 409);
      assert.equal((await a.requireEligible(token, now)).eligible, true);
      assert.equal(await a.getReport(token, now), null);
    }
  } finally { await fixture.cleanup(); }
});

test('a database failure midway through photo replacement rolls back photos, revision and draft without consuming a report', async () => {
  const fixture = await testDatabase();
  try {
    const store = fixture.connect(); const pending = await store.create(input, now);
    const token = await store.verify(pending.token, pending.code, now);
    const original = await store.savePhotos(token, 0, [photo], now);
    const draft = analysis(); await store.saveIngredientAnalysis(token, 1, draft, now);
    await assert.rejects(store.savePhotos(token, 1, [{ ...photo, width: 0 }], now), error => error instanceof IntakeError && error.status === 503);
    assert.deepEqual(await store.photoBatch(token, now), original);
    assert.deepEqual(await store.ingredientAnalysis(token, 1, CATALOG_VERSION, now), draft);
    assert.equal((await store.requireEligible(token, now)).eligible, true);
    assert.equal(await store.getReport(token, now), null);
  } finally { await fixture.cleanup(); }
});

test('verification attempts, photo-check limits and intake cooldowns are shared across concurrent PostgreSQL pools', async () => {
  const fixture = await testDatabase(); const inspect = new PostgresDatabase(fixture.url);
  try {
    const a = fixture.connect(), b = fixture.connect();
    const starts = await Promise.allSettled([a.create(input, now), b.create({ ...input, email: ' POSTGRES@EXAMPLE.COM ' }, now)]);
    assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1);
    const started = starts.find(result => result.status === 'fulfilled'); assert.ok(started?.status === 'fulfilled');
    const pending = started.value;
    const wrong = pending.code === '000000' ? '000001' : '000000';
    const guesses = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).verify(pending.token, wrong, now)));
    assert.ok(guesses.every(result => result.status === 'rejected'));
    await assert.rejects(b.verify(pending.token, pending.code, now), /expired/);
    await inspect.read(async db => { assert.equal((await db.query('SELECT attempts FROM sessions WHERE id = $1', [createHash('sha256').update(pending.token).digest('hex')])).rows[0].attempts, 5); });
    const next = await a.create({ ...input, email: 'checks@example.com' }, now);
    const token = await a.verify(next.token, next.code, now);
    const checks = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => (i % 2 ? a : b).photoAttempt(token, now)));
    assert.equal(checks.filter(result => result.status === 'fulfilled').length, 10);
    assert.ok(checks.filter(result => result.status === 'rejected').every(result => result.reason.status === 429));
    assert.equal((await b.requireEligible(token, now)).eligible, true);
  } finally { await inspect.close(); await fixture.cleanup(); }
});

test('PostgreSQL migrations can repeat and run concurrently without deleting saved data', async () => {
  const fixture = await testDatabase(); const inspect = new PostgresDatabase(fixture.url);
  try {
    const store = fixture.connect(); const pending = await store.create(input, now);
    const token = await store.verify(pending.token, pending.code, now);
    await store.savePhotos(token, 0, [photo], now); await store.saveIngredientAnalysis(token, 1, analysis(), now);
    const report = await store.completeIngredientReport(token, 1, CATALOG_VERSION, now);
    await Promise.all(Array.from({ length: 4 }, () => migrateDatabase(fixture.url)));
    assert.deepEqual(await store.getReport(token, now), report);
    await inspect.read(async db => { assert.equal((await db.query('SELECT COUNT(*) AS total FROM schema_migrations')).rows[0].total, '1'); });
  } finally { await inspect.close(); await fixture.cleanup(); }
});

test('missing or unavailable PostgreSQL fails closed with redacted errors; hosted connections verify TLS', async () => {
  assert.throws(() => new IntakeStore(undefined), error => error instanceof IntakeError && error.status === 503);
  const remote = new URL(String(databaseOptions('postgresql://fixture-user:fixture-secret@db.example.invalid/shelfie?sslmode=disable&ssl=0').connectionString));
  assert.equal(remote.searchParams.get('sslmode'), 'verify-full'); assert.equal(remote.searchParams.has('ssl'), false);
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const url = new URL(`postgresql://127.0.0.1:${address.port}/unavailable`); url.username = 'fixture-user'; url.password = 'fixture-secret';
  const store = new IntakeStore(url.toString());
  try {
    await assert.rejects(store.requireEligible('fixture-token'), error => {
      assert.ok(error instanceof IntakeError); assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /fixture-secret|fixture-user|postgresql:|127\.0\.0\.1/);
      return true;
    });
  } finally { await store.close(); }
});
