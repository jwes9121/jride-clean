import { randomInt } from "crypto";
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

const ACCESS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VALID_STATUSES = new Set(["submitted", "under_review", "correction_requested", "approved", "rejected", "withdrawn"]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function accessCode(): string {
  let suffix = "";
  for (let i = 0; i < 8; i += 1) suffix += ACCESS_ALPHABET[randomInt(0, ACCESS_ALPHABET.length)];
  return `AGF-${suffix}`;
}

function temporaryPin(): string {
  return String(randomInt(100000, 1000000));
}

function applicationPayload(
  row: any,
  producerById: Map<string, any>,
  credentialByProducer: Map<string, any>,
  latestAccessEventByProducer: Map<string, any>
) {
  const producerId = String(row.approved_producer_id || "");
  const producer = producerId ? producerById.get(producerId) || null : null;
  const credential = producerId ? credentialByProducer.get(producerId) || null : null;
  const lastAccessEvent = producerId ? latestAccessEventByProducer.get(producerId) || null : null;

  return {
    id: row.id,
    application_code: row.application_code,
    applicant_name: row.applicant_name,
    phone: row.phone_display || row.phone_normalized,
    phone_normalized: row.phone_normalized,
    town: row.town,
    barangay: row.barangay,
    private_pickup_label: row.pickup_label,
    private_pickup_lat: Number(row.pickup_lat),
    private_pickup_lng: Number(row.pickup_lng),
    intended_products: Array.isArray(row.intended_products) ? row.intended_products : [],
    identity_type: row.identity_type,
    identity_reference_last4: row.identity_reference_last4,
    applicant_note: row.applicant_note,
    application_details: row.application_details,
    pickup_motorcycle_accessible: row.pickup_motorcycle_accessible,
    pickup_tricycle_accessible: row.pickup_tricycle_accessible,
    pickup_roadside_handoff_required: row.pickup_roadside_handoff_required,
    pickup_driver_directions: row.pickup_driver_directions,
    status: row.status,
    review_note: row.review_note,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    approved_producer_id: row.approved_producer_id,
    farmer_access_code: credential?.access_code || null,
    producer_status: producer?.status || null,
    accepting_orders: producer?.accepting_orders ?? null,
    credential_status: credential?.status || null,
    credential_failed_attempts: Number(credential?.failed_attempts || 0),
    credential_locked_until: credential?.locked_until || null,
    credential_last_used_at: credential?.last_used_at || null,
    last_access_event: lastAccessEvent
      ? {
          event_type: lastAccessEvent.event_type,
          actor: lastAccessEvent.actor,
          reason: lastAccessEvent.reason,
          created_at: lastAccessEvent.created_at,
        }
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const staff = await requireAgrimarketStaff(false);
  if (staff.ok === false) return staff.response;

  const requestedStatus = text(req.nextUrl.searchParams.get("status")).toLowerCase();
  if (requestedStatus && !VALID_STATUSES.has(requestedStatus)) {
    return jsonNoStore(400, { ok: false, error: "AGRIMARKET_APPLICATION_STATUS_INVALID" });
  }

  const admin = createServiceSupabase();
  let query = admin
    .from("agrimarket_farmer_applications")
    .select("id,application_code,applicant_name,phone_normalized,phone_display,town,barangay,pickup_label,pickup_lat,pickup_lng,intended_products,identity_type,identity_reference_last4,applicant_note,status,review_note,reviewed_by,reviewed_at,approved_producer_id,created_at,updated_at,application_details,pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions")
    .order("created_at", { ascending: false })
    .limit(300);

  if (requestedStatus) query = query.eq("status", requestedStatus);
  const appsRes = await query;
  if (appsRes.error) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_APPLICATIONS_READ_FAILED",
      message: appsRes.error.message,
    });
  }

  const rows = Array.isArray(appsRes.data) ? appsRes.data : [];
  const producerIds = Array.from(
    new Set(rows.map((row: any) => String(row.approved_producer_id || "")).filter(Boolean))
  );
  const producerById = new Map<string, any>();
  const credentialByProducer = new Map<string, any>();
  const latestAccessEventByProducer = new Map<string, any>();

  if (producerIds.length) {
    const [producersRes, credentialsRes, eventsRes] = await Promise.all([
      admin
        .from("agrimarket_producers")
        .select("id,status,accepting_orders")
        .in("id", producerIds),
      admin
        .from("agrimarket_producer_credentials")
        .select("producer_id,access_code,status,failed_attempts,locked_until,last_used_at")
        .in("producer_id", producerIds),
      admin
        .from("agrimarket_producer_access_events")
        .select("producer_id,event_type,actor,reason,created_at")
        .in("producer_id", producerIds)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);

    if (producersRes.error || credentialsRes.error || eventsRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_FARMER_ACCESS_STATE_FAILED",
        message: producersRes.error?.message || credentialsRes.error?.message || eventsRes.error?.message,
      });
    }

    for (const producer of Array.isArray(producersRes.data) ? producersRes.data : []) {
      producerById.set(String((producer as any).id), producer);
    }
    for (const credential of Array.isArray(credentialsRes.data) ? credentialsRes.data : []) {
      credentialByProducer.set(String((credential as any).producer_id), credential);
    }
    for (const event of Array.isArray(eventsRes.data) ? eventsRes.data : []) {
      const producerId = String((event as any).producer_id || "");
      if (producerId && !latestAccessEventByProducer.has(producerId)) {
        latestAccessEventByProducer.set(producerId, event);
      }
    }
  }

  return jsonNoStore(200, {
    ok: true,
    staff_role: staff.role,
    applications: rows.map((row: any) =>
      applicationPayload(row, producerById, credentialByProducer, latestAccessEventByProducer)
    ),
  });
}

export async function POST(req: NextRequest) {
  const staff = await requireAgrimarketStaff(false);
  if (staff.ok === false) return staff.response;

  try {
    const body = await req.json().catch(() => ({}));
    const applicationId = text(body?.application_id || body?.applicationId);
    const decision = text(body?.decision).toLowerCase();
    const reviewNote = text(body?.review_note || body?.reviewNote).slice(0, 1000) || null;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_APPLICATION_ID_INVALID" });
    }
    if (!new Set(["under_review", "request_correction", "approve", "reject"]).has(decision)) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_REVIEW_DECISION_INVALID" });
    }
    if (decision !== "under_review" && staff.role !== "admin") return jsonNoStore(403, { ok: false, error: "AGRIMARKET_ADMIN_REQUIRED" });
    if (decision !== "under_review" && (!reviewNote || reviewNote.length < 5)) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_REJECTION_REASON_REQUIRED",
        message: "Add a review note of at least five characters.",
      });
    }

    const admin = createServiceSupabase();
    let generatedAccessCode: string | null = null;
    let generatedPin: string | null = null;
    let verifiedPin: { lat: number; lng: number; town: string } | null = null;

    if (decision === "approve") {
      if (body.verification_confirmed !== true) return jsonNoStore(400, { ok: false, message: "Confirm that the farmer's identity, consent and pickup access have been checked." });
      const application = await admin.from("agrimarket_farmer_applications").select("pickup_lat,pickup_lng,town").eq("id", applicationId).maybeSingle();
      if (application.error || !application.data) return jsonNoStore(404, { ok: false, message: "Application not found." });
      const { pickup_lat: lat, pickup_lng: lng, town } = application.data;
      const resolved = await reverseGeocodeFarmerPin(Number(lat), Number(lng));
      if (!resolved?.launch_eligible || resolved.town !== town) return jsonNoStore(422, { ok: false, message: "The pickup pin does not match the municipality. Request a correction." });
      verifiedPin = { lat: Number(lat), lng: Number(lng), town: resolved.town };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = accessCode();
        const existsRes = await admin
          .from("agrimarket_producer_credentials")
          .select("id")
          .eq("access_code", candidate)
          .limit(1)
          .maybeSingle();
        if (existsRes.error) return jsonNoStore(503, { ok: false, message: "Farmer access is temporarily unavailable." });
        if (!existsRes.data) {
          generatedAccessCode = candidate;
          break;
        }
      }
      if (!generatedAccessCode) {
        return jsonNoStore(503, { ok: false, error: "AGRIMARKET_ACCESS_CODE_GENERATION_FAILED" });
      }
      generatedPin = temporaryPin();
    }

    const reviewRes = await admin.rpc("agrimarket_review_farmer_application_v2", {
      p_application_id: applicationId,
      p_decision: decision,
      p_actor: staff.actor,
      p_actor_role: staff.role,
      p_review_note: reviewNote,
      p_access_code: generatedAccessCode,
      p_pin: generatedPin,
      p_verified_pin: verifiedPin,
      p_verification_confirmed: body.verification_confirmed === true,
      p_now: new Date().toISOString(),
    });

    if (reviewRes.error) {
      const message = String(reviewRes.error.message || "");
      const status = message.includes("NOT_FOUND") ? 404 : message.includes("ALREADY_FINAL") ? 409 : 400;
      return jsonNoStore(status, {
        ok: false,
        error: "AGRIMARKET_APPLICATION_REVIEW_FAILED",
        message,
      });
    }

    const resultRows = Array.isArray(reviewRes.data) ? reviewRes.data : [];
    const result: any = resultRows[0] || reviewRes.data || null;

    return jsonNoStore(200, {
      ok: true,
      result,
      credential: decision === "approve"
        ? {
            access_code: generatedAccessCode,
            temporary_pin: generatedPin,
            pin_visible_once: true,
            farmer_wallet_enabled: false,
            marketplace_fee_percent: 0,
          }
        : null,
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_APPLICATION_REVIEW_FAILED",
      message: String(error?.message || error),
    });
  }
}
