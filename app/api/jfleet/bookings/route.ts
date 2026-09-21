import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetPassenger,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const bookings = await admin
    .from("jfleet_bookings")
    .select(
      "id,booking_code,inquiry_id,accepted_quote_id,current_itinerary_id,scheduled_start_at,scheduled_end_at,original_quote_amount,addon_total,reservation_percent,reservation_required_amount,cancellation_free_until,final_trip_value,status,payment_status,reservation_paid_at,fully_paid_at,assigned_vehicle_id,assigned_driver_id,assigned_at,trip_started_at,trip_completed_at,cancelled_at,cancelled_by,cancellation_reason,cancellation_penalty_amount,refund_amount,created_at"
    )
    .eq("passenger_user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (bookings.error) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_BOOKINGS_READ_FAILED", message: "Could not load your JFleet bookings." },
      { status: 500, headers }
    );
  }

  const rows = bookings.data ?? [];
  const vehicleIds = rows.map((row) => row.assigned_vehicle_id).filter(Boolean);
  const driverIds = rows.map((row) => row.assigned_driver_id).filter(Boolean);

  const [vehicles, drivers] = await Promise.all([
    vehicleIds.length
      ? admin
          .from("jfleet_vehicles")
          .select("id,vehicle_type,make,model,plate_number")
          .in("id", vehicleIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? admin
          .from("jfleet_drivers")
          .select("id,full_name,photo_url,rating_average,rating_count,completed_trips")
          .in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (vehicles.error || drivers.error) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_ASSIGNMENT_READ_FAILED", message: "Could not load JFleet assignment details." },
      { status: 500, headers }
    );
  }

  const vehicleMap = new Map((vehicles.data ?? []).map((row) => [row.id, row]));
  const driverMap = new Map((drivers.data ?? []).map((row) => [row.id, row]));

  return NextResponse.json(
    {
      ok: true,
      bookings: rows.map((row) => ({
        ...row,
        vehicle: row.assigned_vehicle_id ? vehicleMap.get(row.assigned_vehicle_id) ?? null : null,
        driver: row.assigned_driver_id ? driverMap.get(row.assigned_driver_id) ?? null : null,
      })),
    },
    { status: 200, headers }
  );
}
