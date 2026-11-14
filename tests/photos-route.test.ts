import { testDatabase } from './helpers/postgres';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { intakeStore } from '../src/lib/intake';
import { POST, GET } from '../src/app/api/photos/route';
import { GET as getPhoto } from '../src/app/api/photos/[id]/route';
const svg = '<svg width="1000" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="800" fill="white"/>' + Array.from({ length: 12 }, (_, i) => `<rect x="100" y="${80 + i * 48}" width="${600 - i * 15}" height="10" fill="black"/>`).join('') + '</svg>';
test('upload authorizes and saves decodable photos without a separate AI rejection gate', async () => {
    const fixture = await testDatabase();
    const before = { path: process.env.DATABASE_URL, key: process.env.LABEL_READER_API_KEY, fetch: globalThis.fetch };
    process.env.DATABASE_URL = fixture.url;
    process.env.LABEL_READER_API_KEY = 'fixture-placeholder';
    const store = intakeStore();
    const input = { name: 'Ada', email: 'route@example.com', pregnancy: true, glp1: false };
    const pending = await store.create(input);
    const token = await store.verify(pending.token, pending.code);
    const other = await store.create({ ...input, email: 'other-route@example.com' });
    const otherToken = await store.verify(other.token, other.code);
    const image = await sharp(Buffer.from(svg)).png().toBuffer();
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('Uploading must not call a vision provider'); };
    const request = (cookie: string, files: Buffer[] = [image], existingIds: string[] = [], revision = 0) => {
        const body = new FormData();
        body.set('revision', String(revision));
        body.set('existingIds', JSON.stringify(existingIds));
        for (const file of files)
            body.append('photos', new Blob([new Uint8Array(file)], { type: 'image/png' }), 'label.png');
        return new NextRequest('http://localhost/api/photos', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', cookie: `shelfie_session=${cookie}` }, body });
    };
    try {
        assert.equal((await POST(request(''))).status, 401);
        assert.equal((await POST(request(pending.token))).status, 401);
        assert.equal(calls, 0);
        assert.equal((await POST(request(token, [Buffer.from('bad')]))).status, 422);
        assert.equal((await POST(request(token, [image, image]))).status, 413);
        const accepted = await POST(request(token, [image]));
        assert.equal(accepted.status, 200);
        const saved = await accepted.json();
        assert.match(saved.draftKey, /^[a-f0-9]{64}$/);
        assert.notEqual(saved.draftKey, token);
        assert.equal(saved.photos.length, 1);
        assert.equal(saved.revision, 1);
        const id = saved.photos[0].id;
        const preview = (who: string) => new NextRequest(`http://localhost/api/photos/${id}`, { headers: { cookie: `shelfie_session=${who}` } });
        assert.equal((await getPhoto(preview(token), { params: Promise.resolve({ id }) })).status, 200);
        assert.equal((await getPhoto(preview(otherToken), { params: Promise.resolve({ id }) })).status, 404);
        assert.equal((await getPhoto(preview(''), { params: Promise.resolve({ id }) })).status, 401);
        assert.equal((await POST(request(otherToken, [], [id]))).status, 400);
        assert.equal((await POST(request(token, [image], [], 0))).status, 409);
        const replaced = await POST(request(token, [image], [], 1));
        assert.equal(replaced.status, 200);
        assert.equal((await replaced.json()).revision, 2);
        assert.equal((await store.requireEligible(token)).eligible, true);
        delete process.env.LABEL_READER_API_KEY;
        assert.equal((await POST(request(otherToken))).status, 200);
        assert.equal(calls, 0);
        assert.equal((await store.requireEligible(otherToken)).eligible, true);
        await store.completeReport(token, 'route-report', { products: [{}] });
        assert.equal((await POST(request(token))).status, 409);
        assert.equal((await GET(new NextRequest('http://localhost/api/photos', { headers: { cookie: `shelfie_session=${token}` } }))).status, 409);
    }
    finally {
        globalThis.fetch = before.fetch;
        await store.close();
        await fixture.cleanup();
        for (const [key, value] of Object.entries({ DATABASE_URL: before.path, LABEL_READER_API_KEY: before.key })) {
            if (value === undefined)
                delete process.env[key];
            else
                process.env[key] = value;
        }
    }
});
