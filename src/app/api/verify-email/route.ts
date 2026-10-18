import type { NextRequest } from "next/server";
import { IntakeError, intakeStore } from "@/lib/intake";
import { failure, readBody, reply, sameOrigin, SESSION_COOKIE, setSession } from "@/lib/intake-http";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const data = await readBody(request);
    if (!data || typeof data.code !== "string") throw new IntakeError("Enter the six-digit code from your email.");
    const store = intakeStore();
    const token = await store.verify(request.cookies.get(SESSION_COOKIE)?.value || "", data.code.trim());
    return setSession(reply(await store.status(token)), token, true);
  } catch (error) { return failure(error); }
}
