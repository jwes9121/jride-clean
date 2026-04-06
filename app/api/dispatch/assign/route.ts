import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getNearbyTowns(town: string): string[] {
  const map: Record<string, string[]> = {
    Lagawe: ["Lamut", "Hingyon"],
    Lamut: ["Lagawe", "Kiangan"],
    Hingyon: ["Lagawe"],
    Banaue: ["Hingyon"],
  };

  return map[town] || [];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { booking_id, emergency_mode } = body;

    if (!booking_id) {
      return NextResponse.json({ ok: false, error: "missing_booking_id" }, { status: 400 });
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      return NextResponse.json({ ok: false, error: "booking_not_found" }, { status: 404 });
    }

    let townsToSearch: string[] = [];

    if (!emergency_mode) {
      townsToSearch = [booking.town];
    } else {
      const nearby = getNearbyTowns(booking.town);
      townsToSearch = [booking.town, ...nearby];
    }

    const { data: drivers, error: driverError } = await supabase
      .from("driver_locations")
      .select("driver_id, lat, lng, town, updated_at")
      .in("town", townsToSearch)
      .eq("status", "online");

    if (driverError) {
      return NextResponse.json({ ok: false, error: "driver_query_failed" }, { status: 500 });
    }

    if (!drivers || drivers.length === 0) {
      return NextResponse.json({
        ok: false,
        reason: emergency_mode ? "no_drivers_even_in_emergency" : "no_local_drivers",
        town: booking.town,
      });
    }

    const selectedDriver = drivers[0];
    const nowIso = new Date().toISOString();

    const { error: assignError } = await supabase
      .from("bookings")
      .update({
        driver_id: selectedDriver.driver_id,
        assigned_driver_id: selectedDriver.driver_id,
        status: "assigned",
        assigned_at: nowIso,
        is_emergency: !!emergency_mode,
        updated_at: nowIso,
      })
      .eq("id", booking.id);

    if (assignError) {
      return NextResponse.json({ ok: false, error: "assignment_failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      driver_id: selectedDriver.driver_id,
      emergency_mode: !!emergency_mode,
      towns_considered: townsToSearch,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
