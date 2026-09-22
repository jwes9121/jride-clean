import { CLOSED_CATALOG_VERSION, storeAvailability } from "@/lib/agrimarket/storeAvailability";
import { NextRequest } from "next/server";
import { agrimarketDisabledResponse, agrimarketEnabled, createServiceSupabase, jsonNoStore, requireAgrimarketPassenger } from "../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();
  const auth = await requireAgrimarketPassenger(req);
  if (!auth.ok) return auth.response;
  const productId = req.nextUrl.searchParams.get("product_id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
    return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PRODUCT_REQUIRED" });
  }
  try {
    const admin = createServiceSupabase();
    const product = await admin.from("agrimarket_products").select("producer_id").eq("id", productId).eq("is_active", true).maybeSingle();
    if (product.error) throw product.error;
    if (!product.data) return jsonNoStore(404, { ok: false, message: "This store profile is unavailable." });
    const includeClosed = req.nextUrl.searchParams.get("store_visibility") === CLOSED_CATALOG_VERSION;
    let producerQuery = admin.from("agrimarket_producers").select("vendor_name,town,accepting_orders,store_open,catalog_approved_at")
      .eq("id", product.data.producer_id).eq("status", "active");
    producerQuery = includeClosed
      ? producerQuery.not("catalog_approved_at", "is", null)
      : producerQuery.eq("accepting_orders", true).eq("store_open", true);
    const producer = await producerQuery.maybeSingle();
    if (producer.error) throw producer.error;
    if (!producer.data?.vendor_name?.trim()) return jsonNoStore(404, { ok: false, message: "This store profile is unavailable." });
    return jsonNoStore(200, { ok: true, store: { name: producer.data.vendor_name, town: producer.data.town, ...storeAvailability(producer.data) } });
  } catch {
    return jsonNoStore(503, { ok: false, message: "Unable to load this store profile. Please try again." });
  }
}
