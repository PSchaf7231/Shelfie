import type { NextRequest } from "next/server";
import { intakeStore, IntakeError } from "@/lib/intake";
import { failure, readBody, reply, sameOrigin, SESSION_COOKIE } from "@/lib/intake-http";
import { lookupBarcode } from "@/lib/barcode";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const token = request.cookies.get(SESSION_COOKIE)?.value || "";
    const store = intakeStore();
    await store.requireEligible(token);
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new IntakeError("Choose a barcode action.");
    if (body.action === "lookup" && Object.keys(body).every(key => ["action", "barcode"].includes(key))) {
      await store.photoAttempt(token);
      const product = await lookupBarcode(body.barcode);
      if (!product) return reply({ found: false, message: "We don’t have a usable ingredient list for that barcode. Photograph the ingredients instead. Your free report hasn’t been used." });
      const lookupId = await store.saveBarcodeLookup(token, product);
      return reply({ found: true, product, lookupId });
    }
    if (body.action === "confirm" && body.confirmed === true && typeof body.lookupId === "string" && /^[a-f0-9-]{36}$/.test(body.lookupId) && Number.isSafeInteger(body.revision) && body.revision >= 0 && Object.keys(body).every(key => ["action", "confirmed", "lookupId", "revision"].includes(key))) {
      return reply(await store.useBarcodeLookup(token, body.lookupId, body.revision));
    }
    throw new IntakeError("Confirm the product and its ingredient list, or look up another barcode.");
  } catch (error) { return failure(error); }
}
