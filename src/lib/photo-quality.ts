import sharp from "sharp";
import { IntakeError } from "./errors";
import { MAX_PHOTOS, MAX_PHOTO_BYTES } from "./photo-limits";

export { MAX_PHOTOS, MAX_PHOTO_BYTES } from "./photo-limits";
export type PreparedPhoto = { bytes: Buffer; width: number; height: number };
export class QualityError extends IntakeError {
  constructor(message: string) { super(message, 422); }
}

export async function preparePhoto(bytes: Buffer): Promise<PreparedPhoto> {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new IntakeError("Each photo must be 6 MB or smaller.", 413);
  try {
    const image = sharp(bytes, { limitInputPixels: 24000000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp", "heif"].includes(metadata.format || "") || (metadata.pages ?? 1) !== 1) throw new QualityError("Choose a still JPG, PNG, WebP, or supported HEIC photo.");
    if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 480) throw new QualityError("Take a closer, higher-resolution photo so the small label text is readable.");
    // Decode, rotate, and strip EXIF (including location), never trust file extensions.
    const { data, info } = await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true });
    const grey = await sharp(data).resize({ width: 512, height: 512, fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const pixels = grey.data;
    const mean = pixels.reduce((total, value) => total + value, 0) / pixels.length;
    if (mean < 35) throw new QualityError("This photo is too dark. Use bright, even light without a shadow, then retake it.");
    let total = 0, totalSquared = 0, count = 0;
    for (let y = 1; y < grey.info.height - 1; y++) for (let x = 1; x < grey.info.width - 1; x++) {
      const i = y * grey.info.width + x;
      const edge = pixels[i - 1] + pixels[i + 1] + pixels[i - grey.info.width] + pixels[i + grey.info.width] - 4 * pixels[i];
      total += edge; totalSquared += edge * edge; count++;
    }
    const variance = totalSquared / count - (total / count) ** 2;
    if (variance < 18) throw new QualityError("This photo looks blurry or has no readable label detail. Hold steady and take a clearer photo.");
    return { bytes: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof IntakeError) throw error;
    throw new QualityError("We couldn’t open this photo. Please retake it or upload a JPG or PNG.");
  }
}
