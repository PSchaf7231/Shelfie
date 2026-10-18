import { IntakeError } from "../intake";

export class LabelReadError extends IntakeError {
  constructor(message = "We couldn’t read every ingredient reliably. Please provide a clearer photo of the whole list; we won’t guess.") { super(message, 422); }
}
export type ParsedIngredient = { raw: string; name: string; concentrationPercent: number | null };
export const literal = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

export function parseIngredientList(rawText: string): ParsedIngredient[] {
  if (typeof rawText !== "string" || rawText.length > 12000 || !rawText.trim() || /[?<>\uFFFD]|\b(?:unreadable|illegible|unknown|unclear|not visible|ignore instructions)\b|\.{2,}|…/i.test(rawText)) throw new LabelReadError();
  let text = rawText.trim();
  if (/\b(?:active|inactive) ingredients?\s*:/i.test(text)) {
    // Both printed sections are required; never silently discard an active list.
    if (!/^active ingredients?\s*:/i.test(text) || (text.match(/inactive ingredients?\s*:/gi)?.length ?? 0) !== 1) throw new LabelReadError();
    text = text.replace(/^active ingredients?\s*:/i, "").replace(/\s*inactive ingredients?\s*:/i, ";");
  } else text = text.replace(/^ingredients?(?:\s*:\s*|[ \t]*\r?\n\s*)/i, "");
  if (/\bingredients?\s*:/i.test(text)) throw new LabelReadError();
  const entries: string[] = [];
  let start = 0;
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(" || char === "[") stack.push(char);
    else if (char === ")" || char === "]") {
      if (stack.pop() !== (char === ")" ? "(" : "[")) throw new LabelReadError();
    } else if (!stack.length && (char === ";" || (char === "," && !(/\d/.test(text[i - 1] || "") && /\d/.test(text[i + 1] || ""))))) {
      entries.push(text.slice(start, i)); start = i + 1;
    }
  }
  if (stack.length) throw new LabelReadError();
  entries.push(text.slice(start));
  if (entries.length > 200 || !entries.length) throw new LabelReadError();
  return entries.map(value => {
    const raw = value.trim();
    if (!raw || raw.length > 200 || !/^[\p{L}\p{N}\s.,()\[\]%+\/'’\-]+$/u.test(raw) || !/\p{L}/u.test(raw)) throw new LabelReadError();
    // Only a literal printed percentage is used. Do not infer dosage from order.
    const percentages = raw.match(/\d+(?:\.\d+)?\s*%/g) || [];
    if (percentages.length > 1 || (raw.includes("%") && percentages.length !== 1)) throw new LabelReadError();
    let name = raw;
    let concentrationPercent: number | null = null;
    if (percentages.length) {
      const number = percentages[0];
      if (!number) throw new LabelReadError();
      concentrationPercent = Number.parseFloat(number);
      if (concentrationPercent < 0 || concentrationPercent > 100) throw new LabelReadError();
      const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const suffix = new RegExp(`(?:\\s*\\(${escaped}\\)|\\s+${escaped})\\.?$`);
      const prefix = new RegExp(`^${escaped}\\s+`);
      if (suffix.test(name)) name = name.replace(suffix, "");
      else if (prefix.test(name)) name = name.replace(prefix, "");
      else throw new LabelReadError();
    }
    name = name.trim().replace(/\.$/, "").trim();
    if (!name || /\d+\s*-\s*\d+\s*$/.test(name)) throw new LabelReadError();
    return { raw, name, concentrationPercent };
  });
}

export type LabelTranscript = { rawText: string; complete: boolean; certain: boolean; confidence: number; ingredients: { text: string; confidence: number }[] };
export function validateTranscript(value: unknown): { transcript: LabelTranscript; ingredients: ParsedIngredient[] } {
  const data = value as LabelTranscript | null;
  if (!data || typeof data.rawText !== "string" || data.complete !== true || data.certain !== true || !Number.isFinite(data.confidence) || data.confidence < 0.98 || data.confidence > 1 || !Array.isArray(data.ingredients)) throw new LabelReadError();
  const ingredients = parseIngredientList(data.rawText);
  if (data.ingredients.length !== ingredients.length) throw new LabelReadError();
  for (let i = 0; i < ingredients.length; i++) {
    const item = data.ingredients[i];
    if (!item || typeof item.text !== "string" || !Number.isFinite(item.confidence) || item.confidence < 0.98 || item.confidence > 1 || literal(item.text) !== literal(ingredients[i].raw)) throw new LabelReadError();
  }
  return { transcript: data, ingredients };
}
