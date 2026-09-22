import { NextRequest } from "next/server";
import { reverseGeocodeFarmerPin } from "../../_lib/admin-farmer-location";
import {
  agrimarketFarmerPortalDisabledResponse,
  agrimarketFarmerPortalEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketProducer,
} from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const COLUMNS =
  "id,contact_name,contact_phone,town,barangay,pickup_label,pickup_lat,pickup_lng,status,accepting_orders,store_open,vendor_name,pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions";

function clean(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function payload(row: any) {
  const contactName = clean(row.contact_name);
  const pickupLabel = clean(row.pickup_label);
  const vendorName = clean(row.vendor_name);
  const barangay = clean(row.barangay);
  const phone = clean(row.contact_phone);
  const pickupPending = pickupLabel.toUpperCase().startsWith("PROFILE PENDING");
  const namePending = contactName.toLowerCase().includes("profile pending");
  const pickupVerified =
    !pickupPending &&
    Number.isFinite(Number(row.pickup_lat)) &&
    Number.isFinite(Number(row.pickup_lng)) &&
    Boolean(pickupLabel);
  const accessReady =
    row.pickup_motorcycle_accessible === true ||
    row.pickup_tricycle_accessible === true;

  return {
    id: row.id,
    contact_name: namePending ? "" : contactName,
    contact_phone: phone,
    town: clean(row.town),
    barangay,
    vendor_name: vendorName,
    pickup_label: pickupPending ? "" : pickupLabel,
    pickup_lat: pickupVerified ? Number(row.pickup_lat) : null,
    pickup_lng: pickupVerified ? Number(row.pickup_lng) : null,
    pickup_motorcycle_accessible: row.pickup_motorcycle_accessible === true,
    pickup_tricycle_accessible: row.pickup_tricycle_accessible === true,
    pickup_roadside_handoff_required: row.pickup_roadside_handoff_required === true,
    pickup_driver_directions: clean(row.pickup_driver_directions),
    pickup_verified: pickupVerified,
    profile_complete:
      !namePending &&
      contactName.length >= 2 &&
      phone.length >= 10 &&
      barangay.length >= 2 &&
      vendorName.length >= 2 &&
      pickupVerified &&
      accessReady,
    accepting_orders: row.accepting_orders === true,
    store_open: row.store_open === true,
  };
}

async function readProfile(admin: any, producerId: string) {
  return admin
    .from("agrimarket_producers")
    .select(COLUMNS)
    .eq("id", producerId)
    .limit(1)
    .maybeSingle();
}

export async function GET(req: NextRequest) {
  if (!agrimarketFarmerPortalEnabled()) return agrimarketFarmerPortalDisabledResponse();

  try {
    const auth = await requireAgrimarketProducer(req);
    if (!auth.ok) return auth.response;
    const result = await readProfile(createServiceSupabase(), auth.producer.id);
    if (result.error || !result.data) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_FARMER_PROFILE_READ_FAILED",
        message: "Your farm profile could not be loaded. Tap Retry.",
      });
    }
    return jsonNoStore(200, { ok: true, profile: payload(result.data) });
  } catch {
    return jsonNoStore(503, {
      ok: false,
      error: "AGRIMARKET_FARMER_PROFILE_READ_FAILED",
      message: "Your farm profile could not be loaded. Tap Retry.",
    });
  }
}

export async function POST(req: NextRequest) {
  if (!agrimarketFarmerPortalEnabled()) return agrimarketFarmerPortalDisabledResponse();
  if (req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) {
    return jsonNoStore(403, {
      ok: false,
      error: "AGRIMARKET_FARMER_PROFILE_ORIGIN_INVALID",
      message: "Open your profile from the JRide farmer workspace.",
    });
  }

  try {
    const auth = await requireAgrimarketProducer(req);
    if (!auth.ok) return auth.response;

    const raw = await req.text();
    if (raw.length > 12000) return jsonNoStore(413, { ok: false });
    const body = JSON.parse(raw || "{}");

    const contactName = clean(body.contact_name);
    const contactPhone = clean(body.contact_phone);
    const barangay = clean(body.barangay);
    const vendorName = clean(body.vendor_name);
    const directions = clean(body.pickup_driver_directions);
    const lat = Number(body.pickup_lat);
    const lng = Number(body.pickup_lng);
    const motorcycle = body.pickup_motorcycle_accessible === true;
    const tricycle = body.pickup_tricycle_accessible === true;
    const roadside = body.pickup_roadside_handoff_required === true;

    if (contactName.length < 2 || contactName.length > 120) {
      return jsonNoStore(400, { ok: false, message: "Enter the farmer's full name." });
    }
    if (contactPhone.length < 10 || contactPhone.length > 30) {
      return jsonNoStore(400, { ok: false, message: "Enter a valid mobile number." });
    }
    if (barangay.length < 2 || barangay.length > 120) {
      return jsonNoStore(400, { ok: false, message: "Enter the farmer's barangay." });
    }
    if (vendorName.length < 2 || vendorName.length > 60) {
      return jsonNoStore(400, { ok: false, message: "Enter a farm or store name between 2 and 60 characters." });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return jsonNoStore(400, { ok: false, message: "Place the actual farm pickup point on the map." });
    }
    if (!motorcycle && !tricycle) {
      return jsonNoStore(400, {
        ok: false,
        message: "Choose at least one vehicle that can reach the pickup point.",
      });
    }
    if (directions && (directions.length < 5 || directions.length > 1000)) {
      return jsonNoStore(400, {
        ok: false,
        message: "Pickup directions must be at least 5 characters when provided.",
      });
    }

    const resolved = await reverseGeocodeFarmerPin(lat, lng);
    if (!resolved?.launch_eligible || resolved.town !== auth.producer.town) {
      return jsonNoStore(422, {
        ok: false,
        message: `The pickup pin must be inside ${auth.producer.town}.`,
      });
    }

    const admin = createServiceSupabase();
    const update = await admin
      .from("agrimarket_producers")
      .update({
        contact_name: contactName,
        contact_phone: contactPhone,
        barangay,
        vendor_name: vendorName,
        pickup_label: resolved.label,
        pickup_lat: lat,
        pickup_lng: lng,
        pickup_motorcycle_accessible: motorcycle,
        pickup_tricycle_accessible: tricycle,
        pickup_roadside_handoff_required: roadside,
        pickup_driver_directions: directions || null,
        store_open: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", auth.producer.id)
      .eq("status", "active")
      .select(COLUMNS)
      .maybeSingle();

    if (update.error || !update.data) {
      return jsonNoStore(409, {
        ok: false,
        error: "AGRIMARKET_FARMER_PROFILE_SAVE_FAILED",
        message: update.error?.message || "Your farm profile could not be saved.",
      });
    }

    return jsonNoStore(200, {
      ok: true,
      profile: payload(update.data),
      message: "Farm profile saved. JRide will review readiness before customer orders are enabled.",
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_FARMER_PROFILE_SAVE_FAILED",
      message: String(error?.message || "Your farm profile could not be saved."),
    });
  }
}
