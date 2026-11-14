import { createHash } from "node:crypto";
import { IntakeError } from "./errors";
import { parseIngredientList, type LabelTranscript } from "./ingredients/parser";

export type BarcodeProduct = {
  barcode: string; name: string; brand: string; ingredientsText: string;
  sourceUrl: string; retrievedAt: string; lastModified: string | null;
};
export type IngredientOrigin = { kind: "barcode"; product: BarcodeProduct };
export function normalizeBarcode(value: unknown): string {
  if (typeof value !== "string" || value.length > 40) throw new IntakeError("Enter the numbers printed beneath the barcode.");
  const code = value.replace(/[\s-]/g, "");
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) throw new IntakeError("Use an 8, 12, 13 or 14 digit product barcode.");
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += Number(code[i]) * weight;
  if ((10 - sum % 10) % 10 !== Number(code.at(-1))) throw new IntakeError("That barcode’s check digit doesn’t match. Check the numbers or photograph the ingredients.");
  return code;
}
export function barcodeTranscript(product: BarcodeProduct): LabelTranscript {
  // These confidence fields satisfy the shared schema; this is database text,
  // not an OCR confidence claim. Its origin is displayed separately in the report.
  const ingredients = parseIngredientList(product.ingredientsText);
  return { rawText: product.ingredientsText, complete: true, certain: true, confidence: 1,
    ingredients: ingredients.map(item => ({ text: item.raw, confidence: 1 })) };
}
export async function lookupBarcode(value: unknown, fetcher: typeof fetch = fetch): Promise<BarcodeProduct | null> {
  const barcode = normalizeBarcode(value);
  try {
    const fields = "code,product_name,brands,ingredients_text,last_modified_t";
    const response = await fetcher(`https://world.openbeautyfacts.org/api/v3/product/${barcode}.json?fields=${fields}`, {
      headers: { "User-Agent": "Shelfie/0.1 (cosmetic ingredient lookup; https://github.com/PSchaf7231/Shelfie)", Accept: "application/json" },
      signal: AbortSignal.timeout(12000), redirect: "error", cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Database unavailable");
    const data = await response.json();
    const p = data.product;
    if (!p || typeof p !== "object") return null;
    // UPC-A and its EAN-13 zero-padded form identify the same product.
    if (typeof p.code !== "string" || p.code.replace(/^0+/, "") !== barcode.replace(/^0+/, "")) return null;
    if (typeof p.product_name !== "string" || !p.product_name.trim() || p.product_name.length > 300 || typeof p.ingredients_text !== "string" || !p.ingredients_text.trim()) return null;
    const product: BarcodeProduct = { barcode, name: p.product_name.trim(), brand: typeof p.brands === "string" ? p.brands.slice(0, 300) : "",
      ingredientsText: p.ingredients_text, sourceUrl: `https://world.openbeautyfacts.org/product/${barcode}`,
      retrievedAt: new Date().toISOString(), lastModified: typeof p.last_modified_t === "number" && Number.isFinite(p.last_modified_t) && p.last_modified_t > 0 && p.last_modified_t <= Date.now() / 1000 ? new Date(p.last_modified_t * 1000).toISOString() : null };
    try { barcodeTranscript(product); } catch { return null; }
    return product;
  } catch {
    throw new IntakeError("Barcode lookup is unavailable right now. You can photograph the ingredient list instead. Your free report hasn’t been used.", 503);
  }
}
export const lookupOwner = (token: string) => createHash("sha256").update(`barcode:${token}`).digest("hex");
