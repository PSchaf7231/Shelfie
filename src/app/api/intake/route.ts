import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { intakeStore, validateIntake } from "@/lib/intake";
import { sendVerification } from "@/lib/email";
import { failure, readBody, reply, sameOrigin, setSession } from "@/lib/intake-http";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = validateIntake(await readBody(request));
    const store = intakeStore();
    const { token, code } = await store.create(input);
    try { await sendVerification(input.email, code, randomUUID()); }
    catch (error) { await store.discard(token); throw error; }
    return setSession(reply({ state: "pending", email: input.email }), token);
  } catch (error) { return failure(error); }
}
