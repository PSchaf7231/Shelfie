import { testDatabase } from './helpers/postgres';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIntake } from '../src/lib/intake';
import { sendVerification } from '../src/lib/email';
const input = { name: 'Ada', email: 'ada@example.com', pregnancy: true, glp1: true };
const now = 1800000000000;
test('validates input and normalizes email', () => {
    assert.deepEqual(validateIntake({ ...input, name: ' Ada ', email: ' ADA@EXAMPLE.COM ' }), input);
    for (const data of [null, { ...input, name: ' ' }, { ...input, email: 'bad' }, { ...input, pregnancy: 'true' }])
        assert.throws(() => validateIntake(data));
});
test('verification binds to browser, rotates token, preserves preferences and does not consume report', async () => {
    const fixture = await testDatabase();
    const db = fixture.connect();
    const first = await db.create(input, now);
    await assert.rejects(async () => await db.requireEligible(first.token, now));
    await assert.rejects(async () => await db.verify('other-browser', first.code, now));
    const token = await db.verify(first.token, first.code, now);
    assert.equal((await db.status(first.token, now)).state, 'intake');
    const status = await db.requireEligible(token, now);
    assert.equal(status.pregnancy, true);
    assert.equal(status.glp1, true);
    for (let i = 0; i < 3; i++)
        assert.equal((await db.requireEligible(token, now)).eligible, true);
    await assert.rejects(async () => await db.verify(first.token, first.code, now));
    await fixture.cleanup();
});
test('wrong codes exhaust attempts and expired codes fail', async () => {
    const fixture = await testDatabase();
    const db = fixture.connect();
    const a = await db.create(input, now);
    const wrong = a.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++)
        await assert.rejects(async () => await db.verify(a.token, wrong, now));
    await assert.rejects(async () => await db.verify(a.token, a.code, now));
    const b = await db.create({ ...input, email: 'other@example.com' }, now);
    await assert.rejects(async () => await db.verify(b.token, b.code, now + 600001));
    await fixture.cleanup();
});
test('resend cooldown and hourly email cap are enforced', async () => {
    const fixture = await testDatabase();
    const db = fixture.connect();
    await db.create(input, now);
    await assert.rejects(async () => await db.create(input, now + 1), /wait/);
    for (let i = 1; i < 5; i++)
        await db.create(input, now + i * 60001);
    await assert.rejects(async () => await db.create(input, now + 6 * 60001), /wait/);
    await fixture.cleanup();
});
test('only completion consumes report, persists across restart and prevents a second session completing', async () => {
    const fixture = await testDatabase();
    let db = fixture.connect();
    try {
        const a = await db.create(input, now);
        const tokenA = await db.verify(a.token, a.code, now);
        const b = await db.create(input, now + 60001);
        const tokenB = await db.verify(b.token, b.code, now + 60001);
        await assert.rejects(async () => await db.completeReport(tokenA, '', {}, now + 60001));
        assert.equal((await db.requireEligible(tokenA, now + 60001)).eligible, true);
        await db.completeReport(tokenA, 'report-1', { products: [{ name: 'Example' }] }, now + 60001);
        await assert.rejects(async () => await db.completeReport(tokenB, 'report-2', { products: [] }, now + 60001), /already/);
        await db.close();
        db = fixture.connect();
        await assert.rejects(async () => await db.requireEligible(tokenB, now + 60001), /already/);
    }
    finally {
        await fixture.cleanup();
    }
});
test('missing delivery configuration fails closed, including outbox in production', async () => {
    const before = { env: process.env.NODE_ENV, key: process.env.EMAIL_PROVIDER_API_KEY, from: process.env.EMAIL_FROM, mode: process.env.SHELFIE_EMAIL_MODE };
    try {
        Object.assign(process.env, { NODE_ENV: 'production' });
        process.env.SHELFIE_EMAIL_MODE = 'outbox';
        delete process.env.EMAIL_PROVIDER_API_KEY;
        delete process.env.EMAIL_FROM;
        await assert.rejects(sendVerification(input.email, '123456', 'test'), /unavailable/);
    }
    finally {
        for (const [key, value] of Object.entries({ NODE_ENV: before.env, EMAIL_PROVIDER_API_KEY: before.key, EMAIL_FROM: before.from, SHELFIE_EMAIL_MODE: before.mode })) {
            if (value === undefined)
                delete process.env[key];
            else
                process.env[key] = value;
        }
    }
});
