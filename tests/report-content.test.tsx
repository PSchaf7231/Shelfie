import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReportContent from '../src/components/report-content';
import { analyzeIngredients } from '../src/lib/ingredients/analyze';
import { parseIngredientList } from '../src/lib/ingredients/parser';
import { isReportAnalysis, UNVERIFIED_INGREDIENT } from '../src/lib/report';

function fixture(pregnancy = true, glp1 = true) {
  const rawText = 'Ethanol, Cetyl Alcohol, Cetearyl Alcohol, Stearyl Alcohol, Retinol, Parfum, Unlisted Botanical Extract';
  const analysis = analyzeIngredients({ rawText, complete: true, certain: true, confidence: 0.99, ingredients: parseIngredientList(rawText).map(item => ({ text: item.raw, confidence: 0.99 })) }, { pregnancy, glp1 });
  return { id: 'fixture-report', completed: 1800000000000, analysis };
}
test('report shows every ingredient, distinct alcohol sections, explicit unknowns and both mode flags without medical claims', () => {
  const report = fixture();
  const html = renderToStaticMarkup(createElement(ReportContent, { report }));
  for (const item of report.analysis.ingredients) assert.ok(html.includes(item.labelName));
  assert.ok(html.includes(UNVERIFIED_INGREDIENT.replace("'", '&#x27;')));
  assert.ok(html.includes('Cosmetic information only — not medical advice'));
  const drying = html.split('id="drying-alcohols"')[1].split('id="fatty-alcohols"')[0];
  assert.ok(drying.includes('Ethanol')); assert.ok(!drying.includes('Cetyl Alcohol'));
  const fatty = html.split('id="fatty-alcohols"')[1].split('id="pregnancy_nursing"')[0];
  for (const name of ['Cetyl Alcohol', 'Cetearyl Alcohol', 'Stearyl Alcohol']) assert.ok(fatty.includes(name));
  assert.ok(fatty.includes('Moisturizer')); assert.ok(!fatty.includes('Flagged as drying'));
  assert.ok(html.includes('Pregnancy &amp; nursing mode')); assert.ok(html.includes('GLP-1 sensitive-skin mode'));
  for (const flag of report.analysis.ingredients.flatMap(item => item.flags).filter(flag => flag.kind !== 'drying')) assert.match(flag.message, /commonly flagged, check with your doctor/i);
  assert.doesNotMatch(html, /\b(?:safe|unsafe|diagnose|treat|cure|guarantee)\b/i);
  const off = renderToStaticMarkup(createElement(ReportContent, { report: fixture(false, false) }));
  assert.equal(off.match(/This mode was off for this report/g)?.length, 2);
  assert.ok(!off.includes('Commonly flagged, check with your doctor'));
});
test('draft validation refuses missing content, contradictory alcohol buckets and unsupported mode claims', () => {
  const { analysis } = fixture();
  assert.equal(isReportAnalysis(analysis), true);
  assert.equal(isReportAnalysis({ ...analysis, ingredients: [] }), false);
  assert.equal(isReportAnalysis({ ...analysis, alcohols: { drying: ['Cetyl Alcohol'], fatty: ['Ethanol'] } }), false);
  assert.equal(isReportAnalysis({ ...analysis, modes: { pregnancy: false, glp1: false } }), false);
  assert.equal(isReportAnalysis({ ...analysis, ingredients: analysis.ingredients.map(item => ({ ...item, explanation: 'This is safe.' })) }), false);
});
