import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { testDatabase } from './helpers/postgres';
import { intakeStore } from '../src/lib/intake';
import { PostgresDatabase } from '../src/lib/postgres';
import { prepareReviewPhoto } from '../src/lib/photo-review';
import { preparePhoto } from '../src/lib/photo-quality';
import { POST, DELETE } from '../src/app/api/photo-reviews/route';

test('review sharing requires verification and explicit consent, preserves rejected photos privately, and never calls a provider or uses a report', async () => {
  const fixture = await testDatabase();
  const previous = process.env.DATABASE_URL, previousFetch = globalThis.fetch;
  process.env.DATABASE_URL = fixture.url;
  const store = intakeStore(), inspect = new PostgresDatabase(fixture.url);
  globalThis.fetch = async () => { throw new Error('Review sharing must not contact a provider'); };
  const dark = await sharp({ create: { width: 900, height: 700, channels: 3, background: 'black' } }).withExif({ IFD0: { Artist: 'Private fixture metadata' } }).jpeg().toBuffer();
  const create = async (email: string) => {
    const pending = await store.create({ name: 'Review tester', email, pregnancy: false, glp1: false });
    return store.verify(pending.token, pending.code);
  };
  const request = (token: string, consent = false, origin = 'http://localhost', existingIds: string[] = [], revision = 0) => {
    const body = new FormData();
    body.set('revision', String(revision)); body.set('existingIds', JSON.stringify(existingIds));
    body.set('reviewReason', 'Photo 1 is too dark.');
    if (consent) body.set('reviewConsent', 'photo-review-v1');
    body.append('photos', new Blob([new Uint8Array(dark)], { type: 'image/jpeg' }), 'label.jpg');
    return new NextRequest('http://localhost/api/photo-reviews', { method: 'POST', headers: { host: 'localhost', origin, cookie: `shelfie_session=${token}` }, body });
  };
  const deletion = (token: string, reference: string) => new NextRequest('http://localhost/api/photo-reviews', { method: 'DELETE', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', cookie: `shelfie_session=${token}` }, body: JSON.stringify({ reference }) });
  try {
    const token = await create('review-owner@example.com'), other = await create('review-other@example.com');
    assert.equal((await POST(request('', true))).status, 401);
    assert.equal((await POST(request(token))).status, 400);
    assert.equal((await POST(request(token, true, 'https://elsewhere.example'))).status, 403);
    assert.equal(await inspect.read(async db => (await db.query('SELECT COUNT(*) AS count FROM photo_reviews')).rows[0].count), '0');
    await assert.rejects(preparePhoto(dark), /dark/);
    const response = await POST(request(token, true));
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/);
    const review = await response.json(); assert.match(review.reference, /^[a-f0-9-]{36}$/);
    const stored = await inspect.read(async db => (await db.query('SELECT r.consent_version, r.reason, p.bytes FROM photo_reviews r JOIN photo_review_images p ON p.review_id=r.id WHERE r.id=$1', [review.reference])).rows[0]);
    assert.equal(stored.consent_version, 'photo-review-v1'); assert.equal(stored.reason, 'Photo 1 is too dark.');
    assert.equal((await sharp(stored.bytes).metadata()).exif, undefined);
    assert.equal((await store.requireEligible(token)).eligible, true);
    assert.equal((await store.photoBatch(token)).revision, 0);
    assert.equal((await DELETE(deletion(other, review.reference))).status, 200);
    assert.equal(await inspect.read(async db => (await db.query('SELECT COUNT(*) AS count FROM photo_reviews')).rows[0].count), '1');
    await store.savePhotos(other, 0, [{ bytes: dark, width: 900, height: 700 }]);
    const foreignId = (await store.photoBatch(other)).photos[0].id;
    assert.equal((await POST(request(token, true, 'http://localhost', [foreignId]))).status, 400);
    await store.completeReport(token, 'review-owner-report', { products: [{}] });
    assert.equal((await DELETE(deletion(token, review.reference))).status, 200);
    assert.equal(await inspect.read(async db => (await db.query('SELECT COUNT(*) AS count FROM photo_review_images')).rows[0].count), '0');
    assert.equal((await store.status(token)).state, 'verified');
  } finally {
    globalThis.fetch = previousFetch; await store.close(); await inspect.close(); await fixture.cleanup();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('review copies have a bounded daily limit and expired reviews are purged with their images', async () => {
  const fixture = await testDatabase(), store = fixture.connect(), inspect = new PostgresDatabase(fixture.url);
  try {
    const pending = await store.create({ name: 'Tester', email: 'bounded-reviews@example.com', pregnancy: false, glp1: false });
    const token = await store.verify(pending.token, pending.code);
    const image = await prepareReviewPhoto(await sharp({ create: { width: 1000, height: 800, channels: 3, background: 'black' } }).jpeg().toBuffer());
    const first = await store.sharePhotoReview(token, [image], 'A blurry label');
    await store.sharePhotoReview(token, [image], 'A second label'); await store.sharePhotoReview(token, [image], 'A third label');
    await assert.rejects(store.sharePhotoReview(token, [image], 'Another label'), /three photo checks/);
    await inspect.read(async db => { await db.query('UPDATE photo_reviews SET created=created-172800000, expires=expires-172800000'); });
    const fresh = await store.sharePhotoReview(token, [image], 'A new check after expiry');
    assert.notEqual(fresh.reference, first.reference);
    assert.equal(await inspect.read(async db => (await db.query('SELECT COUNT(*) AS count FROM photo_reviews')).rows[0].count), '1');
    assert.equal(await inspect.read(async db => (await db.query('SELECT COUNT(*) AS count FROM photo_review_images')).rows[0].count), '1');
    assert.equal((await store.requireEligible(token)).eligible, true);
  } finally { await inspect.close(); await fixture.cleanup(); }
});

test('review decoding bounds images and strips metadata without rejecting the blur or darkness under investigation', async () => {
  const dark = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: 'black' } }).withExif({ IFD0: { Artist: 'Private' } }).jpeg().toBuffer();
  const prepared = await prepareReviewPhoto(dark);
  assert.ok(Math.max(prepared.width, prepared.height) <= 1600); assert.ok(prepared.bytes.length <= 600000);
  assert.equal((await sharp(prepared.bytes).metadata()).exif, undefined);
  await assert.rejects(prepareReviewPhoto(Buffer.from('invalid image')), /couldn’t open/);
  await assert.rejects(prepareReviewPhoto(Buffer.alloc(6 * 1024 * 1024 + 1)), /too large/);
});
