import type { NextRequest } from "next/server";
import { intakeStore, IntakeError } from "@/lib/intake";
import { sameOrigin,readBody,reply,failure,SESSION_COOKIE } from "@/lib/intake-http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const token=request.cookies.get(SESSION_COOKIE)?.value||"",store=intakeStore();
    await store.requireEligible(token);
    const value=await readBody(request);
    if(!value||!Object.hasOwn(value,"skinProfile")||Object.keys(value).some(key=>key!=="skinProfile"))throw new IntakeError("Submit only your skin profile.");
    return reply(await store.updateSkinProfile(token,value.skinProfile));
  }catch(error){return failure(error);}
}
