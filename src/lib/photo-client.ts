import { MAX_PHOTOS, MAX_PHOTO_EDGE, MAX_PREPARED_PHOTO_BYTES, MAX_SOURCE_PHOTO_BYTES, PHOTO_UPLOAD_TOO_LARGE } from "./photo-limits";

export type Photo = { id: string; url: string; file?: File };
export type PhotoBatch = { revision: number; draftKey: string; photos: Photo[]; message?: string };
export class PhotoClientError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

export async function readPhotoResponse(response: Response, fallback: string): Promise<unknown> {
  if (response.status === 413) throw new PhotoClientError(PHOTO_UPLOAD_TOO_LARGE, 413);
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new PhotoClientError(fallback, response.status); }
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? data.error : undefined;
    const technical = typeof error === "string" && /unexpected token|not valid json|syntaxerror|request entity/i.test(error);
    throw new PhotoClientError(typeof error === "string" && error.length <= 400 && !technical ? error : fallback, response.status);
  }
  return data;
}

export function photoBatchResponse(data: unknown, fallback: string): PhotoBatch {
  const batch = data as PhotoBatch | null;
  if (!batch || !Number.isSafeInteger(batch.revision) || batch.revision < 0 || !/^[a-f0-9]{64}$/.test(batch.draftKey)
    || !Array.isArray(batch.photos) || batch.photos.length > MAX_PHOTOS
    || batch.photos.some(photo => !photo || typeof photo.id !== "string" || !/^[a-f0-9-]{36}$/.test(photo.id) || photo.url !== `/api/photos/${photo.id}`)
    || new Set(batch.photos.map(photo => photo.id)).size !== batch.photos.length) throw new PhotoClientError(fallback);
  return { revision: batch.revision, draftKey: batch.draftKey, photos: batch.photos.map(photo => ({ id: photo.id, url: photo.url })),
    ...(typeof batch.message === "string" && batch.message.length <= 400 ? { message: batch.message } : {}) };
}

export function addLabelPhotos(current: Photo[], incoming: Photo[], replaceId?: string): Photo[] {
  if (replaceId) {
    const index = current.findIndex(photo => photo.id === replaceId);
    if (index < 0 || incoming.length !== 1) throw new PhotoClientError("Choose the photo you want to retake again.");
    return current.map((photo, position) => position === index ? incoming[0] : photo);
  }
  if (current.length + incoming.length > MAX_PHOTOS) throw new PhotoClientError("Use up to six photos of the same product. Remove a photo before adding more.");
  return [...current, ...incoming];
}

export async function preparePhotoForUpload(file: File, turnClockwise = false, allowSmall = false): Promise<File> {
  if (!file.size || file.size > MAX_SOURCE_PHOTO_BYTES) throw new PhotoClientError("This photo is too large to open. Take a closer photo of the ingredient list and try again.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new PhotoClientError("Your phone couldn’t open this photo. Choose a JPG or PNG, or use Take a photo."));
      image.src = url;
    });
    if (!allowSmall && Math.min(image.naturalWidth, image.naturalHeight) < 480) throw new PhotoClientError("This photo is too small to read the label. Take a closer, higher-resolution photo.");
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * scale), height = Math.round(image.naturalHeight * scale);
    canvas.width = turnClockwise ? height : width;
    canvas.height = turnClockwise ? width : height;
    if (!allowSmall && Math.min(canvas.width, canvas.height) < 480) throw new PhotoClientError("Take a closer photo of one section of the ingredient list. Add overlapping photos for a long label.");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new PhotoClientError("Your phone couldn’t prepare this photo. Please try another photo.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    if (turnClockwise) context.rotate(Math.PI / 2);
    context.drawImage(image, -width / 2, -height / 2, width, height);
    // Keep label detail. If these encodings are too large, ask for a closer shot
    // instead of repeatedly shrinking the text until it cannot be read.
    for (const quality of [0.94, 0.9, 0.85]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_PREPARED_PHOTO_BYTES) return new File([blob], "ingredient-label.jpg", { type: "image/jpeg" });
    }
    throw new PhotoClientError("Take a closer photo that fills the frame with the ingredient list. This photo couldn’t be made small enough to send clearly.");
  } catch (error) {
    if (error instanceof PhotoClientError) throw error;
    throw new PhotoClientError("Your phone couldn’t prepare this photo. Please try another photo.");
  } finally {
    URL.revokeObjectURL(url);
    image.src = "";
    canvas.width = 0; canvas.height = 0;
  }
}
