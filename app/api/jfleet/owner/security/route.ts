import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetOwner,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIVE_EVENT_STATUSES = ["open", "acknowledged"];

function clean(value: unknown, max = 1000): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetOwner(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  await admin.rpc("jfleet_scan_tracking_gaps_v1", {
    p_now: new Date().toISOString(),
  });

  const [policy, bookings] = await Promise.all([
    admin
      .from("jfleet_security_policies")
      .select(
        "partner_id,enabled,max_accuracy_m,route_warning_m,route_critical_m,route_bad_points_required,route_bad_seconds_required,route_recovery_points_required,gap_warning_seconds,gap_critical_seconds,updated_at"
      )
      .eq("partner_id", auth.partner.id)
      .maybeSingle(),
    admin
      .from("jfleet_bookings")
      .select(
        "id,booking_code,status,scheduled_start_at,scheduled_end_at,assigned_driver_id,assigned_vehicle_id,tracking_required_from,tracking_ended_at"
      )
      .eq("partner_id", auth.partner.id)
      .order("scheduled_start_at", { ascending: false })
      .limit(100),
  ]);

  if (policy.error || bookings.error) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_SECURITY_READ_FAILED", message: "Could not load JFleet security status." },
      { status: 500, headers }
    );
  }

  const bookingRows = bookings.data ?? [];
  const bookingIds = bookingRows.map((row) => row.id);
  const driverIds = bookingRows.map((row) => row.assigned_driver_id).filter(Boolean);
  const vehicleIds = bookingRows.map((row) => row.assigned_vehicle_id).filter(Boolean);

  const [events, states, locations, drivers, vehicles] = await Promise.all([
    bookingIds.length
      ? admin
          .from("jfleet_route_deviation_events")
          .select(
            "id,booking_id,driver_id,event_type,event_status,severity,deviation_distance_m,detected_at,first_observed_at,last_observed_at,occurrence_count,acknowledged_at,resolved_at,resolution_reason,details"
          )
          .in("booking_id", bookingIds)
          .in("event_status", ACTIVE_EVENT_STATUSES)
          .order("last_observed_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    bookingIds.length
      ? admin
          .from("jfleet_security_state")
          .select(
            "booking_id,driver_id,last_location_captured_at,last_location_received_at,last_distance_m,last_accuracy_m,deviation_started_at,deviation_bad_points,recovery_good_points,monitoring_paused_reason,updated_at"
          )
          .in("booking_id", bookingIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? admin
          .from("jfleet_driver_locations")
          .select("driver_id,booking_id,lat,lng,accuracy_m,speed_mps,captured_at,updated_at")
          .in("driver_id", driverIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? admin
          .from("jfleet_drivers")
          .select("id,full_name,driver_code,status")
          .in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
    vehicleIds.length
      ? admin
          .from("jfleet_vehicles")
          .select("id,unit_code,make,model,plate_number,status")
          .in("id", vehicleIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if ([events, states, locations, drivers, vehicles].some((result) => result.error)) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_SECURITY_DETAIL_FAILED", message: "Could not load JFleet security details." },
      { status: 500, headers }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      partner: auth.partner,
      policy: policy.data ?? { partner_id: auth.partner.id, enabled: false },
      bookings: bookingRows,
      events: events.data ?? [],
      states: states.data ?? [],
      locations: locations.data ?? [],
      drivers: drivers.data ?? [],
      vehicles: vehicles.data ?? [],
      server_now: new Date().toISOString(),
    },
    { status: 200, headers }
  );
}

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetOwner(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const body = await req.json().catch(() => ({}));
  const eventId = clean(body?.event_id, 80);
  const action = clean(body?.action, 40).toLowerCase();
  const reason = clean(body?.reason, 1000);

  if (
    !eventId ||
    !["acknowledge", "resolve"].includes(action)
  ) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_SECURITY_ACTION_INVALID", message: "Choose a valid security alert action." },
      { status: 400, headers }
    );
  }

  if (action === "resolve" && reason.length < 3) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_SECURITY_REASON_REQUIRED", message: "Enter a reason before manually resolving a security alert." },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_owner_security_event_action_v1", {
    p_event_id: eventId,
    p_owner_user_id: auth.user.id,
    p_action: action,
    p_reason: reason || null,
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_SECURITY_ACTION_REJECTED",
        message: message.includes("NOT_AUTHORIZED")
          ? "This security alert does not belong to your transport company."
          : "The security alert could not be updated. Refresh and review its current status.",
      },
      { status: 409, headers }
    );
  }

  return NextResponse.json(result.data, { status: 200, headers });
}
