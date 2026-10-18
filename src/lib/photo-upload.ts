import { IntakeError } from "./intake";
import { MAX_PHOTO_BYTES, MAX_PHOTOS, MAX_UPLOAD_BYTES, PHOTO_UPLOAD_TOO_LARGE } from "./photo-limits";

export async function photoForm(request: Request) {
  const limit = MAX_UPLOAD_BYTES;
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > limit) throw new IntakeError(PHOTO_UPLOAD_TOO_LARGE, 413);
  if (!request.body) throw new IntakeError("Choose a photo first.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new IntakeError(PHOTO_UPLOAD_TOO_LARGE, 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type") || "" }, body: Buffer.concat(chunks) }).formData(); }
  catch { throw new IntakeError("We couldn’t open this upload. Please choose the photos again."); }
  const files = form.getAll("photos");
  if (files.some(file => !(file instanceof File))) throw new IntakeError("Please choose image files.");
  if (files.length > MAX_PHOTOS || files.some(file => (file as File).size > MAX_PHOTO_BYTES)) throw new IntakeError("Use up to six photos, 6 MB each.", 413);
  let existingIds: string[];
  try {
    const raw = form.get("existingIds");
    existingIds = raw ? JSON.parse(String(raw)) : [];
    if (!Array.isArray(existingIds) || existingIds.length > MAX_PHOTOS || existingIds.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) || new Set(existingIds).size !== existingIds.length) throw new Error();
  } catch { throw new IntakeError("Please refresh your saved photos and try again."); }
  const revisionValue = form.get("revision");
  const revision = Number(revisionValue);
  if (typeof revisionValue !== "string" || !/^\d+$/.test(revisionValue) || !Number.isSafeInteger(revision)) throw new IntakeError("Please refresh your photos and try again.");
  if (files.length + existingIds.length < 1 || files.length + existingIds.length > MAX_PHOTOS) throw new IntakeError("Choose between one and six photos of this product.");
  const reviewConsent = form.get("reviewConsent") === "photo-review-v1";
  const reviewReason = form.get("reviewReason");
  return { files: files as File[], existingIds, revision, reviewConsent,
    reviewReason: typeof reviewReason === "string" ? reviewReason : "" };
}
