import { testDatabase } from './helpers/postgres';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { intakeStore } from '../src/lib/intake';
import { POST } from '../src/app/api/ingredients/route';
import { CATALOG_VERSION } from '../src/lib/ingredients/catalog';
const label = ['Alcohol Denat.', 'Cetyl Alcohol', 'Retinol', 'Salicylic Acid 5%', 'Parfum'];
const transcript = () => ({ rawText: label.join(', '), complete: true, certain: true, confidence: 0.99, ingredients: label.map(text => ({ text, confidence: 0.99 })) });
const image = { bytes: Buffer.from('private previously quality-checked image'), width: 1000, height: 800 };
test('analysis uses only owned saved photos and server preferences; caches safely and never consumes a report', async () => {
    const fixture = await testDatabase();
    const before = { path: process.env.DATABASE_URL, key: process.env.LABEL_READER_API_KEY, fetch: globalThis.fetch };
    process.env.DATABASE_URL = fixture.url;
    process.env.LABEL_READER_API_KEY = 'test-placeholder';
    const store = intakeStore();
    const pending = await store.create({ name: 'Ada', email: 'ingredients@example.com', pregnancy: true, glp1: true });
    const token = await store.verify(pending.token, pending.code);
    const otherStart = await store.create({ name: 'Other', email: 'other-ingredients@example.com', pregnancy: false, glp1: false });
    const other = await store.verify(otherStart.token, otherStart.code);
    let calls = 0, lowConfidence = false, race = false;
    globalThis.fetch = async (_url, options) => {
        calls++;
        const request = JSON.parse(String(options?.body));
        assert.equal(request.response_format.json_schema.name, 'ingredient_transcription');
        if (race && calls % 2 === 0) {
            const current = await store.photoBatch(token);
            await store.savePhotos(token, current.revision, [image]);
        }
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...transcript(), confidence: lowConfidence ? 0.5 : 0.99 }) } }] });
    };
    const request = (who: string, data: unknown = { revision: 1 }) => new NextRequest('http://localhost/api/ingredients', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', cookie: `shelfie_session=${who}` }, body: JSON.stringify(data) });
    try {
        assert.equal((await POST(request(''))).status, 401);
        assert.equal((await POST(request(pending.token))).status, 401);
        assert.equal((await POST(request(token, { revision: 1, pregnancy: false }))).status, 400);
        assert.equal((await POST(request(token, { revision: 1, rawText: 'Glycerin' }))).status, 400);
        assert.equal((await POST(request(token))).status, 409);
        assert.equal(calls, 0);
        await store.savePhotos(token, 0, [image]);
        lowConfidence = true;
        assert.equal((await POST(request(token))).status, 422);
        assert.equal(await store.ingredientAnalysis(token, 1, CATALOG_VERSION), null);
        lowConfidence = false;
        const result = await POST(request(token));
        assert.equal(result.status, 200);
        const body = await result.json();
        assert.equal(body.status, 'complete');
        assert.deepEqual(body.modes, { pregnancy: true, glp1: true });
        assert.deepEqual(body.alcohols.drying, ['Alcohol Denat.']);
        assert.deepEqual(body.alcohols.fatty, ['Cetyl Alcohol']);
        assert.equal(body.ingredients[1].role, 'moisturizer');
        assert.equal(body.ingredients[1].flags.length, 0);
        assert.ok(body.ingredients[2].flags.some((flag: {
            kind: string;
        }) => flag.kind === 'pregnancy_nursing'));
        assert.ok(body.ingredients[4].flags.some((flag: {
            kind: string;
        }) => flag.kind === 'sensitive_skin'));
        const beforeCache = calls;
        assert.equal((await POST(request(token))).status, 200);
        assert.equal(calls, beforeCache);
        assert.equal((await POST(request(other))).status, 409);
        assert.equal((await store.requireEligible(token)).eligible, true);
        await store.savePhotos(token, 1, [image]);
        assert.equal(await store.ingredientAnalysis(token, 2, CATALOG_VERSION), null);
        const previousCalls = calls;
        race = true;
        // Make the next second read replace the photo batch to exercise the final transaction gate.
        calls = 0;
        assert.equal((await POST(request(token, { revision: 2 }))).status, 409);
        race = false;
        assert.ok(calls > 0);
        calls = previousCalls + calls;
        assert.equal((await store.requireEligible(token)).eligible, true);
        await store.completeReport(token, 'done-report', { products: [{}] });
        assert.equal((await POST(request(token, { revision: 3 }))).status, 409);
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
