import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function nativeTestHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    Pragma: "no-cache",
  };
}

export function nativeTestJson(status: number, payload: any) {
  return NextResponse.json(payload, { status, headers: nativeTestHeaders() });
}

export function nativeDriverTestAuthorized(req: Request): boolean {
  if (String(process.env.VERCEL_ENV || "").trim().toLowerCase() !== "preview") return false;
  if (String(req.headers.get("x-jride-agrimarket-native-test") || "").trim() !== "1") return false;
  // Preview intentionally does not carry the production DRIVER_PING_SECRET.
  // The route must still receive the debug app's secret header, then the
  // central driver resolver binds state-changing requests to a fresh
  // driver_device_locks(driver_id, device_id) row.
  const supplied = String(req.headers.get("x-jride-driver-secret") || "").trim();
  return supplied.length > 0;
}

export function nativeTestOrderCode(driverId: string): string {
  return `AGT-${String(driverId || "").replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function normalizeVehicle(value: unknown): "motorcycle" | "tricycle" {
  const raw = String(value || "").trim().toLowerCase();
  return raw.includes("tricycle") || raw.includes("trike") || raw.includes("toda")
    ? "tricycle"
    : "motorcycle";
}

function clampLat(value: number): number {
  return Math.max(-89.999, Math.min(89.999, value));
}

function clampLng(value: number): number {
  let out = value;
  while (out > 180) out -= 360;
  while (out < -180) out += 360;
  return out;
}

export async function ensureNativeDriverTestFixture(driverId: string) {
  const admin = supabaseAdmin();
  const orderCode = nativeTestOrderCode(driverId);

  const existing = await admin
    .from("agrimarket_orders")
    .select("id,order_code,producer_id,status,assigned_driver_id")
    .eq("order_code", orderCode)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    return { ok: false, error: "NATIVE_TEST_ORDER_LOOKUP_FAILED", message: existing.error.message };
  }

  if (existing.data) {
    const order: any = existing.data;
    if (["completed", "cancelled", "producer_rejected", "producer_timeout"].includes(String(order.status))) {
      return { ok: true, complete: true, order };
    }

    if (!order.assigned_driver_id) {
      const offerRead = await admin
        .from("agrimarket_driver_offers")
        .select("id,status,expires_at")
        .eq("order_id", order.id)
        .eq("driver_id", driverId)
        .limit(1)
        .maybeSingle();
      if (offerRead.error) {
        return { ok: false, error: "NATIVE_TEST_OFFER_LOOKUP_FAILED", message: offerRead.error.message };
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      if (offerRead.data) {
        const offer: any = offerRead.data;
        if (String(offer.status) !== "offered" || Date.parse(String(offer.expires_at)) <= now.getTime()) {
          const refreshed = await admin
            .from("agrimarket_driver_offers")
            .update({
              status: "offered",
              offered_at: now.toISOString(),
              expires_at: expiresAt,
              responded_at: null,
              reason_code: "native_test_offer_refreshed",
              updated_at: now.toISOString(),
            })
            .eq("id", offer.id);
          if (refreshed.error) {
            return { ok: false, error: "NATIVE_TEST_OFFER_REFRESH_FAILED", message: refreshed.error.message };
          }
        }
      } else {
        const inserted = await admin.from("agrimarket_driver_offers").insert({
          order_id: order.id,
          driver_id: driverId,
          offer_rank: 1,
          status: "offered",
          assignment_anchor: "farmer",
          pickup_road_distance_km: 0,
          pickup_distance_fee: 0,
          estimated_seconds_to_first_pickup: 60,
          estimated_seconds_to_farmer: 60,
          offered_at: now.toISOString(),
          expires_at: expiresAt,
          reason_code: "native_test_offer",
        });
        if (inserted.error) {
          return { ok: false, error: "NATIVE_TEST_OFFER_CREATE_FAILED", message: inserted.error.message };
        }
      }
    }

    return { ok: true, complete: false, order };
  }

  const location = await admin
    .from("driver_locations_latest")
    .select("driver_id,lat,lng,status,town,vehicle_type,updated_at")
    .eq("driver_id", driverId)
    .limit(1)
    .maybeSingle();

  if (location.error || !location.data) {
    return {
      ok: false,
      error: "NATIVE_TEST_DRIVER_LOCATION_REQUIRED",
      message: "Go Online in the Driver app first so JRide has a current test location.",
    };
  }

  const loc: any = location.data;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "NATIVE_TEST_DRIVER_LOCATION_INVALID" };
  }

  const vehicle = normalizeVehicle(loc.vehicle_type);
  const nowIso = new Date().toISOString();
  const producerInsert = await admin
    .from("agrimarket_producers")
    .insert({
      contact_name: "JRide TEST Farmer - DO NOT PAY",
      town: String(loc.town || "JRide Test Area"),
      barangay: "NATIVE TEST ONLY",
      pickup_label: "JRide TEST Farmer Pin - NO REAL TRANSACTION",
      pickup_lat: lat,
      pickup_lng: lng,
      status: "active",
      accepting_orders: true,
      joining_fee: 0,
      listing_fee: 0,
      marketplace_fee_percent: 0,
    })
    .select("id")
    .single();

  if (producerInsert.error || !producerInsert.data) {
    return { ok: false, error: "NATIVE_TEST_PRODUCER_CREATE_FAILED", message: producerInsert.error?.message };
  }

  const producerId = String((producerInsert.data as any).id);
  const customerLat = clampLat(lat + 0.0015);
  const customerLng = clampLng(lng + 0.0015);

  const orderInsert = await admin
    .from("agrimarket_orders")
    .insert({
      order_code: orderCode,
      customer_user_id: driverId,
      delivery_label: "JRide TEST Customer - DO NOT COLLECT REAL CASH",
      delivery_lat: customerLat,
      delivery_lng: customerLng,
      producer_id: producerId,
      status: "dispatching",
      producer_responded_at: nowIso,
      producer_accepted_at: nowIso,
      preparation_minutes: 0,
      ready_at: nowIso,
      preferred_vehicle_type: vehicle,
      required_vehicle_type: "either",
      route_distance_km: 0,
      route_duration_seconds: 60,
      product_subtotal: 0,
      delivery_fee: 0,
      marketplace_fee: 0,
      handling_fee: 0,
      pricing_version: 1,
      delivery_base_fee: 0,
      delivery_distance_fee: 0,
      delivery_rate_per_km: 0,
      delivery_company_cut: 0,
      pricing_snapshot: {
        native_driver_test: true,
        native_driver_test_version: 1,
        native_test_driver_id: driverId,
        warning: "NO_REAL_MONEY",
      },
      producer_product_net: 0,
      cash_collection_required: false,
      cash_collection_amount: 0,
      route_plan: "farmer_first",
      assignment_anchor: "farmer",
      farmer_to_customer_distance_km: 0,
      farmer_to_customer_duration_seconds: 60,
      pickup_distance_fee: 0,
      fulfillment_mode: "always_available",
      wallet_settlement_status: "not_due",
      wallet_settlement_amount: 0,
    })
    .select("id,order_code,producer_id,status")
    .single();

  if (orderInsert.error || !orderInsert.data) {
    await admin.from("agrimarket_producers").delete().eq("id", producerId);
    return { ok: false, error: "NATIVE_TEST_ORDER_CREATE_FAILED", message: orderInsert.error?.message };
  }

  const order: any = orderInsert.data;
  const itemInsert = await admin.from("agrimarket_order_items").insert({
    order_id: order.id,
    product_id: null,
    product_name: "JRide TEST Vegetables - NO REAL GOODS",
    product_group: "produce",
    condition_required: "normal",
    cargo_class: "standard_produce",
    selling_unit: "test bundle",
    unit_price: 0,
    quantity: 1,
    handling_eligible: false,
    availability_mode: "always_available",
  });

  if (itemInsert.error) {
    await admin.from("agrimarket_orders").delete().eq("id", order.id);
    await admin.from("agrimarket_producers").delete().eq("id", producerId);
    return { ok: false, error: "NATIVE_TEST_ITEM_CREATE_FAILED", message: itemInsert.error.message };
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const offerInsert = await admin.from("agrimarket_driver_offers").insert({
    order_id: order.id,
    driver_id: driverId,
    offer_rank: 1,
    status: "offered",
    assignment_anchor: "farmer",
    pickup_road_distance_km: 0,
    pickup_distance_fee: 0,
    estimated_seconds_to_first_pickup: 60,
    estimated_seconds_to_farmer: 60,
    offered_at: nowIso,
    expires_at: expiresAt,
    reason_code: "native_test_offer",
  });

  if (offerInsert.error) {
    await admin.from("agrimarket_orders").delete().eq("id", order.id);
    await admin.from("agrimarket_producers").delete().eq("id", producerId);
    return { ok: false, error: "NATIVE_TEST_OFFER_CREATE_FAILED", message: offerInsert.error.message };
  }

  return { ok: true, complete: false, created: true, order };
}
