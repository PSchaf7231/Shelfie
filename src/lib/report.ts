import type { ProductAnalysis, IngredientAnalysis } from "./ingredients/analyze";
import { skinProfile } from "./skin-profile";
import { skinGuidance } from "./ingredients/skin-guidance";

export const REPORT_DISCLAIMER = "Cosmetic information only — not medical advice";
export const UNVERIFIED_INGREDIENT = "couldn't verify — flagged for review";
export type CompletedReport = { id: string; completed: number; analysis: ProductAnalysis };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const same = (left: string[], right: string[]) => JSON.stringify(left) === JSON.stringify(right);

// A damaged or incomplete draft must fail before consuming the free report.
// This validates saved server output; it never fills in missing fields.
export function isReportAnalysis(value: unknown): value is ProductAnalysis {
  if (!object(value) || !["complete", "needs_review"].includes(String(value.status)) || !text(value.catalogVersion) || !text(value.rawLabelText)) return false;
  if (!object(value.modes) || typeof value.modes.pregnancy !== "boolean" || typeof value.modes.glp1 !== "boolean" || !texts(value.notes) || !object(value.sources)) return false;
  const sources = value.sources;
  if (!Object.values(sources).every(source => object(source) && text(source.title) && typeof source.url === "string" && source.url.startsWith("https://"))) return false;
  if (!Array.isArray(value.ingredients) || !value.ingredients.length || value.ingredients.length > 200 || !object(value.alcohols) || !texts(value.alcohols.drying) || !texts(value.alcohols.fatty) || !texts(value.unmatched)) return false;
  const drying: string[] = [], fatty: string[] = [], unmatched: string[] = [];
  for (const item of value.ingredients) {
    if (!object(item) || !text(item.labelName) || !text(item.name) || !text(item.explanation) || /[\r\n]/.test(item.explanation)) return false;
    if (/\b(?:safe|unsafe|diagnose|treat|cure|guarantee)\b/i.test(item.explanation)) return false;
    if (!["exact", "alias", "unmatched"].includes(String(item.match)) || !["drying", "fatty", null].includes(item.alcoholBucket as string | null) || !["moisturizer", "drying_alcohol", "other", "unknown"].includes(String(item.role))) return false;
    if (item.concentrationPercent !== null && (typeof item.concentrationPercent !== "number" || !Number.isFinite(item.concentrationPercent) || item.concentrationPercent < 0 || item.concentrationPercent > 100)) return false;
    if (!texts(item.sources) || !item.sources.every(id => Object.hasOwn(sources, id)) || !Array.isArray(item.flags)) return false;
    for (const flag of item.flags) {
      if (!object(flag) || !["drying", "pregnancy_nursing", "sensitive_skin"].includes(String(flag.kind)) || !text(flag.message) || !texts(flag.sources) || !flag.sources.every(id => Object.hasOwn(sources, id))) return false;
      if (/\b(?:safe|unsafe|diagnose|treat|cure|guarantee)\b/i.test(flag.message) || flag.kind !== "drying" && !/commonly flagged, check with your doctor/i.test(flag.message)) return false;
      if (flag.kind === "pregnancy_nursing" && !value.modes.pregnancy || flag.kind === "sensitive_skin" && !value.modes.glp1) return false;
    }
    if (item.match === "unmatched") {
      if (item.matchedName !== null || item.alcoholBucket !== null || item.role !== "unknown" || item.flags.length) return false;
      unmatched.push(item.labelName);
    } else if (!text(item.matchedName) || item.role === "unknown") return false;
    if (item.alcoholBucket === "drying") { if (item.role !== "drying_alcohol") return false; drying.push(item.labelName); }
    if (item.alcoholBucket === "fatty") { if (item.role !== "moisturizer" || item.flags.length) return false; fatty.push(item.labelName); }
  }
  if (value.skinProfile !== undefined || value.skinGuidance !== undefined) {
    try {
      if (!object(value.skinProfile) || typeof value.skinProfile.type !== "string" || !Array.isArray(value.skinProfile.concerns) || typeof value.skinProfile.note !== "string" || !texts(value.skinGuidance)) return false;
      const profile = skinProfile(value.skinProfile);
      if (!same(value.skinGuidance, skinGuidance(value.ingredients as IngredientAnalysis[], profile))) return false;
    } catch { return false; }
  }
  return same(drying, value.alcohols.drying) && same(fatty, value.alcohols.fatty) && same(unmatched, value.unmatched) && (unmatched.length ? value.status === "needs_review" : value.status === "complete");
}
