import type { NextRequest } from "next/server";
import { intakeStore, IntakeError } from "@/lib/intake";
import { failure, readBody, reply, sameOrigin, SESSION_COOKIE } from "@/lib/intake-http";
import { readIngredientLabel } from "@/lib/label-reader";
import { analyzeIngredients } from "@/lib/ingredients/analyze";
import { CATALOG_VERSION } from "@/lib/ingredients/catalog";

export const runtime = "nodejs";
export const maxDuration = 120;
let activeReads = 0;
export async function POST(request: NextRequest) {
  let admitted = false;
  try {
    sameOrigin(request);
    const token = request.cookies.get(SESSION_COOKIE)?.value || "";
    const store = intakeStore();
    const session = await store.requireEligible(token);
    const data = await readBody(request);
    if (!data || !Number.isSafeInteger(data.revision) || data.revision < 1 || Object.keys(data).some(key => key !== "revision")) throw new IntakeError("Submit only the revision of your saved label photos.");
    const cached = await store.ingredientAnalysis(token, data.revision, CATALOG_VERSION);
    if (cached) return reply(cached);
    if (activeReads >= 2) throw new IntakeError("Label reading is busy. Please try again in a moment.", 429);
    activeReads++; admitted = true;
    await store.photoAttempt(token);
    const batch = await store.photoBatch(token);
    if (!batch.photos.length || batch.revision !== data.revision) throw new IntakeError("Your label photos changed. Please check them again.", 409);
    const { transcript } = await readIngredientLabel(batch.photos);
    // Preferences come only from the verified server session, not submitted JSON.
    const analysis = analyzeIngredients(transcript, { pregnancy: session.pregnancy, glp1: session.glp1 }, session.skinProfile);
    await store.saveIngredientAnalysis(token, data.revision, analysis);
    return reply(analysis);
  } catch (error) { return failure(error); }
  finally { if (admitted) activeReads--; }
}
