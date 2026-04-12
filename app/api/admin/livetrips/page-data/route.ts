import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRole) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function getSupabaseHost(): string {
  const raw = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

function buildDebug(debugMode: boolean, extra: Record<string, unknown> = {}) {
  if (!debugMode) return {};
  return {
    debug: {
      supabase_host: getSupabaseHost(),
      generated_at: new Date().toISOString(),
      ...extra,
    },
  };
}

export async function GET(req: NextRequest) {
  const debugMode = req.nextUrl.searchParams.get("debug") === "1";

  try {
    const supabase = getSupabase();

    const driverLocationsRes = await supabase
      .from("driver_locations")
      .select("*");

    if (driverLocationsRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_LOCATIONS_FAILED",
          message: driverLocationsRes.error.message,
          ...buildDebug(debugMode, {
            stage: "driver_locations",
          }),
        },
        { status: 500 }
      );
    }

    const driverProfilesRes = await supabase
      .from("driver_profiles")
      .select("driver_id, full_name, callsign, phone, municipality");

    if (driverProfilesRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_PROFILES_FAILED",
          message: driverProfilesRes.error.message,
          ...buildDebug(debugMode, {
            stage: "driver_profiles",
          }),
        },
        { status: 500 }
      );
    }

    const activeStatuses = [
      "requested",
      "searching",
      "assigned",
      "accepted",
      "fare_proposed",
      "ready",
      "on_the_way",
      "arrived",
      "on_trip",
    ];

    const bookingsRes = await supabase
      .from("bookings")
      .select("*")
      .in("status", activeStatuses)
      .order("updated_at", { ascending: false });

    if (bookingsRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKINGS_FAILED",
          message: bookingsRes.error.message,
          ...buildDebug(debugMode, {
            stage: "bookings",
            active_statuses: activeStatuses,
          }),
        },
        { status: 500 }
      );
    }

    let zones: any[] = [];
    const zonesRes = await supabase.from("zones").select("*");
    if (!zonesRes.error) {
      zones = asArray<any>(zonesRes.data);
    }

    const driverRows = asArray<any>(driverLocationsRes.data);
    const bookingRows = asArray<any>(bookingsRes.data);
    const profileRows = asArray<any>(driverProfilesRes.data);

    const driverProfileMap: Record<string, any> = {};
    for (const row of profileRows) {
      const driverId = text(row?.driver_id);
      if (!driverId) continue;
      driverProfileMap[driverId] = row;
    }

    const tripsArray = bookingRows.map((trip: any) => {
      const driverId = trip?.driver_id || trip?.assigned_driver_id || null;
      const profile = driverId ? driverProfileMap[text(driverId)] : null;
      const location = driverId
        ? driverRows.find((d: any) => text(d?.driver_id) === text(driverId))
        : null;

      return {
        ...trip,
        pickup_label: trip?.pickup_label ?? trip?.from_label ?? null,
        dropoff_label: trip?.dropoff_label ?? trip?.to_label ?? null,
        zone: trip?.town ?? trip?.zone ?? null,
        driver_name: profile?.full_name ?? profile?.callsign ?? null,
        driver_phone: profile?.phone ?? null,
        driver_status: location?.status ?? null,
        zone_id: trip?.zone_id ?? null,
      };
    });

    const activeTripByDriverId: Record<string, any> = {};
    for (const trip of tripsArray) {
      const driverId = text(trip?.driver_id || trip?.assigned_driver_id);
      if (!driverId) continue;
      activeTripByDriverId[driverId] = trip;
    }

    const drivers = driverRows.map((row: any) => {
      const driverId = text(row?.driver_id);
      const profile = driverProfileMap[driverId] || null;
      const trip = activeTripByDriverId[driverId] || null;

      return {
        driver_id: row?.driver_id ?? null,
        lat: row?.lat ?? null,
        lng: row?.lng ?? null,
        status: row?.status ?? null,
        effective_status: row?.status ?? null,
        town: row?.town ?? profile?.municipality ?? null,
        updated_at: row?.updated_at ?? null,
        updated_at_ph: row?.updated_at_ph ?? null,
        age_seconds: row?.age_seconds ?? null,
        assign_eligible: row?.assign_eligible ?? null,
        is_stale: row?.is_stale ?? null,
        vehicle_type: row?.vehicle_type ?? null,
        capacity: row?.capacity ?? null,
        name: profile?.full_name ?? profile?.callsign ?? null,
        phone: profile?.phone ?? null,
        current_trip: trip
          ? {
              booking_code: trip?.booking_code ?? null,
              status: trip?.status ?? null,
              passenger_name: trip?.passenger_name ?? null,
              pickup: trip?.from_label ?? trip?.pickup_label ?? null,
              dropoff: trip?.to_label ?? trip?.dropoff_label ?? null,
              proposed_fare: trip?.proposed_fare ?? null,
              verified_fare: trip?.verified_fare ?? null,
            }
          : null,
      };
    });

    return NextResponse.json({
      ok: true,
      ...buildDebug(debugMode, {
        active_statuses: activeStatuses,
        booking_row_count: bookingRows.length,
        trip_count: tripsArray.length,
        booking_codes: tripsArray
          .map((t: any) => t?.booking_code)
          .filter(Boolean),
      }),
      zones,
      drivers,
      trips: tripsArray,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "LIVETRIPS_ROUTE_FAILED",
        message: String(err?.message ?? err),
        ...buildDebug(debugMode, {
          stage: "catch",
        }),
      },
      { status: 500 }
    );
  }
}