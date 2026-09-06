import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { reverseGeocodeFarmerPin } from "../_lib/admin-farmer-location";
import {
  agrimarketOnboardingDisabledResponse,
  agrimarketOnboardingEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketStaff,
} from "../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const LAUNCH_TOWNS = ["Lagawe", "Hingyon", "Kiangan", "Banaue", "Lamut"] as const;
const TOWN_BY_LOWER = new Map(LAUNCH_TOWNS.map((town) => [town.toLowerCase(), town]));

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown): string | null {
  const digits = text(value).replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

function finiteCoordinate(value: unknown, kind: "lat" | "lng"): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || !String(value).trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (kind === "lat" && (parsed < -90 || parsed > 90)) return null;
  if (kind === "lng" && (parsed < -180 || parsed > 180)) return null;
  return parsed;
}

function intendedProducts(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : text(value).split(",");
  const unique = new Set<string>();
  for (const item of raw) {
    const clean = text(item).replace(/\s+/g, " ").slice(0, 80);
    if (clean) unique.add(clean);
    if (unique.size >= 20) break;
  }
  return Array.from(unique);
}

function applicationCode(): string {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `AGAPP-${date}-${randomBytes(16).toString("hex").toUpperCase()}`;
}

function safeStatus(row: any) {
  return {
    application_code: row.application_code,
    status: row.status,
    town: row.town,
    barangay: row.barangay,
    submitted_at: row.created_at,
    reviewed_at: row.reviewed_at,
    status_message:
      row.status === "approved"
        ? "Approved for farm setup. JRide will provide your farmer access code and PIN. Ordering opens after a separate readiness check."
        : row.status === "correction_requested"
          ? text(row.review_note) || "JRide needs corrections before reviewing this application again."
        : row.status === "rejected"
          ? text(row.review_note) || "JRide could not approve this application at this time."
          : row.status === "under_review"
            ? "JRide is reviewing your farmer application."
            : "Your farmer application was received and is waiting for review.",
  };
}

export async function GET(req: NextRequest) {
  const staffMode = req.nextUrl.searchParams.get("mode") === "staff";
  if (staffMode) {
    const staff = await requireAgrimarketStaff(false);
    if (!staff.ok) return staff.response;
    if (!req.nextUrl.searchParams.get("application_code")) return jsonNoStore(200, { ok: true, staff_role: staff.role, staff_actor: staff.actor });
  } else if (!agrimarketOnboardingEnabled()) return agrimarketOnboardingDisabledResponse();

  const code = text(req.nextUrl.searchParams.get("application_code")).toUpperCase();
  const phone = normalizePhone(req.nextUrl.searchParams.get("phone"));
  if (!code || !phone) {
    return jsonNoStore(400, {
      ok: false,
      error: "AGRIMARKET_APPLICATION_LOOKUP_REQUIRED",
      message: "Application code and the same mobile number used to apply are required.",
    });
  }

  const admin = createServiceSupabase();
  const appRes = await admin
    .from("agrimarket_farmer_applications")
    .select("*")
    .eq("application_code", code)
    .eq("phone_normalized", phone)
    .limit(1)
    .maybeSingle();

  if (appRes.error) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_APPLICATION_LOOKUP_FAILED",
      message: "Application status is temporarily unavailable.",
    });
  }
  if (!appRes.data) {
    return jsonNoStore(404, {
      ok: false,
      error: "AGRIMARKET_APPLICATION_NOT_FOUND",
      message: "No application matched that code and mobile number.",
    });
  }

  const row = appRes.data;
  const canCorrect = row.status === "correction_requested" && (staffMode || (row.application_details?.version === 2 && /^AGAPP-\d{6}-[A-F0-9]{32}$/.test(code)));
  return jsonNoStore(200, { ok: true, application: safeStatus(row), correction: canCorrect ? {
    applicant_name: row.applicant_name, phone: row.phone_display || row.phone_normalized,
    town: row.town, barangay: row.barangay || "", pickup_label: row.pickup_label,
    pickup_lat: row.pickup_lat, pickup_lng: row.pickup_lng, intended_products: row.intended_products,
    pickup_motorcycle_accessible: row.pickup_motorcycle_accessible === true,
    pickup_tricycle_accessible: row.pickup_tricycle_accessible === true,
    pickup_roadside_handoff_required: row.pickup_roadside_handoff_required === true,
    pickup_driver_directions: row.pickup_driver_directions || "",
    identity_type: row.identity_type || "", identity_reference_last4: row.identity_reference_last4 || "", applicant_note: row.applicant_note || "",
  } : null });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const submittedBy = text(body?.submitted_by || "farmer");
    let actorRole = "applicant";
    let actor = "";
    if (submittedBy === "staff") {
      const staff = await requireAgrimarketStaff(false);
      if (!staff.ok) return staff.response;
      actorRole = staff.role; actor = staff.actor;
    } else if (!agrimarketOnboardingEnabled()) return agrimarketOnboardingDisabledResponse();
    if (!["farmer", "family", "representative", "staff"].includes(submittedBy)) return jsonNoStore(400, { ok: false, message: "Choose who is completing the application." });
    const helperName = text(body?.helper_name).slice(0, 120);
    if (["family", "representative"].includes(submittedBy) && helperName.length < 2) return jsonNoStore(400, { ok: false, message: "Enter the helper's name." });
    if (body?.farmer_consent !== true || body?.pin_confirmed !== true) return jsonNoStore(400, { ok: false, message: "Confirm the farmer's consent and the actual pickup point." });
    const applicantName = text(body?.applicant_name || body?.name).replace(/\s+/g, " ");
    const phoneDisplay = text(body?.phone);
    const phoneNormalized = normalizePhone(phoneDisplay);
    const town = TOWN_BY_LOWER.get(text(body?.town).toLowerCase()) || null;
    const barangay = text(body?.barangay).replace(/\s+/g, " ").slice(0, 100) || null;
    const pickupLabel = text(body?.pickup_label || body?.pickupLabel).replace(/\s+/g, " ").slice(0, 180);
    const pickupLat = finiteCoordinate(body?.pickup_lat ?? body?.lat, "lat");
    const pickupLng = finiteCoordinate(body?.pickup_lng ?? body?.lng, "lng");
    const products = intendedProducts(body?.intended_products ?? body?.intendedProducts);
    const identityType = text(body?.identity_type || body?.identityType).replace(/\s+/g, " ").slice(0, 80) || null;
    const identityLast4Raw = text(body?.identity_reference_last4 || body?.identityLast4).replace(/\s+/g, "").toUpperCase();
    const identityLast4 = identityLast4Raw || null;
    const applicantNote = text(body?.applicant_note || body?.note).slice(0, 500) || null;

    if (applicantName.length < 2 || applicantName.length > 120) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_APPLICANT_NAME_INVALID", message: "Enter the farmer's full name." });
    }
    if (!phoneNormalized) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_APPLICANT_PHONE_INVALID", message: "Enter a valid Philippine mobile number." });
    }
    if (!town) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_APPLICANT_TOWN_INVALID", message: "Choose an Agrimarket launch municipality." });
    }
    if (!pickupLabel || pickupLat == null || pickupLng == null) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PRIVATE_PICKUP_PIN_REQUIRED", message: "Describe and pin the actual private handoff point." });
    }
    if (!products.length) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_INTENDED_PRODUCTS_REQUIRED", message: "List at least one product you expect to sell." });
    }
    if (identityLast4 && !/^[A-Z0-9]{2,4}$/.test(identityLast4)) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_ID_REFERENCE_INVALID",
        message: "For privacy, enter only the last 2 to 4 letters/numbers of the ID reference, not the full ID number.",
      });
    }

    if (body.pickup_motorcycle_accessible !== true && body.pickup_tricycle_accessible !== true) return jsonNoStore(400, { ok: false, message: "Choose a vehicle that can reach the handoff pin." });
    const directions = text(body.pickup_driver_directions);
    if (directions.length < 5 || directions.length > 1000) return jsonNoStore(400, { ok: false, message: "Add private directions for the assigned driver (5–1000 characters)." });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(body.client_request_id))) return jsonNoStore(400, { ok: false, message: "Refresh the form before submitting." });
    const resolved = await reverseGeocodeFarmerPin(pickupLat, pickupLng);
    if (!resolved?.launch_eligible || resolved.town !== town) return jsonNoStore(422, { ok: false, error: "AGRIMARKET_PICKUP_TOWN_MISMATCH", message: "The pickup pin must resolve to the selected municipality. Place and confirm it again." });
    const admin = createServiceSupabase();
    const result = await admin.rpc("agrimarket_submit_farmer_application_v2", {
      p_application_code: applicationCode(), p_existing_code: text(body.existing_application_code).toUpperCase() || null,
      p_actor: actor || phoneNormalized, p_actor_role: actorRole,
      p_payload: {
        applicant_name: applicantName, phone_display: phoneDisplay, phone_normalized: phoneNormalized,
        town, barangay: resolved.barangay || barangay, pickup_label: pickupLabel, pickup_lat: pickupLat, pickup_lng: pickupLng,
        intended_products: products, identity_type: identityType, identity_reference_last4: identityLast4, applicant_note: applicantNote,
        pickup_motorcycle_accessible: body.pickup_motorcycle_accessible === true,
        pickup_tricycle_accessible: body.pickup_tricycle_accessible === true,
        pickup_roadside_handoff_required: body.pickup_roadside_handoff_required === true,
        pickup_driver_directions: directions,
        application_details: { version: 2, request_id: body.client_request_id, submitted_by: submittedBy,
          helper_name: submittedBy === "staff" ? actor : helperName || null, farmer_consent: true,
          pin_confirmed: true, resolved_town: resolved.town, resolved_barangay: resolved.barangay, pin_verified_at: new Date().toISOString() },
      },
    });
    if (result.error) {
      const reason = String(result.error.message || "");
      return jsonNoStore(reason.includes("NOT_FOUND") ? 404 : 409, { ok: false, error: "AGRIMARKET_APPLICATION_SUBMIT_FAILED", message: reason.includes("PHONE_ALREADY_REGISTERED") ? "An application already exists for this mobile number. Use its private application code to check it, or contact JRide." : "This application could not be saved. Check its status before trying again." });
    }
    const application = Array.isArray(result.data) ? result.data[0] : result.data;
    return jsonNoStore(200, { ok: true, application: safeStatus(application) });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_APPLICATION_SUBMIT_FAILED",
      message: "The application service is unavailable. Your form has been preserved; please try again.",
    });
  }
}
