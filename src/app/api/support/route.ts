import type { NextRequest } from "next/server";
import { SupportStore, sendSupportNotification, validateSupport } from "@/lib/support";
import { prepareReviewPhoto } from "@/lib/photo-review";
import { uploadForm } from "@/lib/photo-upload";
import { sameOrigin, failure, reply } from "@/lib/intake-http";
import { IntakeError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60;
let active = 0;
export async function POST(request: NextRequest) {
  let admitted = false, store: SupportStore | undefined;
  try {
    sameOrigin(request,"multipart/form-data");
    if (active >= 2) throw new IntakeError("Messaging is busy. Please try again in a moment.",429);
    active++; admitted = true;
    const form = await uploadForm(request);
    if (form.get("website")) return reply({ ignored:true });
    const input = validateSupport({ name:form.get("name"),email:form.get("email"),message:form.get("message") });
    const screenshots = form.getAll("screenshot");
    if (screenshots.length > 1 || screenshots.some(file => !(file instanceof File))) throw new IntakeError("Choose just one optional screenshot.");
    const screenshot = screenshots[0] as File | undefined;
    const image = screenshot?.size ? await prepareReviewPhoto(Buffer.from(await screenshot.arrayBuffer())) : undefined;
    const reference = String(form.get("requestId") || "");
    const value = { ...input, screenshot:image?.bytes };
    store = new SupportStore(process.env.DATABASE_URL);
    const saved = await store.save(value,reference);
    if (saved.emailState !== 'accepted') {
      try { await sendSupportNotification(value,reference); await store.markDelivery(reference,'accepted'); saved.emailState='accepted'; }
      catch { await store.markDelivery(reference,'failed'); saved.emailState='failed'; }
    }
    return reply(saved);
  } catch(error) { return failure(error); }
  finally { if(admitted)active--; await store?.close(); }
}
