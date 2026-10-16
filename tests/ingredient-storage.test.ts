import { testDatabase } from './helpers/postgres';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeIngredients } from '../src/lib/ingredients/analyze';
const now = 1800000000000;
const label = { rawText: 'Aqua, Retinol', complete: true, certain: true, confidence: 0.99, ingredients: [{ text: 'Aqua', confidence: 0.99 }, { text: 'Retinol', confidence: 0.99 }] };
const photo = { bytes: Buffer.from('photo'), width: 900, height: 1000 };
test('ingredient drafts survive restart but are invalidated by photo revisions, catalog version and mode changes', async () => {
    const fixture = await testDatabase();
    let store = fixture.connect();
    try {
        const input = { name: 'Ada', email: 'cache@example.com', pregnancy: false, glp1: false };
        const start = await store.create(input, now);
        const token = await store.verify(start.token, start.code, now);
        await store.savePhotos(token, 0, [photo], now);
        const analysis = analyzeIngredients(label, { pregnancy: false, glp1: false });
        await store.saveIngredientAnalysis(token, 1, analysis, now);
        await store.close();
        store = fixture.connect();
        assert.equal((await store.ingredientAnalysis(token, 1, analysis.catalogVersion, now))?.ingredients.length, 2);
        assert.equal(await store.ingredientAnalysis(token, 1, 'different-version', now), null);
        const changed = await store.create({ ...input, pregnancy: true }, now + 60001);
        const newToken = await store.verify(changed.token, changed.code, now + 60001);
        assert.equal(await store.ingredientAnalysis(newToken, 1, analysis.catalogVersion, now + 60001), null);
        await assert.rejects(async () => await store.saveIngredientAnalysis(newToken, 1, analysis, now + 60001), /preferences changed/);
        await store.savePhotos(token, 1, [photo], now + 60001);
        assert.equal(await store.ingredientAnalysis(token, 2, analysis.catalogVersion, now + 60001), null);
        await assert.rejects(async () => await store.saveIngredientAnalysis(token, 1, analysis, now + 60001), /changed/);
        const next = await store.create(input, now + 86460002);
        const fresh = await store.verify(next.token, next.code, now + 86460002);
        await assert.rejects(async () => await store.ingredientAnalysis(fresh, 2, analysis.catalogVersion, now + 86460002), /expired/);
    }
    finally {
        await fixture.cleanup();
    }
});
