import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getActiveJfleetPartner,
  jfleetFeatureFlagEnabled,
  requireJfleetPassenger,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PURPOSES = new Set([
  "tour_leisure",
  "family",
  "business",
  "event",
  "cargo_delivery",
  "moving_hauling",
  "other",
]);

const VEHICLES = new Set(["van", "pickup", "truck", "recommend"]);
const TRIP_MODES = new Set(["one_way", "round_trip", "multi_day"]);
const STOP_TYPES = new Set(["stop", "destination", "return"]);

function clean(value: unknown, max = 1000): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function optionalText(value: unknown, max = 1000): string | null {
  const valueText = clean(value, max);
  return valueText || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validCoordinate(value: number | null, latitude: boolean): boolean {
  if (value === null) return true;
  return latitude ? value >= -90 && value <= 90 : value >= -180 && value <= 180;
}

function parseFutureDate(value: unknown): Date | null {
  const raw = clean(value, 80);
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  if (date.getTime() <= Date.now()) return null;
  return date;
}

function inquiryCode(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return "JFQ-" + stamp + "-" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

type StopInput = {
  label?: unknown;
  stop_type?: unknown;
  lat?: unknown;
  lng?: unknown;
  notes?: unknown;
};

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_NOT_ENABLED",
        message: "JFleet is not accepting quote requests yet.",
      },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetPassenger(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const active = await getActiveJfleetPartner();
  if (!active.ok) {
    return NextResponse.json(
      { ok: false, code: active.code, message: active.message },
      { status: 503, headers }
    );
  }

  const body = await req.json().catch(() => ({}));

  const purpose = clean(body?.purpose, 40).toLowerCase();
  const requestedVehicleType = clean(body?.requested_vehicle_type, 30).toLowerCase();
  const tripMode = clean(body?.trip_mode, 30).toLowerCase();
  const pickupLabel = clean(body?.pickup_label, 180);
  const pickupLat = numberOrNull(body?.pickup_lat);
  const pickupLng = numberOrNull(body?.pickup_lng);
  const scheduledStart = parseFutureDate(body?.scheduled_start_at);

  const scheduledEndRaw = clean(body?.scheduled_end_at, 80);
  let scheduledEnd: Date | null = null;
  if (scheduledEndRaw) {
    const parsed = new Date(scheduledEndRaw);
    if (!Number.isFinite(parsed.getTime())) {
      return NextResponse.json(
        { ok: false, code: "JFLEET_INVALID_END_TIME", message: "Enter a valid trip end date and time." },
        { status: 400, headers }
      );
    }
    scheduledEnd = parsed;
  }

  if (!PURPOSES.has(purpose)) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_INVALID_PURPOSE", message: "Choose a valid purpose for the hire." },
      { status: 400, headers }
    );
  }

  if (!VEHICLES.has(requestedVehicleType)) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_INVALID_VEHICLE", message: "Choose a valid vehicle type." },
      { status: 400, headers }
    );
  }

  if (!TRIP_MODES.has(tripMode)) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_INVALID_TRIP_MODE", message: "Choose a valid trip type." },
      { status: 400, headers }
    );
  }

  if (pickupLabel.length < 2) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_PICKUP_REQUIRED", message: "Enter the trip pickup location." },
      { status: 400, headers }
    );
  }

  if (!validCoordinate(pickupLat, true) || !validCoordinate(pickupLng, false)) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_INVALID_PICKUP_COORDINATES", message: "The pickup coordinates are invalid." },
      { status: 400, headers }
    );
  }

  if (!scheduledStart) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_INVALID_START_TIME", message: "The trip must be scheduled for a future date and time." },
      { status: 400, headers }
    );
  }

  if ((tripMode === "round_trip" || tripMode === "multi_day") && !scheduledEnd) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_END_TIME_REQUIRED", message: "Enter the expected trip end date and time." },
      { status: 400, headers }
    );
  }

  if (scheduledEnd && scheduledEnd.getTime() < scheduledStart.getTime()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_END_BEFORE_START", message: "The expected trip end cannot be before departure." },
      { status: 400, headers }
    );
  }

  const rawStops = Array.isArray(body?.stops) ? (body.stops as StopInput[]) : [];
  if (rawStops.length < 1 || rawStops.length > 20) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_ITINERARY_REQUIRED", message: "Provide at least one destination and no more than 20 itinerary stops." },
      { status: 400, headers }
    );
  }

  const stops: Array<{
    label: string;
    stop_type: string;
    lat: number | null;
    lng: number | null;
    notes: string | null;
  }> = [];

  for (let index = 0; index < rawStops.length; index += 1) {
    const raw = rawStops[index] || {};
    const label = clean(raw.label, 180);
    const stopType = clean(raw.stop_type || "stop", 20).toLowerCase();
    const lat = numberOrNull(raw.lat);
    const lng = numberOrNull(raw.lng);

    if (label.length < 2) {
      return NextResponse.json(
        { ok: false, code: "JFLEET_STOP_LABEL_REQUIRED", message: "Every itinerary stop needs a location." },
        { status: 400, headers }
      );
    }

    if (!STOP_TYPES.has(stopType)) {
      return NextResponse.json(
        { ok: false, code: "JFLEET_INVALID_STOP_TYPE", message: "An itinerary stop has an invalid type." },
        { status: 400, headers }
      );
    }

    if (!validCoordinate(lat, true) || !validCoordinate(lng, false)) {
      return NextResponse.json(
        { ok: false, code: "JFLEET_INVALID_STOP_COORDINATES", message: "An itinerary stop has invalid coordinates." },
        { status: 400, headers }
      );
    }

    stops.push({
      label,
      stop_type: stopType,
      lat,
      lng,
      notes: optionalText(raw.notes, 500),
    });
  }

  const finalStopType = stops[stops.length - 1].stop_type;
  if (finalStopType !== "destination" && finalStopType !== "return") {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_FINAL_DESTINATION_REQUIRED",
        message: "Mark the last itinerary point as the final destination or return point.",
      },
      { status: 400, headers }
    );
  }

  const passengerCountRaw = numberOrNull(body?.passenger_count);
  const passengerCount =
    passengerCountRaw === null ? null : Math.trunc(passengerCountRaw);

  if (
    passengerCount !== null &&
    (passengerCount < 1 || passengerCount > 100 || passengerCount !== passengerCountRaw)
  ) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_INVALID_PASSENGER_COUNT", message: "Enter a valid passenger count." },
      { status: 400, headers }
    );
  }

  const cargoWeightKg = numberOrNull(body?.cargo_weight_kg);
  if (cargoWeightKg !== null && (cargoWeightKg <= 0 || cargoWeightKg > 100000)) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_INVALID_CARGO_WEIGHT", message: "Enter a valid estimated cargo weight." },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const code = inquiryCode();

  const result = await admin.rpc("jfleet_create_inquiry_v1", {
    p_inquiry_code: code,
    p_passenger_user_id: auth.user.id,
    p_partner_id: active.partner.id,
    p_purpose: purpose,
    p_requested_vehicle_type: requestedVehicleType,
    p_trip_mode: tripMode,
    p_pickup_label: pickupLabel,
    p_pickup_lat: pickupLat,
    p_pickup_lng: pickupLng,
    p_scheduled_start_at: scheduledStart.toISOString(),
    p_scheduled_end_at: scheduledEnd?.toISOString() ?? null,
    p_passenger_count: passengerCount,
    p_cargo_description: optionalText(body?.cargo_description, 1000),
    p_cargo_weight_kg: cargoWeightKg,
    p_luggage_notes: optionalText(body?.luggage_notes, 1000),
    p_special_notes: optionalText(body?.special_notes, 1500),
    p_stops: stops,
  });

  if (result.error) {
    const knownInputError =
      String(result.error.message || "").includes("JFLEET_ITINERARY") ||
      String(result.error.message || "").includes("JFLEET_TRIP_MUST_BE_IN_FUTURE");

    return NextResponse.json(
      {
        ok: false,
        code: knownInputError ? "JFLEET_INVALID_INQUIRY" : "JFLEET_INQUIRY_CREATE_FAILED",
        message: knownInputError
          ? "Review the itinerary and trip schedule, then try again."
          : "The quote request could not be created. Try again.",
      },
      { status: knownInputError ? 400 : 500, headers }
    );
  }

  return NextResponse.json(
    {
      ...(result.data as object),
      partner_name: active.partner.display_name,
      quote_tat_minutes: active.partner.quote_tat_minutes,
    },
    { status: 201, headers }
  );
}

export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetPassenger(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const inquiries = await admin
    .from("jfleet_inquiries")
    .select(
      "id,inquiry_code,purpose,requested_vehicle_type,trip_mode,pickup_label,scheduled_start_at,scheduled_end_at,status,submitted_at,quote_due_at,current_itinerary_version,created_at,jfleet_itineraries(id,version_no,status,source,created_at,jfleet_itinerary_stops(sequence_no,stop_type,location_label,lat,lng,notes)),jfleet_quotes(id,version_no,status,total_amount,currency,valid_until,inclusions,exclusions,pricing_notes,fuel_basis_note,sent_at,accepted_at)"
    )
    .eq("passenger_user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (inquiries.error) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_INQUIRY_READ_FAILED",
        message: "Could not load your JFleet inquiries.",
      },
      { status: 500, headers }
    );
  }

  return NextResponse.json(
    { ok: true, inquiries: inquiries.data ?? [] },
    { status: 200, headers }
  );
}
