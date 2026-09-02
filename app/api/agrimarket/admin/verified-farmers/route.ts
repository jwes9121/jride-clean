import { randomBytes, randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketStaff,
} from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const LAUNCH_TOWNS = ["Lagawe", "Hingyon", "Kiangan", "Banaue", "Lamut"] as const;
const TOWN_BY_LOWER = new Map(LAUNCH_TOWNS.map((town) => [town.toLowerCase(), town]));
const ACCESS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type AdminClient = ReturnType<typeof createServiceSupabase>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanSingleLine(value: unknown, maxLength: number): string {
  return text(value).replace(/\s+/g, " ").slice(0, maxLength);
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

function cleanProducts(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : text(value).split(",");
  const unique = new Set<string>();
  for (const item of raw) {
    const clean = cleanSingleLine(item, 80);
    if (clean) unique.add(clean);
    if (unique.size >= 20) break;
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function applicationCode(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `AGSTAFF-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function accessCode(): string {
  let suffix = "";
  for (let index = 0; index < 8; index += 1) {
    suffix += ACCESS_ALPHABET[randomInt(0, ACCESS_ALPHABET.length)];
  }
  return `AGF-${suffix}`;
}

function temporaryPin(): string {
  return String(randomInt(100000, 1000000));
}

async function unusedApplicationCode(admin: AdminClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = applicationCode();
    const result = await admin
      .from("agrimarket_farmer_applications")
      .select("id")
      .eq("application_code", candidate)
      .limit(1)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message || "Unable to reserve a provisioning audit code.");
    if (!result.data) return candidate;
  }
  throw new Error("AGRIMARKET_STAFF_APPLICATION_CODE_GENERATION_FAILED");
}

async function unusedAccessCode(admin: AdminClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = accessCode();
    const result = await admin
      .from("agrimarket_producer_credentials")
      .select("id")
      .eq("access_code", candidate)
      .limit(1)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message || "Unable to reserve a farmer access code.");
    if (!result.data) return candidate;
  }
  throw new Error("AGRIMARKET_ACCESS_CODE_GENERATION_FAILED");
}

function provisioningFailure(error: any) {
  const raw = String(error?.message || error || "");
  if (raw.includes("FARMER_PHONE_ALREADY_REGISTERED")) {
    return jsonNoStore(409, {
      ok: false,
      error: "AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED",
      message: "A farmer with this mobile number already has an open or approved Agrimarket record.",
    });
  }
  if (raw.includes("COLLISION") || raw.includes("23505")) {
    return jsonNoStore(409, {
      ok: false,
      error: "AGRIMARKET_VERIFIED_FARMER_CODE_COLLISION",
      message: "A generated credential code collided with an existing record. Submit again to generate a new code.",
    });
  }
  if (raw.includes("Could not find the function") || raw.includes("PROVISIONING_FUNCTION_MISSING")) {
    return jsonNoStore(503, {
      ok: false,
      error: "AGRIMARKET_VERIFIED_FARMER_PROVISIONING_UNAVAILABLE",
      message: "Verified-farmer provisioning is not installed on the database yet.",
    });
  }
  if (raw.includes("INVALID") || raw.includes("REQUIRED")) {
    return jsonNoStore(400, {
      ok: false,
      error: "AGRIMARKET_VERIFIED_FARMER_INPUT_INVALID",
      message: raw || "The verified-farmer details were rejected.",
    });
  }
  return jsonNoStore(500, {
    ok: false,
    error: "AGRIMARKET_VERIFIED_FARMER_PROVISION_FAILED",
    message: "Unable to create the verified farmer account.",
  });
}

export async function GET() {
  const staff = await requireAgrimarketStaff(true);
  if (staff instanceof NextResponse) return staff;

  const admin = createServiceSupabase();
  const applicationsRes = await admin
    .from("agrimarket_farmer_applications")
    .select(
      "id,application_code,applicant_name,phone_display,phone_normalized,town,barangay,pickup_label,pickup_lat,pickup_lng,intended_products,identity_type,identity_reference_last4,review_note,reviewed_by,reviewed_at,approved_producer_id,onboarding_source,created_at"
    )
    .eq("onboarding_source", "staff_verified")
    .order("reviewed_at", { ascending: false })
    .limit(100);

  if (applicationsRes.error) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_VERIFIED_FARMERS_READ_FAILED",
      message: applicationsRes.error.message || "Unable to load verified farmers.",
    });
  }

  const applications = Array.isArray(applicationsRes.data) ? applicationsRes.data : [];
  const applicationIds = applications.map((row: any) => row.id).filter(Boolean);
  const producerIds = applications.map((row: any) => row.approved_producer_id).filter(Boolean);

  const [producersRes, credentialsRes, eventsRes] = await Promise.all([
    producerIds.length
      ? admin
          .from("agrimarket_producers")
          .select("id,status,accepting_orders,contact_phone,created_at")
          .in("id", producerIds)
      : Promise.resolve({ data: [], error: null }),
    producerIds.length
      ? admin
          .from("agrimarket_producer_credentials")
          .select("producer_id,access_code,status,last_used_at,created_at")
          .in("producer_id", producerIds)
      : Promise.resolve({ data: [], error: null }),
    applicationIds.length
      ? admin
          .from("agrimarket_farmer_application_events")
          .select("id,application_id,event_type,actor,details,created_at")
          .in("application_id", applicationIds)
          .eq("event_type", "approved")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (producersRes.error || credentialsRes.error || eventsRes.error) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_VERIFIED_FARMERS_STATE_READ_FAILED",
      message:
        producersRes.error?.message ||
        credentialsRes.error?.message ||
        eventsRes.error?.message ||
        "Unable to load verified farmer account state.",
    });
  }

  const producerById = new Map((producersRes.data || []).map((row: any) => [row.id, row]));
  const credentialByProducer = new Map((credentialsRes.data || []).map((row: any) => [row.producer_id, row]));
  const eventByApplication = new Map<string, any>();
  for (const event of eventsRes.data || []) {
    if (!eventByApplication.has(event.application_id)) eventByApplication.set(event.application_id, event);
  }

  return jsonNoStore(200, {
    ok: true,
    staff_role: staff.role,
    farmers: applications.map((application: any) => {
      const producer: any = producerById.get(application.approved_producer_id) || null;
      const credential: any = credentialByProducer.get(application.approved_producer_id) || null;
      const event = eventByApplication.get(application.id) || null;
      return {
        application_id: application.id,
        application_code: application.application_code,
        onboarding_source: application.onboarding_source,
        farmer_name: application.applicant_name,
        phone: application.phone_display || application.phone_normalized,
        phone_normalized: application.phone_normalized,
        town: application.town,
        barangay: application.barangay,
        private_pickup_label: application.pickup_label,
        private_pickup_lat: application.pickup_lat,
        private_pickup_lng: application.pickup_lng,
        intended_products: application.intended_products || [],
        verification_method: application.identity_type,
        identity_reference_last4: application.identity_reference_last4,
        verification_note: application.review_note,
        provisioned_by: application.reviewed_by,
        provisioned_at: application.reviewed_at,
        producer_id: application.approved_producer_id,
        producer_status: producer?.status || null,
        accepting_orders: producer?.accepting_orders ?? null,
        access_code: credential?.access_code || null,
        credential_status: credential?.status || null,
        credential_last_used_at: credential?.last_used_at || null,
        audit_event: event
          ? {
              id: event.id,
              event_type: event.event_type,
              actor: event.actor,
              created_at: event.created_at,
              onboarding_source: event.details?.onboarding_source || null,
              pin_visible_once: event.details?.pin_visible_once === true,
              pin_stored_as_hash: event.details?.pin_stored_as_hash === true,
            }
          : null,
        created_at: application.created_at,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const staff = await requireAgrimarketStaff(true);
  if (staff instanceof NextResponse) return staff;

  try {
    const body = await req.json().catch(() => ({}));
    const farmerName = cleanSingleLine(body?.farmer_name || body?.contact_name || body?.name, 120);
    const phoneDisplay = cleanSingleLine(body?.phone, 30);
    const phoneNormalized = normalizePhone(phoneDisplay);
    const town = TOWN_BY_LOWER.get(text(body?.town).toLowerCase()) || null;
    const barangay = cleanSingleLine(body?.barangay, 100) || null;
    const pickupLabel = cleanSingleLine(body?.private_pickup_label || body?.pickup_label, 180);
    const pickupLat = finiteCoordinate(body?.private_pickup_lat ?? body?.pickup_lat, "lat");
    const pickupLng = finiteCoordinate(body?.private_pickup_lng ?? body?.pickup_lng, "lng");
    const products = cleanProducts(body?.intended_products);
    const verificationMethod = cleanSingleLine(body?.verification_method || body?.identity_type, 80);
    const identityLast4Raw = text(body?.identity_reference_last4).replace(/\s+/g, "").toUpperCase();
    const identityLast4 = identityLast4Raw || null;
    const verificationNote = text(body?.verification_note).slice(0, 1000);
    const verificationConfirmed = body?.verification_confirmed === true;

    if (farmerName.length < 2) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_NAME_INVALID", message: "Enter the farmer's full name." });
    }
    if (!phoneNormalized) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID", message: "Enter a valid Philippine mobile number." });
    }
    if (!town) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_TOWN_INVALID", message: "Choose an Agrimarket launch municipality." });
    }
    if (!pickupLabel || pickupLat == null || pickupLng == null) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PICKUP_PIN_INVALID", message: "Enter the private pickup description and exact latitude/longitude." });
    }
    if (!products.length) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_INTENDED_PRODUCTS_REQUIRED", message: "List at least one product the farmer expects to sell." });
    }
    if (verificationMethod.length < 2) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFICATION_METHOD_INVALID", message: "Record how JRide verified this farmer." });
    }
    if (identityLast4 && !/^[A-Z0-9]{2,4}$/.test(identityLast4)) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_ID_REFERENCE_INVALID", message: "Enter only the last 2 to 4 letters or numbers of the identity reference." });
    }
    if (verificationNote.length < 5) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFICATION_NOTE_REQUIRED", message: "Enter a short verification note for the audit record." });
    }
    if (!verificationConfirmed) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFICATION_CONFIRMATION_REQUIRED", message: "Confirm that JRide verified the farmer and private pickup pin before creating access." });
    }

    const admin = createServiceSupabase();
    const [generatedApplicationCode, generatedAccessCode] = await Promise.all([
      unusedApplicationCode(admin),
      unusedAccessCode(admin),
    ]);
    const generatedPin = temporaryPin();

    const rpcRes = await admin
      .rpc("agrimarket_admin_provision_verified_farmer_v1", {
        p_application_code: generatedApplicationCode,
        p_access_code: generatedAccessCode,
        p_pin: generatedPin,
        p_contact_name: farmerName,
        p_phone_display: phoneDisplay,
        p_phone_normalized: phoneNormalized,
        p_town: town,
        p_barangay: barangay,
        p_pickup_label: pickupLabel,
        p_pickup_lat: pickupLat,
        p_pickup_lng: pickupLng,
        p_intended_products: products,
        p_verification_method: verificationMethod,
        p_identity_reference_last4: identityLast4,
        p_verification_note: verificationNote,
        p_provisioned_by: staff.actor,
        p_provisioned_by_role: staff.role,
        p_now: new Date().toISOString(),
      })
      .single();

    if (rpcRes.error || !rpcRes.data) return provisioningFailure(rpcRes.error || new Error("No provisioning result returned."));

    return jsonNoStore(201, {
      ok: true,
      result: rpcRes.data,
      credential: {
        access_code: rpcRes.data.access_code || generatedAccessCode,
        temporary_pin: generatedPin,
        pin_visible_once: true,
        pin_stored_as_hash: true,
        farmer_login_url: "/agrimarket/farmer",
      },
      controls: {
        authorized_role: staff.role,
        public_onboarding_required: false,
        raw_pin_persisted: false,
      },
    });
  } catch (error: any) {
    return provisioningFailure(error);
  }
}
