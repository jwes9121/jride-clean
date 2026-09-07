import sharp from "sharp";

export const PRODUCT_PHOTO_BUCKET = "agrimarket-product-photos";
export const MAX_PHOTO_INPUT = 3 * 1024 * 1024;
export const MAX_PHOTO_OUTPUT = 1024 * 1024;
const formats = new Set(["jpeg", "png", "webp"]);

export async function normalizeProductPhoto(file: File): Promise<Buffer> {
  if (!file.size || file.size > MAX_PHOTO_INPUT) throw new Error("Choose a JPG, PNG or WebP photo under 3 MB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP photo.");
  const input = Buffer.from(await file.arrayBuffer());
  const image = sharp(input, { limitInputPixels: 40_000_000, failOn: "error" });
  const metadata = await image.metadata();
  if (!formats.has(metadata.format || "") || (metadata.pages || 1) !== 1) throw new Error("Choose a still JPG, PNG or WebP photo.");
  // Re-encoding without keepMetadata removes GPS, camera and other EXIF data.
  const output = await image.rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  if (output.length > MAX_PHOTO_OUTPUT) throw new Error("This photo is too detailed. Choose a smaller photo.");
  return output;
}

export function managedPhotoPath(url: unknown, supabaseUrl: string): string | null {
  if (typeof url !== "string") return null;
  const prefix = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${PRODUCT_PHOTO_BUCKET}/`;
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/.test(path) ? path : null;
}
