import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { addLabelPhotos, photoBatchResponse, readPhotoResponse } from '../src/lib/photo-client';
import { MAX_PHOTOS, MAX_PREPARED_PHOTO_BYTES, MAX_UPLOAD_BYTES } from '../src/lib/photo-limits';
import { photoForm } from '../src/lib/photo-upload';

const photo = () => ({ id: randomUUID(), url: 'blob:local-test' });
const fallback = 'We couldn’t check your photos. Your photos are still here. Please try again.';

test('plaintext hosting errors become actionable messages, never raw parser errors', async () => {
  await assert.rejects(readPhotoResponse(new Response('Request Entity Too Large', { status: 413 }), fallback), error => {
    assert.match((error as Error).message, /too large to send together/);
    assert.doesNotMatch((error as Error).message, /Unexpected token|JSON/);
    return true;
  });
  for (const status of [200, 502, 504]) await assert.rejects(readPhotoResponse(new Response('<html>Gateway error</html>', { status }), fallback), { message: fallback });
  await assert.rejects(readPhotoResponse(Response.json({ error: 'Unexpected token R is not valid JSON' }, { status: 500 }), fallback), { message: fallback });
  await assert.rejects(readPhotoResponse(Response.json({ error: 'Photo 2 is too dark. Retake it in bright, even light.' }, { status: 422 }), fallback), /Photo 2 is too dark/);
});

test('adding angles preserves earlier photos and retaking replaces only its selected slot', () => {
  const first = photo(), second = photo(), third = photo();
  const two = addLabelPhotos(addLabelPhotos([], [first]), [second]);
  assert.deepEqual(two, [first, second]);
  assert.deepEqual(addLabelPhotos(two, [third], first.id), [third, second]);
  assert.deepEqual(two, [first, second]);
  assert.throws(() => addLabelPhotos(two, [third], 'missing'), /retake/);
  const six = Array.from({ length: MAX_PHOTOS }, photo);
  assert.throws(() => addLabelPhotos(six, [third]), /six photos/);
  assert.equal(six.length, MAX_PHOTOS);
});

test('malformed successful photo responses cannot erase the selected photos or unlock a report', () => {
  const id = randomUUID();
  const batch = { revision: 1, draftKey: 'a'.repeat(64), photos: [{ id, url: `/api/photos/${id}` }] };
  assert.equal(photoBatchResponse(batch, fallback).photos.length, 1);
  for (const bad of [{}, { ...batch, photos: null }, { ...batch, draftKey: '' }, { ...batch, photos: [{ id, url: 'https://example.com/photo' }] }, { ...batch, photos: [batch.photos[0], batch.photos[0]] }]) {
    assert.throws(() => photoBatchResponse(bad, fallback), { message: fallback });
  }
});

test('six prepared photos fit the total request budget including multipart metadata', async () => {
  const body = new FormData();
  body.set('revision', '0'); body.set('existingIds', '[]');
  for (let i = 0; i < MAX_PHOTOS; i++) body.append('photos', new Blob([new Uint8Array(MAX_PREPARED_PHOTO_BYTES)], { type: 'image/jpeg' }), 'ingredient-label.jpg');
  const request = new Request('http://localhost/api/photos', { method: 'POST', body });
  const bytes = await request.clone().arrayBuffer();
  assert.ok(bytes.byteLength < MAX_UPLOAD_BYTES);
  const parsed = await photoForm(request);
  assert.equal(parsed.files.length, MAX_PHOTOS);
});

test('the server bounds declared and streamed upload bodies before image checks', async () => {
  const over = MAX_UPLOAD_BYTES + 1;
  const declared = new Request('http://localhost/api/photos', { method: 'POST', headers: { 'content-length': String(over) }, body: 'ignored' });
  await assert.rejects(photoForm(declared), error => (error as { status: number }).status === 413);
  const streamed = new Request('http://localhost/api/photos', { method: 'POST', body: new Uint8Array(over) });
  await assert.rejects(photoForm(streamed), error => (error as { status: number }).status === 413);
});
