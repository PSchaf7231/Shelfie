import sharp from "sharp";
import { IntakeError } from "./errors";
import { MAX_PHOTO_BYTES } from "./photo-limits";

// Review copies must include rejected dark/blurry images. Decode and strip
// metadata without passing them through the normal readability gate.
export async function prepareReviewPhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new IntakeError("This photo is too large to share.", 413);
  try {
    const image = sharp(bytes, { limitInputPixels: 24000000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp", "heif"].includes(metadata.format || "") || (metadata.pages ?? 1) !== 1) throw new Error();
    for (const quality of [90, 80, 70]) {
      const { data, info } = await image.clone().rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#fff" }).jpeg({ quality }).toBuffer({ resolveWithObject: true });
      if (data.length <= 600000) return { bytes: data, width: info.width, height: info.height };
    }
    throw new IntakeError("This photo is too large to share clearly.", 413);
  } catch (error) {
    if (error instanceof IntakeError) throw error;
    throw new IntakeError("We couldn’t open this photo for review. Your other photos are unchanged.", 422);
  }
}
