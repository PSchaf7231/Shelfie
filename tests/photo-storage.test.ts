import { testDatabase } from './helpers/postgres';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const now = 1800000000000;
const input = { name: 'Ada', email: 'ada@example.com', pregnancy: false, glp1: false };
const image = { bytes: Buffer.from('private photo'), width: 800, height: 1000 };
test('photo ownership, revisions, persistence and retakes preserve entitlement', async () => {
    const fixture = await testDatabase();
    let db = fixture.connect();
    try {
        const start = await db.create(input, now);
        await assert.rejects(async () => await db.photoBatch(start.token, now), /Verify/);
        const token = await db.verify(start.token, start.code, now);
        const otherStart = await db.create({ ...input, email: 'other@example.com' }, now);
        const other = await db.verify(otherStart.token, otherStart.code, now);
        const saved = await db.savePhotos(token, 0, [image, image], now);
        assert.equal(saved.photos.length, 2);
        assert.equal(saved.revision, 1);
        assert.equal((await db.photoBatch(other, now)).photos.length, 0);
        await assert.rejects(async () => await db.savePhotos(token, 0, [image], now), /another tab/);
        assert.equal((await db.photoBatch(token, now)).photos.length, 2);
        const replaced = await db.savePhotos(token, 1, [image], now);
        assert.equal(replaced.photos.length, 1);
        assert.equal(replaced.revision, 2);
        assert.equal((await db.requireEligible(token, now)).eligible, true);
        await db.close();
        db = fixture.connect();
        assert.equal((await db.photoBatch(token, now)).photos[0].bytes.toString(), 'private photo');
        await db.completeReport(token, 'r-1', { products: [{}] }, now);
        await assert.rejects(async () => await db.photoBatch(token, now), /already/);
    }
    finally {
        await fixture.cleanup();
    }
});
test('saved photos expire and check attempts are limited without consuming a report', async () => {
    const fixture = await testDatabase();
    const db = fixture.connect();
    try {
        const start = await db.create(input, now);
        const token = await db.verify(start.token, start.code, now);
        await db.savePhotos(token, 0, [image], now);
        for (let i = 0; i < 10; i++)
            await db.photoAttempt(token, now);
        await assert.rejects(async () => await db.photoAttempt(token, now), /wait/);
        await db.photoAttempt(token, now + 60001);
        assert.equal((await db.requireEligible(token, now)).eligible, true);
        const next = await db.create(input, now + 86400001);
        const nextToken = await db.verify(next.token, next.code, now + 86400001);
        assert.equal((await db.photoBatch(nextToken, now + 86400001)).photos.length, 0);
    }
    finally {
        await fixture.cleanup();
    }
});
