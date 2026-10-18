import { testDatabase } from './helpers/postgres';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IntakeStore, validateIntake } from '../src/lib/intake';
import { analyzeIngredients } from '../src/lib/ingredients/analyze';
import { CATALOG_VERSION } from '../src/lib/ingredients/catalog';
import { parseIngredientList } from '../src/lib/ingredients/parser';
const now = 1800000000000;
const input = { name: 'Ada', email: 'ada-report@example.com', pregnancy: true, glp1: true };
const photo = { bytes: Buffer.from('previously checked private label'), width: 900, height: 1000 };
function analysis() {
    const rawText = 'Ethanol, Cetyl Alcohol, Retinol, Parfum, Unlisted Botanical Extract';
    return analyzeIngredients({ rawText, complete: true, certain: true, confidence: 0.99, ingredients: parseIngredientList(rawText).map(item => ({ text: item.raw, confidence: 0.99 })) }, { pregnancy: true, glp1: true });
}
test('only a current, renderable server draft can complete; failures leave the free report available', async () => {
    const fixture = await testDatabase();
    const store = fixture.connect();
    try {
        const pending = await store.create(input, now);
        await assert.rejects(async () => await store.getReport(pending.token, now), /Verify/);
        await assert.rejects(async () => await store.completeIngredientReport(pending.token, 1, CATALOG_VERSION, now), /Verify/);
        const token = await store.verify(pending.token, pending.code, now);
        assert.equal(await store.getReport(token, now), null);
        await assert.rejects(async () => await store.completeIngredientReport(token, 1, CATALOG_VERSION, now), /photos/);
        await store.savePhotos(token, 0, [photo], now);
        await assert.rejects(async () => await store.completeIngredientReport(token, 1, CATALOG_VERSION, now), /Read/);
        const draft = analysis();
        await store.saveIngredientAnalysis(token, 1, { ...draft, ingredients: [] }, now);
        await assert.rejects(async () => await store.completeIngredientReport(token, 1, CATALOG_VERSION, now), /incomplete/);
        assert.equal((await store.requireEligible(token, now)).eligible, true);
        await store.saveIngredientAnalysis(token, 1, draft, now);
        await assert.rejects(async () => await store.completeIngredientReport(token, 1, 'old-catalog', now), /Read/);
        await assert.rejects(async () => await store.completeIngredientReport(token, 2, CATALOG_VERSION, now), /photos/);
        const second = await store.create({ ...input, pregnancy: false }, now + 60001);
        const otherModes = await store.verify(second.token, second.code, now + 60001);
        await assert.rejects(async () => await store.completeIngredientReport(otherModes, 1, CATALOG_VERSION, now + 60001), /Read/);
        assert.equal((await store.requireEligible(token, now + 60001)).eligible, true);
        await store.savePhotos(token, 1, [photo], now + 60001);
        await assert.rejects(async () => await store.completeIngredientReport(token, 1, CATALOG_VERSION, now + 60001), /photos/);
        await assert.rejects(async () => await store.completeIngredientReport(token, 2, CATALOG_VERSION, now + 60001), /Read/);
        assert.equal(await store.getReport(token, now + 60001), null);
        assert.equal((await store.requireEligible(token, now + 60001)).eligible, true);
    }
    finally {
        await fixture.cleanup();
    }
});
test('completion consumes exactly once per normalized email and reopens the same immutable report across sessions and restart', async () => {
    const fixture = await testDatabase();
    let store = fixture.connect();
    let otherConnection: IntakeStore | undefined;
    try {
        const a = await store.create(validateIntake({ ...input, email: ' ADA-REPORT@EXAMPLE.COM ' }), now);
        const tokenA = await store.verify(a.token, a.code, now);
        const b = await store.create(input, now + 60001);
        const tokenB = await store.verify(b.token, b.code, now + 60001);
        const stranger = await store.create({ ...input, email: 'stranger@example.com' }, now);
        const strangerToken = await store.verify(stranger.token, stranger.code, now);
        await store.savePhotos(tokenA, 0, [photo], now);
        const draft = analysis();
        await store.saveIngredientAnalysis(tokenA, 1, draft, now);
        assert.equal((await store.requireEligible(tokenA, now)).eligible, true);
        assert.equal(await store.getReport(tokenA, now), null); // Reading the page never completes a draft.
        const report = await store.completeIngredientReport(tokenA, 1, CATALOG_VERSION, now + 60001);
        assert.equal(report.analysis.status, 'needs_review'); // Explicit unknowns remain visible.
        assert.deepEqual(report.analysis.unmatched, ['Unlisted Botanical Extract']);
        await assert.rejects(async () => await store.requireEligible(tokenA, now + 60001), /already/);
        await assert.rejects(async () => await store.savePhotos(tokenB, 1, [photo], now + 60001), /already/);
        assert.equal(await store.getReport(strangerToken, now + 60001), null);
        await assert.rejects(async () => await store.completeIngredientReport(strangerToken, 1, CATALOG_VERSION, now + 60001), /photos/);
        assert.deepEqual(await store.completeIngredientReport(tokenB, 99, CATALOG_VERSION, now + 60001), report);
        otherConnection = fixture.connect();
        assert.deepEqual(await otherConnection.completeIngredientReport(tokenA, 1, CATALOG_VERSION, now + 60001), report);
        await store.close();
        store = fixture.connect();
        assert.deepEqual(await store.getReport(tokenB, now + 60001), report);
        assert.equal((await store.status(tokenB, now + 60001)).state, 'verified');
        await assert.rejects(async () => await store.getReport(tokenB, now + 86460002), /Verify/);
        const fresh = await store.create(input, now + 86460002);
        const freshToken = await store.verify(fresh.token, fresh.code, now + 86460002);
        assert.deepEqual(await store.getReport(freshToken, now + 86460002), report);
        await assert.rejects(async () => await store.requireEligible(freshToken, now + 86460002), /already/);
    }
    finally {
        await fixture.cleanup();
    }
});
