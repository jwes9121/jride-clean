import { NextRequest } from "next/server";
import { agrimarketFarmerPortalEnabled, agrimarketFarmerPortalDisabledResponse,
  createServiceSupabase, jsonNoStore, requireAgrimarketProducer } from "../../_lib/server";
import { driverDirectionsError } from "@/lib/agrimarket/farmer-profile-validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const COLUMNS = "id,vendor_name,town,status,accepting_orders,store_open,contact_name,contact_phone,barangay,pickup_label,pickup_lat,pickup_lng,pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_driver_directions";

function completeProfile(store: any) {
  const name = String(store.contact_name || "").trim();
  const pickup = String(store.pickup_label || "").trim();
  const vendor = String(store.vendor_name || "").trim();
  const phone = String(store.contact_phone || "").trim();
  const barangay = String(store.barangay || "").trim();
  const directions = String(store.pickup_driver_directions || "").trim();
  const directionsReady = !driverDirectionsError({
    directions,
    contactName: name,
    vendorName: vendor,
    town: store.town,
    barangay,
  });
  const pickupReady =
    pickup.length >= 2 &&
    !pickup.toUpperCase().startsWith("PROFILE PENDING") &&
    Number.isFinite(Number(store.pickup_lat)) &&
    Number.isFinite(Number(store.pickup_lng));
  const accessReady =
    store.pickup_motorcycle_accessible === true ||
    store.pickup_tricycle_accessible === true;

  return (
    name.length >= 2 &&
    !name.toLowerCase().includes("profile pending") &&
    vendor.length >= 2 &&
    phone.length >= 10 &&
    barangay.length >= 2 &&
    pickupReady &&
    accessReady &&
    directionsReady
  );
}

function payload(store: any) {
  const profileComplete = completeProfile(store);
  return {
    name: store.vendor_name || null,
    town: store.town,
    ready: store.status === "active" && store.accepting_orders === true,
    open: store.store_open === true,
    profile_complete: profileComplete,
    setup_required: !profileComplete,
  };
}

export async function GET(req: NextRequest) {
  if (!agrimarketFarmerPortalEnabled()) return agrimarketFarmerPortalDisabledResponse();
  try {
    const auth = await requireAgrimarketProducer(req);
    if (!auth.ok) return auth.response;
    const result = await createServiceSupabase().from("agrimarket_producers")
      .select(COLUMNS).eq("id", auth.producer.id).maybeSingle();
    if (result.error || !result.data) return jsonNoStore(503, { ok: false, message: "Store status could not be loaded. Tap Retry." });
    return jsonNoStore(200, { ok: true, store: payload(result.data) });
  } catch {
    return jsonNoStore(503, { ok: false, message: "Store status could not be loaded. Tap Retry." });
  }
}

export async function POST(req: NextRequest) {
  if (!agrimarketFarmerPortalEnabled()) return agrimarketFarmerPortalDisabledResponse();
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) {
    return jsonNoStore(403, { ok: false, message: "Open your store from the JRide farmer workspace." });
  }
  try {
    const auth = await requireAgrimarketProducer(req);
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => ({}));
    if (typeof body.open !== "boolean") return jsonNoStore(400, { ok: false, message: "Choose Open or Closed." });
    // Only the farmer's trading switch changes. Admin readiness stays authoritative.
    let update = createServiceSupabase().from("agrimarket_producers")
      .update({ store_open: body.open, updated_at: new Date().toISOString() })
      .eq("id", auth.producer.id).eq("status", "active");
    if (body.open) update = update.eq("accepting_orders", true);
    const result = await update.select(COLUMNS).maybeSingle();
    if (result.error || !result.data) return jsonNoStore(409, { ok: false,
      message: "Store status could not be changed. JRide must approve your store for orders before you can open it. Refresh to check its status." });
    return jsonNoStore(200, { ok: true, store: payload(result.data) });
  } catch {
    return jsonNoStore(503, { ok: false, message: "Store update interrupted. Refresh to check its status." });
  }
}
