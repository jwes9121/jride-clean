import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { agrimarketFarmerPortalDisabledResponse, agrimarketFarmerPortalEnabled, createServiceSupabase, jsonNoStore, requireAgrimarketProducer } from "../../../_lib/server";
import { managedPhotoPath, MAX_PHOTO_INPUT, normalizeProductPhoto, PRODUCT_PHOTO_BUCKET } from "@/lib/agrimarket/product-photo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function changePhoto(req: NextRequest, removing: boolean) {
  if (!agrimarketFarmerPortalEnabled()) return agrimarketFarmerPortalDisabledResponse();
  try {
    const auth = await requireAgrimarketProducer(req);
    if (!auth.ok) return auth.response;
    // Bound the entire body even if Content-Length is absent or dishonest.
    const limit = removing ? 1024 : MAX_PHOTO_INPUT + 16 * 1024;
    if (Number(req.headers.get("content-length")) > limit) return jsonNoStore(413, { ok: false, message: "Choose a smaller photo." });
    const reader = req.body?.getReader();
    if (!reader) return jsonNoStore(400, { ok: false, message: "A product and photo are required." });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); return jsonNoStore(413, { ok: false, message: "Choose a smaller photo." }); }
      chunks.push(chunk.value);
    }
    const body = new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers.get("content-type") || "" } });
    let productId: unknown, file: FormDataEntryValue | null = null;
    try {
      if (removing) productId = (await body.json()).product_id;
      else { const form = await body.formData(); productId = form.get("product_id"); file = form.get("file"); }
    } catch { return jsonNoStore(400, { ok: false, message: "The photo request could not be read." }); }
    if (typeof productId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) return jsonNoStore(400, { ok: false, message: "A valid product is required." });
    const admin = createServiceSupabase();
    const current = await admin.from("agrimarket_products").select("id,photo_urls,updated_at").eq("id", productId).eq("producer_id", auth.producer.id).maybeSingle();
    if (current.error) return jsonNoStore(503, { ok: false, message: "Product photos are temporarily unavailable." });
    if (!current.data) return jsonNoStore(404, { ok: false, message: "Product not found in your farm shelf." });
    const storage = admin.storage.from(PRODUCT_PHOTO_BUCKET);
    let newPath: string | null = null;
    let photoUrls: string[] = [];
    if (!removing) {
      if (!file || typeof file === "string") return jsonNoStore(400, { ok: false, message: "Choose a product photo." });
      let output: Buffer;
      try { output = await normalizeProductPhoto(file); }
      catch { return jsonNoStore(400, { ok: false, message: "Choose a still JPG, PNG or WebP photo under 3 MB. The image must be readable and no larger than 40 megapixels." }); }
      // Random filenames disclose neither the farmer UUID nor the original filename.
      newPath = `${randomUUID()}.webp`;
      const uploaded = await storage.upload(newPath, output, { contentType: "image/webp", cacheControl: "3600", upsert: false });
      if (uploaded.error) return jsonNoStore(503, { ok: false, message: "The photo could not be uploaded. Your existing photo is unchanged." });
      photoUrls = [storage.getPublicUrl(newPath).data.publicUrl];
    }
    const updated = await admin.from("agrimarket_products").update({ photo_urls: photoUrls, updated_at: new Date().toISOString() })
      .eq("id", productId).eq("producer_id", auth.producer.id).eq("updated_at", current.data.updated_at).select("id,photo_urls").maybeSingle();
    if (updated.error || !updated.data) {
      if (newPath) await storage.remove([newPath]).catch(() => undefined);
      return jsonNoStore(409, { ok: false, message: "The product changed while saving its photo. Refresh and try again." });
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const oldPaths = (Array.isArray(current.data.photo_urls) ? current.data.photo_urls : []).map((url: unknown) => managedPhotoPath(url, supabaseUrl)).filter((path: string | null): path is string => !!path);
    if (oldPaths.length) await storage.remove(oldPaths).catch(() => undefined);
    return jsonNoStore(200, { ok: true, product: updated.data });
  } catch {
    return jsonNoStore(503, { ok: false, message: "The photo update was interrupted. Refresh the product to check what was saved." });
  }
}

export const POST = (req: NextRequest) => changePhoto(req, false);
export const DELETE = (req: NextRequest) => changePhoto(req, true);
