import type { NextRequest } from "next/server";
import { intakeStore, IntakeError } from "@/lib/intake";
import { failure, readBody, reply, sameOrigin, SESSION_COOKIE } from "@/lib/intake-http";
import { CATALOG_VERSION } from "@/lib/ingredients/catalog";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const token = request.cookies.get(SESSION_COOKIE)?.value || "";
    const store = intakeStore();
    if ((await store.status(token)).state !== "verified") throw new IntakeError("Verify your email first.", 401);
    const data = await readBody(request);
    if (!data || !Number.isSafeInteger(data.revision) || data.revision < 1 || Object.keys(data).some(key => key !== "revision")) throw new IntakeError("Submit only the revision of your saved label photos.");
    // The client cannot submit report text, preferences, IDs, or completion state.
    return reply(await store.completeIngredientReport(token, data.revision, CATALOG_VERSION));
  } catch (error) { return failure(error); }
}
