import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetDriver,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIVE = [
  "assigned",
  "upcoming",
  "driver_en_route",
  "driver_arrived",
  "ready_for_trip",
  "on_trip",
];

export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetDriver(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const bookings = await admin
    .from("jfleet_bookings")
    .select(
      "id,booking_code,passenger_user_id,current_itinerary_id,scheduled_start_at,scheduled_end_at,original_quote_amount,addon_total,final_trip_value,status,payment_status,fully_paid_at,assigned_vehicle_id,assigned_at,trip_started_at"
    )
    .eq("assigned_driver_id", auth.driver.id)
    .in("status", ACTIVE)
    .order("scheduled_start_at", { ascending: true })
    .limit(10);

  if (bookings.error) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_DRIVER_BOOKINGS_READ_FAILED", message: "Could not load assigned JFleet trips." },
      { status: 500, headers }
    );
  }

  const rows = bookings.data ?? [];
  const bookingIds = rows.map((row) => row.id);
  const vehicleIds = rows.map((row) => row.assigned_vehicle_id).filter(Boolean);
  const itineraryIds = rows.map((row) => row.current_itinerary_id).filter(Boolean);
  const passengerIds = rows.map((row) => row.passenger_user_id).filter(Boolean);

  const [vehicles, stops, passengers, addons] = await Promise.all([
    vehicleIds.length
      ? admin
          .from("jfleet_vehicles")
          .select("id,unit_code,vehicle_type,make,model,plate_number")
          .in("id", vehicleIds)
      : Promise.resolve({ data: [], error: null }),
    itineraryIds.length
      ? admin
          .from("jfleet_itinerary_stops")
          .select("id,itinerary_id,sequence_no,stop_type,location_label,lat,lng,notes")
          .in("itinerary_id", itineraryIds)
          .order("sequence_no", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    passengerIds.length
      ? admin
          .from("passenger_profiles")
          .select("user_id,full_name,phone")
          .in("user_id", passengerIds)
      : Promise.resolve({ data: [], error: null }),
    bookingIds.length
      ? admin
          .from("jfleet_addons")
          .select(
            "id,booking_id,requested_by,description,additional_route,fuel_vehicle_fee,driver_fee,other_fee,total_amount,status,proposed_at,accepted_at,payment_confirmed_at,notes"
          )
          .in("booking_id", bookingIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (vehicles.error || stops.error || passengers.error || addons.error) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_DRIVER_TRIP_DETAIL_FAILED", message: "Could not load JFleet trip details." },
      { status: 500, headers }
    );
  }

  const vehicleMap = new Map((vehicles.data ?? []).map((row) => [row.id, row]));
  const passengerMap = new Map((passengers.data ?? []).map((row) => [row.user_id, row]));

  return NextResponse.json(
    {
      ok: true,
      driver: auth.driver,
      trips: rows.map((row) => ({
        ...row,
        vehicle: row.assigned_vehicle_id
          ? vehicleMap.get(row.assigned_vehicle_id) ?? null
          : null,
        passenger: passengerMap.get(row.passenger_user_id) ?? null,
        itinerary: (stops.data ?? [])
          .filter((stop) => stop.itinerary_id === row.current_itinerary_id)
          .sort((a, b) => a.sequence_no - b.sequence_no),
        addons: (addons.data ?? []).filter((addon) => addon.booking_id === row.id),
      })),
    },
    { status: 200, headers }
  );
}
