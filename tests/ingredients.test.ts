import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeIngredients } from '../src/lib/ingredients/analyze';
import { catalog, findIngredient } from '../src/lib/ingredients/catalog';
import { parseIngredientList, validateTranscript } from '../src/lib/ingredients/parser';

const modes = { pregnancy: false, glp1: false };
function transcript(rawText: string) {
  return { rawText, complete: true, certain: true, confidence: 0.99, ingredients: parseIngredientList(rawText).map(item => ({ text: item.raw, confidence: 0.99 })) };
}

test('preserves every ingredient, punctuation within names, aliases, and printed percentages', () => {
  const parsed = parseIngredientList('Ingredients: Aqua (Water), 1,2-Hexanediol, Salicylic Acid (2%), Sodium Chloride.');
  assert.equal(parsed.length, 4); assert.equal(parsed[1].name, '1,2-Hexanediol'); assert.equal(parsed[2].concentrationPercent, 2);
  assert.equal(findIngredient(parsed[0].name)?.name, 'Aqua');
  assert.equal(parseIngredientList('Active Ingredients: Salicylic Acid 3%\nInactive Ingredients: Aqua, Glycerin').length, 3);
  assert.equal(parseIngredientList('2% Salicylic Acid, Aqua')[0].concentrationPercent, 2);
  assert.equal(parseIngredientList('Glycerin, Glyceryl Stearate (and) PEG-100 Stearate').length, 2);
});
test('rejects unreadable, incomplete, malformed or unverified lists without fixing them', () => {
  for (const input of ['', 'Aqua,,Glycerin', 'Aqua,', 'Aqua (Water, Glycerin', 'Aqua [Water)', 'Aqua, ???', 'Aqua, Retin...', 'Aqua, unreadable', 'Aqua, Salicylic Acid 200%', 'Aqua, Salicylic Acid (2% 3%)', 'Active Ingredients: Retinol', 'Aqua\nDirections: use daily']) assert.throws(() => parseIngredientList(input), input);
  const good = transcript('Aqua, Glycerin');
  for (const bad of [null, {}, { ...good, complete: false }, { ...good, certain: false }, { ...good, confidence: 0.97 }, { ...good, confidence: NaN }, { ...good, ingredients: [{text:'Aqua',confidence:0.99}] }, { ...good, ingredients: [{text:'Aqua',confidence:0.99},{text:'Retinol',confidence:0.99}] }, { ...good, ingredients: [{text:'Aqua',confidence:0.99},{text:'Glycerin',confidence:0.9}] }]) assert.throws(() => validateTranscript(bad));
  const printedPeriod = transcript('Aqua, Glycerin.');
  assert.equal(validateTranscript(printedPeriod).ingredients[1].name, 'Glycerin');
  assert.throws(() => validateTranscript({ ...printedPeriod, ingredients: good.ingredients }), /reliably/);
});
test('drying and fatty alcohol buckets are disjoint and aromatic/preservative names do not get substring matches', () => {
  const result = analyzeIngredients(transcript('Ethanol, Isopropyl Alcohol, Alcohol Denat., Cetyl Alcohol, Cetearyl Alcohol, Stearyl Alcohol, Benzyl Alcohol, Phenoxyethanol'), modes);
  assert.deepEqual(result.alcohols.drying, ['Ethanol', 'Isopropyl Alcohol', 'Alcohol Denat.']);
  assert.deepEqual(result.alcohols.fatty, ['Cetyl Alcohol', 'Cetearyl Alcohol', 'Stearyl Alcohol']);
  for (const item of result.ingredients.filter(item => item.alcoholBucket === 'fatty')) { assert.equal(item.role, 'moisturizer'); assert.equal(item.flags.length, 0); }
  for (const item of result.ingredients.filter(item => item.alcoholBucket === 'drying')) assert.equal(item.flags[0].kind, 'drying');
  assert.equal(result.ingredients[6].alcoholBucket, null); assert.equal(result.ingredients[7].alcoholBucket, null);
  assert.equal(findIngredient('Super Retinol Complex'), null); assert.equal(findIngredient('CetyI Alcohol'), null);
});
test('pregnancy and nursing flags use exact names and literal salicylic strength without blanket judgements', () => {
  const raw = 'Retinol, Retinaldehyde, Retinyl Palmitate, Hydroquinone, Salicylic Acid 5%, Salicylic Acid 2%, Salicylic Acid, Bakuchiol, Cetyl Alcohol';
  const off = analyzeIngredients(transcript(raw), modes);
  assert.equal(off.ingredients.flatMap(item => item.flags).filter(flag => flag.kind === 'pregnancy_nursing').length, 0);
  const on = analyzeIngredients(transcript(raw), { pregnancy: true, glp1: false });
  assert.ok(on.ingredients[4].flags.some(flag => flag.message.includes('above 2%')));
  assert.equal(on.ingredients[5].flags.length, 0);
  assert.ok(on.ingredients[6].flags.some(flag => flag.message.includes('strength is not printed')));
  assert.equal(on.ingredients[7].flags.length, 0); assert.equal(on.ingredients[8].flags.length, 0);
  for (const flag of on.ingredients.flatMap(item => item.flags)) assert.match(flag.message, /commonly flagged, check with your doctor/i);
  assert.doesNotMatch(JSON.stringify(on), /\b(?:safe|unsafe)\b/i);
});
test('GLP-1 mode adds gentle sensitivity flags to fragrance, acids and retinoids only when enabled', () => {
  const raw = 'Parfum, Glycolic Acid, Retinol, Cetyl Alcohol, Citric Acid';
  assert.equal(analyzeIngredients(transcript(raw), modes).ingredients.flatMap(item => item.flags).length, 0);
  const on = analyzeIngredients(transcript(raw), { pregnancy: false, glp1: true });
  assert.equal(on.ingredients.filter(item => item.flags.some(flag => flag.kind === 'sensitive_skin')).length, 3);
  assert.equal(on.ingredients[3].flags.length, 0); assert.equal(on.ingredients[4].flags.length, 0);
  assert.ok(on.notes.some(note => note.includes('does not infer a GLP-1 medication interaction')));
});
test('each ingredient has a plain-language line and unknown entries are explicit incomplete knowledge', () => {
  const result = analyzeIngredients(transcript('Aqua, Unlisted Botanical Extract, CetyI Alcohol'), modes);
  assert.equal(result.status, 'needs_review'); assert.equal(result.ingredients.length, 3);
  assert.equal(result.ingredients[1].match, 'unmatched'); assert.equal(result.ingredients[2].match, 'unmatched');
  assert.deepEqual(result.alcohols.fatty, []);
  assert.match(result.ingredients[1].explanation, /unknown/);
  for (const entry of catalog) {
    assert.ok(entry.explanation.length > 10); assert.ok(!entry.explanation.includes('\n'));
    assert.doesNotMatch(entry.explanation, /\b(?:humectant|emollient|surfactant|keratolytic|diagnose|treat|cure|guarantee|safe|unsafe)\b/i);
  }
  assert.equal(analyzeIngredients(transcript('Aqua, Glycerin'), modes).status, 'complete');
});
