import type { NextRequest } from "next/server";
import { IntakeError, intakeStore } from "@/lib/intake";
import { failure, SESSION_COOKIE } from "@/lib/intake-http";

export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const batch = await intakeStore().photoBatch(request.cookies.get(SESSION_COOKIE)?.value || "");
    const photo = batch.photos.find(photo => photo.id === id);
    if (!photo) throw new IntakeError("Photo not found.", 404);
    return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
  } catch (error) { return failure(error); }
}
