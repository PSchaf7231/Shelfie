import type { NextRequest } from "next/server";
import { intakeStore, IntakeError } from "@/lib/intake";
import { failure, reply, readBody, sameOrigin, SESSION_COOKIE } from "@/lib/intake-http";
import { photoForm } from "@/lib/photo-upload";
import { prepareReviewPhoto } from "@/lib/photo-review";

export const runtime = "nodejs";
export const maxDuration = 60;
let activeShares = 0;

export async function POST(request: NextRequest) {
  let admitted = false;
  try {
    sameOrigin(request, "multipart/form-data");
    const token = request.cookies.get(SESSION_COOKIE)?.value || "";
    const store = intakeStore();
    await store.requireEligible(token);
    if (activeShares >= 2) throw new IntakeError("Photo sharing is busy. Please try again in a moment.", 429);
    activeShares++; admitted = true;
    const { files, existingIds, revision, reviewConsent, reviewReason } = await photoForm(request);
    if (!reviewConsent) throw new IntakeError("Choose Share photos for review only if you want the support team to see these photos.");
    if (!reviewReason.trim() || reviewReason.length > 400) throw new IntakeError("Include the photo-check message with your photos.");
    const batch = await store.photoBatch(token);
    if (batch.revision !== revision) throw new IntakeError("Your saved photos changed. Refresh before sharing them.", 409);
    const images = [];
    for (const id of existingIds) {
      const photo = batch.photos.find(photo => photo.id === id);
      if (!photo) throw new IntakeError("This saved photo is unavailable. Refresh before sharing it.");
      images.push(await prepareReviewPhoto(photo.bytes));
    }
    for (const file of files) images.push(await prepareReviewPhoto(Buffer.from(await file.arrayBuffer())));
    return reply(await store.sharePhotoReview(token, images, reviewReason));
  } catch (error) { return failure(error); }
  finally { if (admitted) activeShares--; }
}

export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    const value = await readBody(request);
    if (!value || typeof value.reference !== "string" || Object.keys(value).some(key => key !== "reference")) throw new IntakeError("Choose the shared copy you want to delete.");
    await intakeStore().deletePhotoReview(request.cookies.get(SESSION_COOKIE)?.value || "", value.reference);
    return reply({ deleted: true });
  } catch (error) { return failure(error); }
}
