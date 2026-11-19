/**
 * Photos des matières : vignettes privées, une par fiche. Module partagé entre le serveur et le
 * navigateur (aucune dépendance serveur).
 */

export const MATERIAL_PHOTO_BUCKET = "material-photos";
export const MAX_MATERIAL_PHOTO_BYTES = 1_048_576;
/** Côté le plus long de la vignette produite dans le navigateur. */
export const MATERIAL_PHOTO_MAX_SIDE = 480;

export type MaterialPhotoMime = "image/webp" | "image/jpeg" | "image/png";
const extensions: Record<MaterialPhotoMime, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

export function isMaterialPhotoMime(value: string): value is MaterialPhotoMime {
  return value in extensions;
}

export function materialPhotoPath(businessId: string, materialId: string, photoId: string, mime: MaterialPhotoMime): string {
  return `${businessId}/${materialId}/${photoId}.${extensions[mime]}`;
}

/** Reconnaît une image WebP, JPEG ou PNG à ses premiers octets, quel que soit le type annoncé. */
export function detectMaterialPhotoMime(bytes: Uint8Array): MaterialPhotoMime | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
