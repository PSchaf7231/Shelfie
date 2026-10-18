import type { NextRequest } from "next/server";
import { IntakeError, intakeStore } from "@/lib/intake";
import { failure, reply, sameOrigin, SESSION_COOKIE } from "@/lib/intake-http";
import { checkLabelQuality, preparePhoto, type PreparedPhoto } from "@/lib/photo-quality";
import { photoForm } from "@/lib/photo-upload";

export const runtime = "nodejs";
let activeUploads = 0;
function describe(batch: Awaited<ReturnType<ReturnType<typeof intakeStore>["photoBatch"]>>) {
  return { revision: batch.revision, photos: batch.photos.map(photo => ({ id: photo.id, width: photo.width, height: photo.height, url: `/api/photos/${photo.id}` })) };
}
export async function GET(request: NextRequest) {
  try { return reply(describe(await intakeStore().photoBatch(request.cookies.get(SESSION_COOKIE)?.value || ""))); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  let admitted = false;
  try {
    sameOrigin(request, "multipart/form-data");
    const token = request.cookies.get(SESSION_COOKIE)?.value || "";
    const store = intakeStore();
    // Authorize before reading any upload bytes or invoking a paid provider.
    await store.requireEligible(token);
    if (activeUploads >= 2) throw new IntakeError("The photo check is busy. Please try again in a moment.", 429);
    activeUploads++; admitted = true;
    await store.photoAttempt(token);
    const { files, existingIds, revision } = await photoForm(request);
    const batch = await store.photoBatch(token);
    if (batch.revision !== revision) throw new IntakeError("Your photos changed in another tab. Refresh before trying again.", 409);
    const retained = existingIds.map(id => {
      const photo = batch.photos.find(photo => photo.id === id);
      if (!photo) throw new IntakeError("This saved photo is unavailable. Please refresh and try again.", 400);
      return photo;
    });
    const images: PreparedPhoto[] = [...retained];
    // Decode sequentially to bound memory use when six large images are submitted.
    for (let i = 0; i < files.length; i++) {
      try { images.push(await preparePhoto(Buffer.from(await files[i].arrayBuffer()))); }
      catch (error) {
        if (error instanceof IntakeError) throw new IntakeError(`New photo ${i + 1}: ${error.message}`, error.status);
        throw error;
      }
    }
    await checkLabelQuality(images);
    // Recheck eligibility and revision inside the save transaction after async work.
    return reply({ ...describe(await store.savePhotos(token, revision, images)), message: "Photos passed the readability check and are saved. Your free report is still available." });
  } catch (error) { return failure(error); }
  finally { if (admitted) activeUploads--; }
}
