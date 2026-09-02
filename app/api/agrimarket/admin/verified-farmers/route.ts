import { randomBytes, randomInt } from "crypto";
import { NextRequest } from "next/server";
import { reverseGeocodeFarmerPin } from "../../_lib/admin-farmer-location";
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

function singleLine(value: unknown): string {
  return text(value).replace(/\s+/g, " ");
}

function cleanSingleLine(value: unknown, maxLength: number): string {
  return singleLine(value).slice(0, maxLength);
}

function normalizePhone(value: unknown): string | null {
  const digits = text(value).replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

function finiteCoordinate(value: unknown, kind: "lat" | "lng"): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
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

function uuid(value: unknown): string | null {
  const raw = text(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
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
  if (raw.includes("AGRIMARKET_ADMIN_REQUIRED")) {
    return jsonNoStore(403, {
      ok: false,
      error: "AGRIMARKET_ADMIN_REQUIRED",
      message: "Administrator approval is required for verified-farmer provisioning.",
    });
  }
  if (raw.includes("FARMER_PHONE_ALREADY_REGISTERED")) {
    return jsonNoStore(409, {
      ok: false,
      error: "AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED",
      message: "A farmer with this mobile number already has an open or approved Agrimarket record.",
    });
  }
  if (raw.includes("NO_ACTIVE_PRODUCT")) {
    return jsonNoStore(409, {
      ok: false,
      error: "AGRIMARKET_FARMER_NO_ACTIVE_PRODUCT",
      message: "The farmer needs at least one active product with available quantity before orders can be enabled.",
    });
  }
  if (raw.includes("CREDENTIAL_NOT_ACTIVE")) {
    return jsonNoStore(409, {
      ok: false,
      error: "AGRIMARKET_FARMER_CREDENTIAL_NOT_ACTIVE",
      message: "Reset or reactivate the farmer credential before enabling orders.",
    });
  }
  if (raw.includes("PICKUP_ACCESS_NOT_VERIFIED")) {
    return jsonNoStore(409, {
      ok: false,
      error: "AGRIMARKET_PICKUP_ACCESS_NOT_VERIFIED",
      message: "Verify the farmer pickup access before enabling orders.",
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
      error: "AGRIMARKET_SAFE_PROVISIONING_NOT_INSTALLED",
      message: "Safe farmer provisioning is not installed on the database yet.",
    });
  }
  if (raw.includes("INVALID") || raw.includes("REQUIRED") || raw.includes("NOT_FOUND")) {
    return jsonNoStore(raw.includes("NOT_FOUND") ? 404 : 400, {
      ok: false,
      error: "AGRIMARKET_VERIFIED_FARMER_INPUT_INVALID",
      message: raw || "The verified-farmer details were rejected.",
    });
  }
  return jsonNoStore(500, {
    ok: false,
    error: "AGRIMARKET_VERIFIED_FARMER_PROVISION_FAILED",
    message: "Unable to complete the verified-farmer action.",
  });
}

async function duplicatePhoneResponse(admin: AdminClient, phone: string) {
  const phoneNormalized = normalizePhone(phone);
  if (!phoneNormalized) {
    return jsonNoStore(400, {
      ok: false,
      error: "AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID",
      message: "Enter a valid Philippine mobile number.",
    });
  }

  const [applicationsRes, producersRes] = await Promise.all([
    admin
      .from("agrimarket_farmer_applications")
      .select("id,application_code,applicant_name,phone_display,phone_normalized,town,status,approved_producer_id,onboarding_source,created_at")
      .eq("phone_normalized", phoneNormalized)
      .in("status", ["submitted", "under_review", "approved"])
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("agrimarket_producers")
      .select("id,contact_name,contact_phone,town,status,accepting_orders")
      .not("contact_phone", "is", null)
      .limit(500),
  ]);

  if (applicationsRes.error || producersRes.error) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_FARMER_DUPLICATE_CHECK_FAILED",
      message: applicationsRes.error?.message || producersRes.error?.message,
    });
  }

  const matchingProducers = (producersRes.data || []).filter(
    (row: any) => normalizePhone(row.contact_phone) === phoneNormalized
  );
  const applications = applicationsRes.data || [];

  return jsonNoStore(200, {
    ok: true,
    normalized_phone: phoneNormalized,
    duplicate: applications.length > 0 || matchingProducers.length > 0,
    applications,
    producers: matchingProducers,
  });
}

export async function GET(req: NextRequest) {
  const staff = await requireAgrimarketStaff(true);
  if (!staff.ok) return staff.response;

  const requestedPhone = req.nextUrl.searchParams.get("phone");
  const admin = createServiceSupabase();
  if (requestedPhone != null) return duplicatePhoneResponse(admin, requestedPhone);

  const applicationsRes = await admin
    .from("agrimarket_farmer_applications")
    .select("*")
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
      ? admin.from("agrimarket_producers").select("*").in("id", producerIds)
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
  const latestEventByApplication = new Map<string, any>();
  for (const event of eventsRes.data || []) {
    if (!latestEventByApplication.has(event.application_id)) {
      latestEventByApplication.set(event.application_id, event);
    }
  }

  return jsonNoStore(200, {
    ok: true,
    staff_role: staff.role,
    staff_actor: staff.actor,
    farmers: applications.map((application: any) => {
      const producer: any = producerById.get(application.approved_producer_id) || null;
      const credential: any = credentialByProducer.get(application.approved_producer_id) || null;
      const event = latestEventByApplication.get(application.id) || null;
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
        pickup_motorcycle_accessible:
          producer?.pickup_motorcycle_accessible ?? application.pickup_motorcycle_accessible ?? null,
        pickup_tricycle_accessible:
          producer?.pickup_tricycle_accessible ?? application.pickup_tricycle_accessible ?? null,
        pickup_roadside_handoff_required:
          producer?.pickup_roadside_handoff_required ?? application.pickup_roadside_handoff_required ?? null,
        pickup_driver_directions:
          producer?.pickup_driver_directions ?? application.pickup_driver_directions ?? null,
        intended_products: application.intended_products || [],
        verification_method: application.verification_method || application.identity_type,
        identity_type: application.identity_type,
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
        latest_audit_event: event
          ? {
              id: event.id,
              event_type: event.event_type,
              actor: event.actor,
              created_at: event.created_at,
              details: event.details || {},
            }
          : null,
        created_at: application.created_at,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const staff = await requireAgrimarketStaff(true);
  if (!staff.ok) return staff.response;

  try {
    const body = await req.json().catch(() => ({}));
    const action = text(body?.action || "create").toLowerCase();
    const admin = createServiceSupabase();

    if (action === "set_readiness") {
      const producerId = uuid(body?.producer_id);
      const ready = body?.ready === true;
      const note = text(body?.note);
      if (!producerId) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_PRODUCER_ID_INVALID",
          message: "A valid farmer producer ID is required.",
        });
      }
      if (note.length < 5 || note.length > 500) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_FARMER_READINESS_NOTE_REQUIRED",
          message: "Enter a 5 to 500 character readiness note for the audit record.",
        });
      }

      const readinessRes = await admin
        .rpc("agrimarket_admin_set_verified_farmer_readiness_v1", {
          p_producer_id: producerId,
          p_ready: ready,
          p_actor: staff.actor,
          p_actor_role: staff.role,
          p_note: note,
          p_now: new Date().toISOString(),
        })
        .single();
      if (readinessRes.error || !readinessRes.data) {
        return provisioningFailure(readinessRes.error || new Error("No readiness result returned."));
      }
      return jsonNoStore(200, { ok: true, result: readinessRes.data });
    }

    if (action === "update_profile") {
      const producerId = uuid(body?.producer_id);
      const farmerName = singleLine(body?.farmer_name || body?.contact_name || body?.name);
      const phoneDisplay = singleLine(body?.phone);
      const phoneNormalized = normalizePhone(phoneDisplay);
      const town = TOWN_BY_LOWER.get(text(body?.town).toLowerCase()) || null;
      const barangay = singleLine(body?.barangay) || null;
      const pickupLabel = singleLine(body?.private_pickup_label || body?.pickup_label);
      const pickupLat = finiteCoordinate(body?.private_pickup_lat ?? body?.pickup_lat, "lat");
      const pickupLng = finiteCoordinate(body?.private_pickup_lng ?? body?.pickup_lng, "lng");
      const pickupMotorcycleAccessible = body?.pickup_motorcycle_accessible === true;
      const pickupTricycleAccessible = body?.pickup_tricycle_accessible === true;
      const pickupRoadsideHandoffRequired = body?.pickup_roadside_handoff_required === true;
      const pickupDriverDirections = text(body?.pickup_driver_directions);
      const reason = text(body?.change_reason || body?.reason);
      const pinConfirmed = body?.pin_confirmed === true;

      if (!producerId) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_PRODUCER_ID_INVALID",
          message: "A valid farmer producer ID is required.",
        });
      }
      if (farmerName.length < 2 || farmerName.length > 120) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_NAME_INVALID", message: "Enter the farmer's full name, up to 120 characters." });
      }
      if (!phoneNormalized || phoneDisplay.length < 10 || phoneDisplay.length > 30) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID", message: "Enter a valid Philippine mobile number." });
      }
      if (!town) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_TOWN_INVALID", message: "Choose an Agrimarket launch municipality." });
      }
      if (barangay && barangay.length > 100) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_BARANGAY_INVALID", message: "Barangay must be 100 characters or fewer." });
      }
      if (pickupLabel.length < 2 || pickupLabel.length > 180 || pickupLat == null || pickupLng == null) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PICKUP_PIN_INVALID", message: "Set and verify the corrected private pickup pin on the map." });
      }
      if (!pickupMotorcycleAccessible && !pickupTricycleAccessible && !pickupRoadsideHandoffRequired) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PICKUP_ACCESS_REQUIRED", message: "Record how a driver can reach or meet the farmer at the pickup point." });
      }
      if (pickupDriverDirections.length < 5 || pickupDriverDirections.length > 1000) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PICKUP_DIRECTIONS_REQUIRED", message: "Enter private driver directions between 5 and 1000 characters." });
      }
      if (reason.length < 5 || reason.length > 500) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PROFILE_CHANGE_REASON_REQUIRED", message: "Enter a 5 to 500 character reason for this audited correction." });
      }
      if (!pinConfirmed) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PICKUP_PIN_CONFIRMATION_REQUIRED", message: "Confirm the corrected private pickup pin before saving." });
      }

      let resolvedLocation;
      try {
        resolvedLocation = await reverseGeocodeFarmerPin(pickupLat, pickupLng);
      } catch {
        return jsonNoStore(503, {
          ok: false,
          error: "AGRIMARKET_LOCATION_SERVICE_UNAVAILABLE",
          message: "JRide could not re-verify the corrected pickup pin. No farmer information was changed.",
        });
      }
      if (!resolvedLocation) {
        return jsonNoStore(422, {
          ok: false,
          error: "AGRIMARKET_PICKUP_PIN_UNRESOLVED",
          message: "The corrected pickup pin could not be verified as an Ifugao location. No farmer information was changed.",
        });
      }
      if (!resolvedLocation.launch_eligible || resolvedLocation.town !== town) {
        return jsonNoStore(409, {
          ok: false,
          error: "AGRIMARKET_PICKUP_TOWN_MISMATCH",
          message: `The selected municipality is ${town}, but the corrected map pin resolves to ${resolvedLocation.town}. Move the pin or correct the municipality.`,
          resolved_town: resolvedLocation.town,
          selected_town: town,
        });
      }

      const updateRes = await admin
        .rpc("agrimarket_admin_update_verified_farmer_profile_v1", {
          p_producer_id: producerId,
          p_contact_name: farmerName,
          p_phone_display: phoneDisplay,
          p_phone_normalized: phoneNormalized,
          p_town: town,
          p_barangay: barangay || resolvedLocation.barangay,
          p_pickup_label: pickupLabel,
          p_pickup_lat: pickupLat,
          p_pickup_lng: pickupLng,
          p_pickup_motorcycle_accessible: pickupMotorcycleAccessible,
          p_pickup_tricycle_accessible: pickupTricycleAccessible,
          p_pickup_roadside_handoff_required: pickupRoadsideHandoffRequired,
          p_pickup_driver_directions: pickupDriverDirections,
          p_resolved_town: resolvedLocation.town,
          p_change_reason: reason,
          p_actor: staff.actor,
          p_actor_role: staff.role,
          p_now: new Date().toISOString(),
        })
        .single();

      if (updateRes.error || !updateRes.data) {
        return provisioningFailure(updateRes.error || new Error("No profile-update result returned."));
      }

      return jsonNoStore(200, {
        ok: true,
        result: updateRes.data,
        controls: {
          pickup_pin_server_verified: true,
          location_or_access_changes_pause_orders: true,
        },
      });
    }

    if (action !== "create") {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_VERIFIED_FARMER_ACTION_INVALID",
      });
    }

    const farmerName = singleLine(body?.farmer_name || body?.contact_name || body?.name);
    const phoneDisplay = singleLine(body?.phone);
    const phoneNormalized = normalizePhone(phoneDisplay);
    const town = TOWN_BY_LOWER.get(text(body?.town).toLowerCase()) || null;
    const barangay = singleLine(body?.barangay) || null;
    const pickupLabel = singleLine(body?.private_pickup_label || body?.pickup_label);
    const pickupLat = finiteCoordinate(body?.private_pickup_lat ?? body?.pickup_lat, "lat");
    const pickupLng = finiteCoordinate(body?.private_pickup_lng ?? body?.pickup_lng, "lng");
    const pickupMotorcycleAccessible = body?.pickup_motorcycle_accessible === true;
    const pickupTricycleAccessible = body?.pickup_tricycle_accessible === true;
    const pickupRoadsideHandoffRequired = body?.pickup_roadside_handoff_required === true;
    const pickupDriverDirections = text(body?.pickup_driver_directions);
    const products = cleanProducts(body?.intended_products);
    const verificationMethod = singleLine(body?.verification_method);
    const identityType = singleLine(body?.identity_type) || null;
    const identityLast4Raw = text(body?.identity_reference_last4).replace(/\s+/g, "").toUpperCase();
    const identityLast4 = identityLast4Raw || null;
    const verificationNote = text(body?.verification_note);
    const verificationConfirmed = body?.verification_confirmed === true;
    const pinConfirmed = body?.pin_confirmed === true;

    if (farmerName.length < 2 || farmerName.length > 120) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_NAME_INVALID", message: "Enter the farmer's full name, up to 120 characters." });
    }
    if (!phoneNormalized || phoneDisplay.length < 10 || phoneDisplay.length > 30) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID", message: "Enter a valid Philippine mobile number." });
    }
    if (!town) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_TOWN_INVALID", message: "Choose an Agrimarket launch municipality." });
    }
    if (barangay && barangay.length > 100) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_BARANGAY_INVALID", message: "Barangay must be 100 characters or fewer." });
    }
    if (pickupLabel.length < 2 || pickupLabel.length > 180 || pickupLat == null || pickupLng == null) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFIED_FARMER_PICKUP_PIN_INVALID", message: "Set and verify the private pickup pin on the map, then enter a recognizable pickup description." });
    }
    if (!pickupMotorcycleAccessible && !pickupTricycleAccessible && !pickupRoadsideHandoffRequired) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PICKUP_ACCESS_REQUIRED", message: "Record how a driver can reach or meet the farmer at the pickup point." });
    }
    if (pickupDriverDirections.length < 5 || pickupDriverDirections.length > 1000) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_PICKUP_DIRECTIONS_REQUIRED", message: "Enter private driver directions between 5 and 1000 characters." });
    }
    if (!products.length) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_INTENDED_PRODUCTS_REQUIRED", message: "List at least one product the farmer expects to sell." });
    }
    if (verificationMethod.length < 2 || verificationMethod.length > 80) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFICATION_METHOD_INVALID", message: "Record how JRide verified this farmer, up to 80 characters." });
    }
    if (identityType && identityType.length > 80) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_IDENTITY_TYPE_INVALID", message: "Identity document type must be 80 characters or fewer." });
    }
    if (identityLast4 && !identityType) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_IDENTITY_TYPE_REQUIRED", message: "Choose the identity document type before recording its reference ending." });
    }
    if (identityLast4 && !/^[A-Z0-9]{2,4}$/.test(identityLast4)) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_ID_REFERENCE_INVALID", message: "Enter only the last 2 to 4 letters or numbers of the identity reference." });
    }
    if (verificationNote.length < 5 || verificationNote.length > 1000) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFICATION_NOTE_REQUIRED", message: "Enter a verification note between 5 and 1000 characters for the audit record." });
    }
    if (!pinConfirmed || !verificationConfirmed) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VERIFICATION_CONFIRMATION_REQUIRED", message: "Confirm the independently verified farmer details and exact pickup pin before creating access." });
    }

    let resolvedLocation;
    try {
      resolvedLocation = await reverseGeocodeFarmerPin(pickupLat, pickupLng);
    } catch (error: any) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_LOCATION_SERVICE_UNAVAILABLE",
        message: "JRide could not re-verify the pickup pin. No farmer account was created.",
      });
    }

    if (!resolvedLocation) {
      return jsonNoStore(422, {
        ok: false,
        error: "AGRIMARKET_PICKUP_PIN_UNRESOLVED",
        message: "The pickup pin could not be verified as an Ifugao location. No farmer account was created.",
      });
    }
    if (!resolvedLocation.launch_eligible || resolvedLocation.town !== town) {
      return jsonNoStore(409, {
        ok: false,
        error: "AGRIMARKET_PICKUP_TOWN_MISMATCH",
        message: `The selected municipality is ${town}, but the map pin resolves to ${resolvedLocation.town}. Move the pin or correct the municipality.`,
        resolved_town: resolvedLocation.town,
        selected_town: town,
      });
    }

    const [generatedApplicationCode, generatedAccessCode] = await Promise.all([
      unusedApplicationCode(admin),
      unusedAccessCode(admin),
    ]);
    const generatedPin = temporaryPin();
    const finalBarangay = barangay || resolvedLocation.barangay;

    const rpcRes = await admin
      .rpc("agrimarket_admin_provision_verified_farmer_v2", {
        p_application_code: generatedApplicationCode,
        p_access_code: generatedAccessCode,
        p_pin: generatedPin,
        p_contact_name: farmerName,
        p_phone_display: phoneDisplay,
        p_phone_normalized: phoneNormalized,
        p_town: town,
        p_barangay: finalBarangay,
        p_pickup_label: pickupLabel,
        p_pickup_lat: pickupLat,
        p_pickup_lng: pickupLng,
        p_pickup_motorcycle_accessible: pickupMotorcycleAccessible,
        p_pickup_tricycle_accessible: pickupTricycleAccessible,
        p_pickup_roadside_handoff_required: pickupRoadsideHandoffRequired,
        p_pickup_driver_directions: pickupDriverDirections,
        p_intended_products: products,
        p_verification_method: verificationMethod,
        p_identity_type: identityType,
        p_identity_reference_last4: identityLast4,
        p_verification_note: verificationNote,
        p_resolved_town: resolvedLocation.town,
        p_provisioned_by: staff.actor,
        p_provisioned_by_role: staff.role,
        p_now: new Date().toISOString(),
      })
      .single();

    if (rpcRes.error || !rpcRes.data) return provisioningFailure(rpcRes.error || new Error("No provisioning result returned."));
    const provisioned: any = rpcRes.data;

    return jsonNoStore(201, {
      ok: true,
      result: provisioned,
      credential: {
        access_code: provisioned.access_code || generatedAccessCode,
        temporary_pin: generatedPin,
        pin_visible_once: true,
        pin_stored_as_hash: true,
        farmer_login_url: "/agrimarket/farmer",
      },
      controls: {
        authorized_role: staff.role,
        public_onboarding_required: false,
        raw_pin_persisted: false,
        pickup_pin_server_verified: true,
        accepting_orders: false,
        next_required_action: "farmer_setup_then_admin_readiness_approval",
      },
    });
  } catch (error: any) {
    return provisioningFailure(error);
  }
}
