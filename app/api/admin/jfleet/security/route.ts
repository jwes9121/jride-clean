import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireStaff } from "@/lib/auth/requireStaff";
import { jfleetFeatureFlagEnabled } from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  const auth = await requireStaff(["admin", "dispatcher"]);

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status, headers }
    );
  }

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: true, enabled: false, events: [], server_now: new Date().toISOString() },
      { status: 200, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  await admin.rpc("jfleet_scan_tracking_gaps_v1", {
    p_now: new Date().toISOString(),
  });

  const events = await admin
    .from("jfleet_route_deviation_events")
    .select(
      "id,booking_id,driver_id,event_type,event_status,severity,deviation_distance_m,first_observed_at,last_observed_at,occurrence_count,acknowledged_at,details"
    )
    .in("event_status", ["open", "acknowledged"])
    .order("last_observed_at", { ascending: false })
    .limit(200);

  if (events.error) {
    return NextResponse.json(
      { ok: false, error: "JFLEET_SECURITY_READ_FAILED" },
      { status: 500, headers }
    );
  }

  const eventRows = events.data ?? [];
  const bookingIds = [...new Set(eventRows.map((row) => row.booking_id).filter(Boolean))];
  const driverIds = [...new Set(eventRows.map((row) => row.driver_id).filter(Boolean))];

  const bookings = bookingIds.length
    ? await admin
        .from("jfleet_bookings")
        .select("id,booking_code,partner_id,status,assigned_vehicle_id,scheduled_start_at,scheduled_end_at")
        .in("id", bookingIds)
    : { data: [], error: null };

  const partnerIds = [...new Set((bookings.data ?? []).map((row) => row.partner_id).filter(Boolean))];
  const vehicleIds = [...new Set((bookings.data ?? []).map((row) => row.assigned_vehicle_id).filter(Boolean))];

  const [partners, drivers, vehicles, locations] = await Promise.all([
    partnerIds.length
      ? admin.from("jfleet_partners").select("id,display_name,partner_code,status").in("id", partnerIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? admin.from("jfleet_drivers").select("id,full_name,driver_code,status").in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
    vehicleIds.length
      ? admin.from("jfleet_vehicles").select("id,unit_code,make,model,plate_number,status").in("id", vehicleIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? admin.from("jfleet_driver_locations").select("driver_id,booking_id,lat,lng,accuracy_m,captured_at,updated_at").in("driver_id", driverIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (
    bookings.error ||
    [partners, drivers, vehicles, locations].some((result) => result.error)
  ) {
    return NextResponse.json(
      { ok: false, error: "JFLEET_SECURITY_DETAIL_FAILED" },
      { status: 500, headers }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      enabled: true,
      events: eventRows,
      bookings: bookings.data ?? [],
      partners: partners.data ?? [],
      drivers: drivers.data ?? [],
      vehicles: vehicles.data ?? [],
      locations: locations.data ?? [],
      server_now: new Date().toISOString(),
    },
    { status: 200, headers }
  );
}
