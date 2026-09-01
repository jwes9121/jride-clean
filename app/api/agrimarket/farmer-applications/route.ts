import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import {
  agrimarketOnboardingDisabledResponse,
  agrimarketOnboardingEnabled,
  createServiceSupabase,
  jsonNoStore,
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
  return `AGAPP-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
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
        ? "Approved. JRide will provide your Agrimarket farmer access code and PIN directly."
        : row.status === "rejected"
          ? text(row.review_note) || "JRide could not approve this application at this time."
          : row.status === "under_review"
            ? "JRide is reviewing your farmer application."
            : "Your farmer application was received and is waiting for review.",
  };
}

export async function GET(req: NextRequest) {
  if (!agrimarketOnboardingEnabled()) return agrimarketOnboardingDisabledResponse();

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
    .select("application_code,status,town,barangay,review_note,reviewed_at,created_at")
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

  return jsonNoStore(200, { ok: true, application: safeStatus(appRes.data) });
}

export async function POST(req: NextRequest) {
  if (!agrimarketOnboardingEnabled()) return agrimarketOnboardingDisabledResponse();

  try {
    const body = await req.json().catch(() => ({}));
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
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PRIVATE_PICKUP_PIN_REQUIRED", message: "A private farm/home pickup description and exact map pin are required." });
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

    const admin = createServiceSupabase();
    const existingRes = await admin
      .from("agrimarket_farmer_applications")
      .select("application_code,status,town,barangay,review_note,reviewed_at,created_at")
      .eq("phone_normalized", phoneNormalized)
      .in("status", ["submitted", "under_review"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRes.error) {
      return jsonNoStore(500, { ok: false, error: "AGRIMARKET_APPLICATION_CHECK_FAILED", message: "Unable to check an existing application." });
    }
    if (existingRes.data) {
      return jsonNoStore(200, {
        ok: true,
        already_open: true,
        application: safeStatus(existingRes.data),
      });
    }

    let inserted: any = null;
    let insertError: any = null;
    for (let attempt = 0; attempt < 3 && !inserted; attempt += 1) {
      const code = applicationCode();
      const insertRes = await admin
        .from("agrimarket_farmer_applications")
        .insert({
          application_code: code,
          applicant_name: applicantName,
          phone_normalized: phoneNormalized,
          phone_display: phoneDisplay,
          town,
          barangay,
          pickup_label: pickupLabel,
          pickup_lat: pickupLat,
          pickup_lng: pickupLng,
          intended_products: products,
          identity_type: identityType,
          identity_reference_last4: identityLast4,
          applicant_note: applicantNote,
          status: "submitted",
        })
        .select("id,application_code,status,town,barangay,review_note,reviewed_at,created_at")
        .single();

      if (!insertRes.error && insertRes.data) {
        inserted = insertRes.data;
        break;
      }
      insertError = insertRes.error;
      if (String(insertRes.error?.code || "") !== "23505") break;
    }

    if (!inserted) {
      return jsonNoStore(409, {
        ok: false,
        error: "AGRIMARKET_APPLICATION_SUBMIT_FAILED",
        message: insertError?.message || "Unable to submit the farmer application.",
      });
    }

    await admin.from("agrimarket_farmer_application_events").insert({
      application_id: inserted.id,
      event_type: "submitted",
      actor_type: "applicant",
      actor: phoneNormalized,
      details: { town, barangay, intended_products: products },
    });

    return jsonNoStore(201, {
      ok: true,
      already_open: false,
      farmer_fee_policy: "free_launch_v1",
      farmer_wallet_enabled: false,
      privacy: {
        exact_pickup_pin_customer_visible: false,
        full_identity_number_collected: false,
      },
      application: safeStatus(inserted),
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_APPLICATION_SUBMIT_FAILED",
      message: String(error?.message || error),
    });
  }
}
