import { CATALOG_VERSION, findIngredient, normalizeName, sources, type IngredientRecord, type SourceId } from './catalog';
import { validateTranscript, type ParsedIngredient } from './parser';
export type Modes = { pregnancy: boolean; glp1: boolean };
export type IngredientFlag = { kind: 'drying' | 'pregnancy_nursing' | 'sensitive_skin'; message: string; sources: SourceId[] };
export type IngredientAnalysis = {
  labelName: string; name: string; matchedName: string | null; match: 'exact' | 'alias' | 'unmatched';
  concentrationPercent: number | null; explanation: string; alcoholBucket: 'drying' | 'fatty' | null;
  role: IngredientRecord['role'] | 'unknown'; flags: IngredientFlag[]; sources: SourceId[];
};
function explain(item: ParsedIngredient, modes: Modes): IngredientAnalysis {
  const record = findIngredient(item.name);
  if (!record) return {
    labelName: item.raw, name: item.name, matchedName: null, match: 'unmatched', concentrationPercent: item.concentrationPercent,
    explanation: 'We don’t have a verified explanation for this ingredient yet; its role and cautions are unknown.',
    alcoholBucket: null, role: 'unknown', flags: [], sources: [],
  };
  const flags: IngredientFlag[] = [];
  if (record.alcohol === 'drying') flags.push({ kind: 'drying', message: 'This drying alcohol can leave skin feeling dry; the amount and whole formula matter.', sources: ['cosing'] });
  if (modes.pregnancy && record.pregnancy) {
    if (record.pregnancy === 'retinoid' || record.pregnancy === 'hydroquinone') flags.push({ kind: 'pregnancy_nursing', message: 'Commonly flagged, check with your doctor; pregnancy and nursing guidance can differ.', sources: ['pregnancy', 'pregnancyContext'] });
    if (record.pregnancy === 'salicylic' && (item.concentrationPercent === null || item.concentrationPercent > 2)) flags.push({ kind: 'pregnancy_nursing', message: item.concentrationPercent === null
      ? 'The strength is not printed here; high-strength salicylic acid and peels are commonly flagged, check with your doctor.'
      : 'Salicylic acid above 2% is commonly flagged, check with your doctor.', sources: ['pregnancy', 'pregnancyContext'] });
  }
  if (modes.glp1 && record.sensitivity) {
    const message = record.sensitivity === 'fragrance'
      ? 'If your skin feels more sensitive, added scent may feel irritating; a fragrance-free option may feel gentler.'
      : record.sensitivity === 'retinoid'
        ? 'If your skin feels dry or sensitive, this vitamin A family ingredient may feel irritating.'
        : 'If your skin feels more sensitive, this acid may sting or feel drying; its strength and the whole formula matter.';
    flags.push({ kind: 'sensitive_skin', message: `${message} Commonly flagged, check with your doctor.`, sources: record.sources });
  }
  return {
    labelName: item.raw, name: item.name, matchedName: record.name,
    match: normalizeName(item.name) === normalizeName(record.name) ? 'exact' : 'alias',
    concentrationPercent: item.concentrationPercent, explanation: record.explanation,
    alcoholBucket: record.alcohol, role: record.role, flags, sources: record.sources,
  };
}
export function analyzeIngredients(value: unknown, modes: Modes) {
  const { transcript, ingredients: parsed } = validateTranscript(value);
  const ingredients = parsed.map(item => explain(item, modes));
  const unmatched = ingredients.filter(item => item.match === 'unmatched').map(item => item.labelName);
  return {
    status: unmatched.length ? 'needs_review' as const : 'complete' as const,
    catalogVersion: CATALOG_VERSION, rawLabelText: transcript.rawText, modes,
    ingredients,
    alcohols: { drying: ingredients.filter(item => item.alcoholBucket === 'drying').map(item => item.labelName), fatty: ingredients.filter(item => item.alcoholBucket === 'fatty').map(item => item.labelName) },
    unmatched,
    notes: [
      'Cosmetic information only — not medical advice.',
      'Ingredient names alone do not show how the finished product will feel or perform.',
      ...(unmatched.length ? ['Some ingredients are not in our knowledge base yet; we cannot confirm their roles or cautions.'] : []),
      ...(modes.pregnancy ? ['Pregnancy and nursing guidance can differ; these flags are prompts for a conversation with your doctor.'] : []),
      ...(modes.glp1 ? ['This mode uses general sensitive-skin cautions; it does not infer a GLP-1 medication interaction.'] : []),
    ],
    sources,
  };
}
export type ProductAnalysis = ReturnType<typeof analyzeIngredients>;
