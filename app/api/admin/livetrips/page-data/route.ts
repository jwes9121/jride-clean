import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();

    // =========================================================
    // 1) DRIVER PRESENCE
    // =========================================================
    const { data: drivers, error: driverErr } = await supabase
      .from("driver_locations")
      .select("*");

    if (driverErr) {
      const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseHost = (() => {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return supabaseUrl;
  }
})();

return NextResponse.json({
  ok: true,
  debug: {
    supabase_host: supabaseHost,
    generated_at: new Date().toISOString(),
    trip_count: tripsArray?.length || 0,
    booking_codes: (tripsArray || []).map((t: any) => t.booking_code).filter(Boolean)
  },{
        ok: false,
        error: "DRIVER_LOCATIONS_FAILED",
        message: driverErr.message,
      });
    }

    // =========================================================
    // 2) DRIVER PROFILES
    // =========================================================
    const { data: driverProfiles, error: driverProfilesErr } = await supabase
      .from("driver_profiles")
      .select("driver_id, full_name, callsign, phone, municipality");

    if (driverProfilesErr) {
      const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseHost = (() => {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return supabaseUrl;
  }
})();

return NextResponse.json({
  ok: true,
  debug: {
    supabase_host: supabaseHost,
    generated_at: new Date().toISOString(),
    trip_count: tripsArray?.length || 0,
    booking_codes: (tripsArray || []).map((t: any) => t.booking_code).filter(Boolean)
  },{
        ok: false,
        error: "DRIVER_PROFILES_FAILED",
        message: driverProfilesErr.message,
      });
    }

    // =========================================================
    // 3) QUEUE + ACTIVE BOOKINGS
    // =========================================================
    const { data: bookings, error: bookingErr } = await supabase
      .from("bookings")
      .select("*")
      .in("status", [
        "requested",
        "searching",
        "assigned",
        "accepted",
        "fare_proposed",
        "ready",
        "on_the_way",
        "arrived",
        "on_trip"
      ])
      .order("updated_at", { ascending: false });

    if (bookingErr) {
      const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseHost = (() => {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return supabaseUrl;
  }
})();

return NextResponse.json({
  ok: true,
  debug: {
    supabase_host: supabaseHost,
    generated_at: new Date().toISOString(),
    trip_count: tripsArray?.length || 0,
    booking_codes: (tripsArray || []).map((t: any) => t.booking_code).filter(Boolean)
  },{
        ok: false,
        error: "BOOKINGS_FAILED",
        message: bookingErr.message,
      });
    }

    // =========================================================
    // 4) ZONES (OPTIONAL)
    // =========================================================
    let zones: any[] = [];
    const zonesRes = await supabase
      .from("zones")
      .select("*");

    if (!zonesRes.error) {
      zones = asArray(zonesRes.data);
    }

    // =========================================================
    // 5) NORMALIZE TO ARRAYS
    // =========================================================
    const driverRows = asArray<any>(drivers);
    const bookingRows = asArray<any>(bookings);
    const profileRows = asArray<any>(driverProfiles);

    // =========================================================
    // 6) PROFILE MAP
    // =========================================================
    const driverProfileMap: Record<string, any> = {};
    for (const dp of profileRows) {
      const id = String(dp?.driver_id || "").trim();
      if (!id) continue;
      driverProfileMap[id] = dp;
    }

    // =========================================================
    // 7) ENRICH TRIPS WITH DRIVER INFO
    // =========================================================
    const tripsArray = bookingRows.map((trip: any) => {
      const driverId = trip?.driver_id || trip?.assigned_driver_id || null;
      const dp = driverId ? driverProfileMap[String(driverId)] : null;
      const dl = driverId
        ? driverRows.find((d: any) => String(d?.driver_id || "") === String(driverId))
        : null;

      return {
        ...trip,
        pickup_label: trip?.pickup_label ?? trip?.from_label ?? null,
        dropoff_label: trip?.dropoff_label ?? trip?.to_label ?? null,
        zone: trip?.town ?? trip?.zone ?? null,
        driver_name: dp?.full_name ?? dp?.callsign ?? null,
        driver_phone: dp?.phone ?? null,
        driver_status: dl?.status ?? null,
        zone_id: trip?.zone_id ?? null,
      };
    });

    // =========================================================
    // 8) MAP DRIVER -> ACTIVE TRIP
    // =========================================================
    const tripMap: Record<string, any> = {};
    for (const trip of tripsArray) {
      const driverId = trip?.driver_id || trip?.assigned_driver_id;
      if (!driverId) continue;
      tripMap[String(driverId)] = trip;
    }

    // =========================================================
    // 9) DRIVER VIEW (MAP)
    // =========================================================
    const driverResult = driverRows.map((d: any) => {
      const trip = tripMap[String(d.driver_id)] || null;
      const dp = driverProfileMap[String(d.driver_id)] || null;

      return {
        driver_id: d.driver_id,
        lat: d.lat,
        lng: d.lng,
        status: d.status,
        effective_status: d.status,
        town: d.town ?? dp?.municipality ?? null,
        updated_at: d.updated_at,
        updated_at_ph: d.updated_at_ph ?? null,
        age_seconds: d.age_seconds ?? null,
        assign_eligible: d.assign_eligible ?? null,
        is_stale: d.is_stale ?? null,
        vehicle_type: d.vehicle_type,
        capacity: d.capacity,
        name: dp?.full_name ?? dp?.callsign ?? null,
        phone: dp?.phone ?? null,

        current_trip: trip
          ? {
              booking_code: trip.booking_code,
              status: trip.status,
              passenger_name: trip.passenger_name,
              pickup: trip.from_label ?? trip.pickup_label ?? null,
              dropoff: trip.to_label ?? trip.dropoff_label ?? null,
              proposed_fare: trip.proposed_fare,
              verified_fare: trip.verified_fare,
            }
          : null,
      };
    });

    const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseHost = (() => {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return supabaseUrl;
  }
})();

return NextResponse.json({
  ok: true,
  debug: {
    supabase_host: supabaseHost,
    generated_at: new Date().toISOString(),
    trip_count: tripsArray?.length || 0,
    booking_codes: (tripsArray || []).map((t: any) => t.booking_code).filter(Boolean)
  },{
      ok: true,
      zones,
      drivers: driverResult,
      trips: tripsArray,
    });
  } catch (err: any) {
    const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseHost = (() => {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return supabaseUrl;
  }
})();

return NextResponse.json({
  ok: true,
  debug: {
    supabase_host: supabaseHost,
    generated_at: new Date().toISOString(),
    trip_count: tripsArray?.length || 0,
    booking_codes: (tripsArray || []).map((t: any) => t.booking_code).filter(Boolean)
  },{
      ok: false,
      error: "LIVETRIPS_ROUTE_FAILED",
      message: String(err?.message ?? err),
    });
  }
}
