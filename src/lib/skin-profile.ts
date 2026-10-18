import { IntakeError } from "./errors";

export const skinTypes = { dry: "Dry", oily: "Oily", combination: "Combination" } as const;
export const skinConcerns = { sensitive: "Sensitive", acne_prone: "Acne-prone", redness: "Rosacea / redness", eczema: "Eczema", fragrance_allergy: "Fragrance allergy" } as const;
export type SkinProfile = { type: keyof typeof skinTypes | ""; concerns: (keyof typeof skinConcerns)[]; note: string };
export function skinProfile(value?: unknown): SkinProfile {
  if (value === undefined || value === null) return { type: "", concerns: [], note: "" };
  if (typeof value !== "object" || Array.isArray(value)) throw new IntakeError("Please check your skin profile choices.");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(key => !["type", "concerns", "note"].includes(key))) throw new IntakeError("Please check your skin profile choices.");
  const type = p.type ?? "", concerns = p.concerns ?? [], note = p.note ?? "";
  if (typeof type !== "string" || type !== "" && !Object.hasOwn(skinTypes, type) || !Array.isArray(concerns) || concerns.length > 5 || concerns.some(v => typeof v !== "string" || !Object.hasOwn(skinConcerns, v)) || new Set(concerns).size !== concerns.length || typeof note !== "string" || note.length > 300) throw new IntakeError("Choose your skin profile and keep the optional note to 300 characters.");
  return { type: type as SkinProfile["type"], concerns: Object.keys(skinConcerns).filter(key => concerns.includes(key)) as SkinProfile["concerns"], note: note.trim() };
}
export function skinProfileLabels(profile: SkinProfile) {
  return [...(profile.type ? [skinTypes[profile.type]] : []), ...profile.concerns.map(key => skinConcerns[key])];
}
