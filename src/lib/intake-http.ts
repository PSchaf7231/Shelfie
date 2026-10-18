import { NextResponse } from "next/server";
import { IntakeError } from "./intake";

export const SESSION_COOKIE = "shelfie_session";
export function sameOrigin(request: Request, contentType = "application/json") {
  // Next can normalize request.url to localhost; use the actual incoming Host.
  let origin: URL;
  try { origin = new URL(request.headers.get("origin") || ""); }
  catch { throw new IntakeError("Please submit from Shelfie.", 403); }
  if (origin.host !== request.headers.get("host") || !["http:", "https:"].includes(origin.protocol) || request.headers.get("sec-fetch-site") === "cross-site") throw new IntakeError("Please submit from Shelfie.", 403);
  if (!request.headers.get("content-type")?.startsWith(contentType)) throw new IntakeError("Unexpected request format.", 415);
}
export async function readBody(request: Request) {
  const body = await request.text();
  if (body.length > 4096) throw new IntakeError("Request too large.", 413);
  try { return JSON.parse(body); } catch { throw new IntakeError("Invalid request."); }
}
export function reply(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
export function setSession(response: NextResponse, token: string, verified = false) {
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: verified ? 86400 : 600 });
  return response;
}
export function failure(error: unknown) {
  return reply({ error: error instanceof IntakeError ? error.message : "Something went wrong. Please try again." }, error instanceof IntakeError ? error.status : 500);
}
