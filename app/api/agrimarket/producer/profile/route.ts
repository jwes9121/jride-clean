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
  "id,contact_name,contact_phone,town,barangay,pickup_label,pickup_lat,pickup_lng,status,accepting_orders,store_open,vendor_name,vendor_name_locked_at,pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions";

function clean(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizePhilippineMobile(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

function saveFailure(message: string) {
  if (message.includes("FARM_NAME_LOCKED")) {
    return jsonNoStore(409, { ok: false, error: "AGRIMARKET_FARM_NAME_LOCKED",
      message: "Your confirmed farm/store name is locked. Refresh to see the saved name. Contact JRide for a correction." });
  }
  if (message.includes("FARM_NAME_CONFIRMATION_REQUIRED")) {
    return jsonNoStore(409, { ok: false, error: "AGRIMARKET_FARM_NAME_CONFIRMATION_REQUIRED",
      message: "Review and confirm your farm/store name before saving. Once saved, you cannot change this name in the app." });
  }
  if (message.includes("FARMER_PHONE_ALREADY_REGISTERED")) {
    return jsonNoStore(409, {
      ok: false,
      error: "AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED",
      message: "This mobile number is already registered to another AgriMarket farmer account.",
    });
  }
  if (message.includes("PICKUP_DIRECTIONS_REQUIRED")) {
    return jsonNoStore(400, {
      ok: false,
      error: "AGRIMARKET_PICKUP_DIRECTIONS_REQUIRED",
      message: "Enter clear private driver directions or a landmark of at least 5 characters.",
    });
  }
  if (message.includes("INVALID") || message.includes("REQUIRED") || message.includes("NOT_ACTIVE")) {
    return jsonNoStore(400, {
      ok: false,
      error: "AGRIMARKET_FARMER_PROFILE_INVALID",
      message: "Check the farmer name, mobile number, barangay, farm name, pickup point, vehicle access, and driver directions.",
    });
  }
  return jsonNoStore(409, {
    ok: false,
    error: "AGRIMARKET_FARMER_PROFILE_SAVE_FAILED",
    message: "Your farm profile could not be saved. Refresh and try again.",
  });
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
    row.pickup_lat != null && row.pickup_lng != null &&
    Number.isFinite(Number(row.pickup_lat)) &&
    Number.isFinite(Number(row.pickup_lng)) &&
    Boolean(pickupLabel);
  const accessReady =
    row.pickup_motorcycle_accessible === true ||
    row.pickup_tricycle_accessible === true;
  const directions = clean(row.pickup_driver_directions);

  return {
    id: row.id,
    contact_name: namePending ? "" : contactName,
    contact_phone: phone,
    town: clean(row.town),
    barangay,
    vendor_name: vendorName,
    vendor_name_locked: Boolean(row.vendor_name_locked_at),
    pickup_label: pickupPending ? "" : pickupLabel,
    pickup_lat: pickupVerified ? Number(row.pickup_lat) : null,
    pickup_lng: pickupVerified ? Number(row.pickup_lng) : null,
    pickup_motorcycle_accessible: row.pickup_motorcycle_accessible === true,
    pickup_tricycle_accessible: row.pickup_tricycle_accessible === true,
    pickup_roadside_handoff_required: row.pickup_roadside_handoff_required === true,
    pickup_driver_directions: directions,
    pickup_verified: pickupVerified,
    profile_complete:
      !namePending &&
      contactName.length >= 2 &&
      Boolean(normalizePhilippineMobile(phone)) &&
      barangay.length >= 2 &&
      vendorName.length >= 2 &&
      pickupVerified &&
      accessReady &&
      directions.length >= 5,
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
    const lat = body.pickup_lat == null || body.pickup_lat === "" ? NaN : Number(body.pickup_lat);
    const lng = body.pickup_lng == null || body.pickup_lng === "" ? NaN : Number(body.pickup_lng);
    const motorcycle = body.pickup_motorcycle_accessible === true;
    const tricycle = body.pickup_tricycle_accessible === true;
    const roadside = body.pickup_roadside_handoff_required === true;

    if (contactName.length < 2 || contactName.length > 120) {
      return jsonNoStore(400, { ok: false, message: "Enter the farmer's full name." });
    }
    const normalizedPhone = normalizePhilippineMobile(contactPhone);
    if (!normalizedPhone || contactPhone.length < 10 || contactPhone.length > 30) {
      return jsonNoStore(400, { ok: false, message: "Enter a valid Philippine mobile number." });
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
    if (directions.length < 5 || directions.length > 1000) {
      return jsonNoStore(400, {
        ok: false,
        message: "Enter private driver directions or a landmark between 5 and 1000 characters.",
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
    const completed = await admin.rpc("agrimarket_farmer_save_profile_v2", {
      p_confirm_vendor_name: body.confirm_vendor_name === true,
      p_producer_id: auth.producer.id,
      p_contact_name: contactName,
      p_phone_display: contactPhone,
      p_phone_normalized: normalizedPhone,
      p_barangay: barangay,
      p_vendor_name: vendorName,
      p_pickup_label: resolved.label,
      p_pickup_lat: lat,
      p_pickup_lng: lng,
      p_pickup_motorcycle_accessible: motorcycle,
      p_pickup_tricycle_accessible: tricycle,
      p_pickup_roadside_handoff_required: roadside,
      p_pickup_driver_directions: directions,
      p_actor: auth.accessCode,
      p_now: new Date().toISOString(),
    });

    if (completed.error) {
      return saveFailure(String(completed.error.message || ""));
    }

    const result = await readProfile(admin, auth.producer.id);
    if (result.error || !result.data) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_FARMER_PROFILE_READ_FAILED",
        message: "Your profile was saved, but JRide could not reload it. Tap Refresh.",
      });
    }

    const completedRows = Array.isArray(completed.data) ? completed.data : [];
    const completion: any = completedRows[0] || null;
    const savedProfile = payload(result.data);

    return jsonNoStore(200, {
      ok: true,
      profile: savedProfile,
      application_id: completion?.application_id || null,
      readiness_review_pending: !savedProfile.accepting_orders,
      message: savedProfile.accepting_orders
        ? savedProfile.store_open
          ? "Farm profile saved. Your approval is unchanged and your store remains open."
          : "Farm profile saved. Your approval is unchanged. Your store remains closed; open it when ready."
        : "Farm profile saved. New orders are paused until JRide approves readiness. Your products have not been deleted.",
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_FARMER_PROFILE_SAVE_FAILED",
      message: String(error?.message || "Your farm profile could not be saved."),
    });
  }
}
