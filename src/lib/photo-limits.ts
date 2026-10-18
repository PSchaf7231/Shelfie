// Shared with the browser: leave room below Vercel's 4.5 MB request limit.
export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 4_000_000;
export const MAX_PREPARED_PHOTO_BYTES = 600_000;
export const MAX_SOURCE_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_EDGE = 2400;
export const PHOTO_UPLOAD_TOO_LARGE = "These photos are too large to send together. Remove one photo and try again. Your free report hasn’t been used.";
