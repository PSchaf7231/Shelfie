import type { NextRequest } from "next/server";
import { intakeStore } from "@/lib/intake";
import { failure, reply, SESSION_COOKIE } from "@/lib/intake-http";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { return reply(await intakeStore().status(request.cookies.get(SESSION_COOKIE)?.value || "")); }
  catch (error) { return failure(error); }
}
