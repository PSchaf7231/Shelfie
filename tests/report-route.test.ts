import { testDatabase } from './helpers/postgres';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { intakeStore } from '../src/lib/intake';
import { analyzeIngredients } from '../src/lib/ingredients/analyze';
import { POST } from '../src/app/api/report/route';
test('report endpoint rejects unverified, cross-origin and client-written content; repeated completion returns the owned saved report', async () => {
    const fixture = await testDatabase();
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = fixture.url;
    const store = intakeStore();
    const pending = await store.create({ name: 'Ada', email: 'route-report@example.com', pregnancy: false, glp1: false });
    const token = await store.verify(pending.token, pending.code);
    const otherPending = await store.create({ name: 'Other', email: 'other-report@example.com', pregnancy: false, glp1: false });
    const other = await store.verify(otherPending.token, otherPending.code);
    const request = (who: string, data: unknown = { revision: 1 }, origin = 'http://localhost') => new NextRequest('http://localhost/api/report', { method: 'POST', headers: { host: 'localhost', origin, 'content-type': 'application/json', cookie: `shelfie_session=${who}` }, body: JSON.stringify(data) });
    try {
        assert.equal((await POST(request(''))).status, 401);
        assert.equal((await POST(request(pending.token))).status, 401);
        assert.equal((await POST(request(token, { revision: 1 }, 'https://elsewhere.example'))).status, 403);
        for (const data of [{ revision: 0 }, { revision: 1, content: { ingredients: [] } }, { revision: 1, email: 'other-report@example.com' }, { revision: 1, pregnancy: true }])
            assert.equal((await POST(request(token, data))).status, 400);
        assert.equal((await POST(request(token))).status, 409);
        await store.savePhotos(token, 0, [{ bytes: Buffer.from('already checked photo'), width: 1000, height: 900 }]);
        assert.equal((await POST(request(token))).status, 409);
        const label = { rawText: 'Aqua', complete: true, certain: true, confidence: 0.99, ingredients: [{ text: 'Aqua', confidence: 0.99 }] };
        await store.saveIngredientAnalysis(token, 1, analyzeIngredients(label, { pregnancy: false, glp1: false }));
        const results = await Promise.all([POST(request(token)), POST(request(token))]);
        assert.deepEqual(results.map(result => result.status), [200, 200]);
        const first = await results[0].json();
        assert.deepEqual(await results[1].json(), first);
        assert.equal(results[0].headers.get('cache-control'), 'no-store');
        assert.equal(first.analysis.ingredients[0].name, 'Aqua');
        await assert.rejects(async () => await store.requireEligible(token), /already/);
        assert.equal((await POST(request(other))).status, 409);
        assert.equal((await store.requireEligible(other)).eligible, true);
    }
    finally {
        await store.close();
        await fixture.cleanup();
        if (before === undefined)
            delete process.env.DATABASE_URL;
        else
            process.env.DATABASE_URL = before;
    }
});
