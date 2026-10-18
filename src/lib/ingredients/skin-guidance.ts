import { skinProfile, type SkinProfile } from "../skin-profile";
import type { IngredientAnalysis } from "./analyze";
import { findIngredient } from "./catalog";

export function skinGuidance(ingredients: IngredientAnalysis[], input: SkinProfile) {
  const profile = skinProfile(input), notes: string[] = [];
  const names = (items: IngredientAnalysis[]) => items.map(item => item.labelName).join(", ");
  const moisturizers = ingredients.filter(item => item.role === "moisturizer");
  const drying = ingredients.filter(item => item.alcoholBucket === "drying");
  if (profile.type === "dry" && moisturizers.length) notes.push(`${names(moisturizers)}: these ingredients help hold moisture or soften skin, which may be useful for the dry skin you described.`);
  if ((profile.type === "dry" || profile.concerns.length) && drying.length) notes.push(`${names(drying)}: drying alcohols may leave dry or sensitive skin feeling tighter; the amount and whole formula matter.`);
  const sensitive = profile.concerns.some(value => ["sensitive", "redness", "eczema", "fragrance_allergy"].includes(value));
  if (sensitive) {
    const scent = ingredients.filter(item => findIngredient(item.name)?.sensitivity === "fragrance");
    if (scent.length) notes.push(`${names(scent)}: added scent can irritate sensitive skin. ${profile.concerns.includes("fragrance_allergy") ? "You reported a fragrance allergy; check this product against the specific fragrance ingredients you avoid." : "A fragrance-free option may feel gentler."}`);
    const actives = ingredients.filter(item => ["retinoid", "exfoliating_acid"].includes(findIngredient(item.name)?.sensitivity || ""));
    if (actives.length) notes.push(`${names(actives)}: these ingredients can sting or feel irritating on sensitive skin; strength and frequency of use matter.`);
  }
  if (profile.type === "oily" || profile.type === "combination") notes.push("Oiliness alone does not establish which formula will suit you. Cleansing, moisturizing, product texture and frequency of use all matter.");
  if (profile.concerns.includes("acne_prone")) notes.push("Ingredient names alone cannot establish whether a finished product will clog your pores or suit acne-prone skin.");
  if (ingredients.some(item => item.match === "unmatched")) notes.push("Some ingredients remain unverified, so this skin-profile guidance is incomplete.");
  if (!notes.length) notes.push("There are no specific matches for your selected profile in our current reference list. This does not establish that the product will suit your skin.");
  return notes;
}
