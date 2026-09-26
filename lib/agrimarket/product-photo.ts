import sharp from "sharp";

export const PRODUCT_PHOTO_BUCKET = "agrimarket-product-photos";
export const MAX_PHOTO_INPUT = 3 * 1024 * 1024;
export const MAX_PHOTO_OUTPUT = 1024 * 1024;
const TARGET_PHOTO_OUTPUT = 700 * 1024;
const formats = new Set(["jpeg", "png", "webp"]);
const DIMENSION_STEPS = [1600, 1400, 1200, 1000, 900];
const QUALITY_STEPS = [82, 74, 66, 58, 50];

export async function normalizeProductPhoto(file: File): Promise<Buffer> {
  if (!file.size || file.size > MAX_PHOTO_INPUT) {
    throw new Error("Choose a JPG, PNG or WebP photo under 3 MB.");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG or WebP photo.");
  }

  const input = Buffer.from(await file.arrayBuffer());
  const probe = sharp(input, { limitInputPixels: 40_000_000, failOn: "error" });
  const metadata = await probe.metadata();
  if (!formats.has(metadata.format || "") || (metadata.pages || 1) !== 1) {
    throw new Error("Choose a still JPG, PNG or WebP photo.");
  }

  let smallest: Buffer | null = null;

  for (const maxSide of DIMENSION_STEPS) {
    for (const quality of QUALITY_STEPS) {
      // Re-encoding without keepMetadata removes EXIF GPS, camera identifiers,
      // embedded thumbnails, and other metadata. rotate() honors orientation.
      const output = await sharp(input, { limitInputPixels: 40_000_000, failOn: "error" })
        .rotate()
        .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();

      if (!smallest || output.length < smallest.length) smallest = output;
      if (output.length <= TARGET_PHOTO_OUTPUT) return output;
    }
  }

  if (!smallest || smallest.length > MAX_PHOTO_OUTPUT) {
    throw new Error("This photo is too detailed to store safely.");
  }
  return smallest;
}

export function managedPhotoPath(url: unknown, supabaseUrl: string): string | null {
  if (typeof url !== "string") return null;
  const prefix = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${PRODUCT_PHOTO_BUCKET}/`;
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/.test(path) ? path : null;
}
