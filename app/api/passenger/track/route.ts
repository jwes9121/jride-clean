import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

async function getRequestUser(
  supabase: ReturnType<typeof createClient>,
  req: Request
) {
  const bearer = getBearerToken(req);

  if (bearer) {
    const { data, error } = await supabase.auth.getUser(bearer);
    if (!error && data?.user?.id) {
      return { user: data.user, auth_source: "bearer" as const };
    }
  }

  const { data, error } = await supabase.auth.getUser();
  if (!error && data?.user?.id) {
    return { user: data.user, auth_source: "session" as const };
  }

  return { user: null, auth_source: "none" as const };
}

function firstNonBlank(...values: unknown[]): string | null {
  for (const value of values) {
    const s = text(value);
    if (s) return s;
  }
  return null;
}

function secondsToMinutes(v: unknown): number | null {
  const seconds = num(v);
  if (seconds == null || seconds <= 0) return null;
  return Math.ceil(seconds / 60);
}

function buildRouteContract(row: Record<string, any>) {
  return {
    distance_km:
      num(row.driver_to_pickup_km) ??
      num(row.pickup_distance_km) ??
      null,
    eta_minutes:
      num(row.pickup_eta_minutes) ??
      num(row.eta_pickup_minutes) ??
      secondsToMinutes(row.pickup_eta_seconds) ??
      secondsToMinutes(row.eta_pickup_seconds) ??
      null,
    trip_km:
      num(row.trip_distance_km) ??
      num(row.route_trip_km) ??
      null,
  };
}

function mergeCompatBooking(
  booking: Record<string, any>,
  driver: Record<string, any> | null,
  driverLocation: Record<string, any> | null,
  route: { distance_km: number | null; eta_minutes: number | null; trip_km: number | null }
) {
  const out: Record<string, any> = { ...booking };

  if (driver) {
    const driverId = firstNonBlank(driver.id, driver.driver_id);
    const driverName = firstNonBlank(driver.name, driver.full_name, driver.callsign);
    const driverPhone = firstNonBlank(driver.phone);
    const driverTown = firstNonBlank(driver.town, driver.municipality);

    if (driverId) {
      out.driver_id = driverId;
      out.assigned_driver_id = out.assigned_driver_id || driverId;
    }
    if (driverName) {
      out.driver_name = driverName;
      out.driverName = driverName;
      out.driver_full_name = driverName;
    }
    if (driverPhone) {
      out.driver_phone = driverPhone;
      out.driverPhone = driverPhone;
    }
    if (driverTown) {
      out.driver_town = driverTown;
    }
  }

  if (driverLocation) {
    const lat = num(driverLocation.lat);
    const lng = num(driverLocation.lng);
    const updatedAt = firstNonBlank(driverLocation.updated_at);

    if (lat != null) {
      out.driver_lat = lat;
      out.driverLat = lat;
    }
    if (lng != null) {
      out.driver_lng = lng;
      out.driverLng = lng;
    }
    if (updatedAt) {
      out.driver_last_seen_at = updatedAt;
    }
  }

  if (route.distance_km != null) {
    out.driver_to_pickup_km = route.distance_km;
    out.driverToPickupKm = route.distance_km;
  }
  if (route.eta_minutes != null) {
    out.pickup_eta_minutes = route.eta_minutes;
    out.pickupEtaMinutes = route.eta_minutes;
  }
  if (route.trip_km != null) {
    out.trip_distance_km = route.trip_km;
    out.tripDistanceKm = route.trip_km;
  }

  return out;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const bookingCode = text(url.searchParams.get("booking_code"));

    if (!bookingCode) {
      return NextResponse.json(
        { ok: false, error: "booking_code is required" },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const auth = await getRequestUser(supabase as any, req);

    if (!auth.user?.id) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        [
          "id",
          "booking_code",
          "status",
          "town",
          "from_label",
          "to_label",
          "pickup_lat",
          "pickup_lng",
          "dropoff_lat",
          "dropoff_lng",
          "created_at",
          "updated_at",
          "assigned_driver_id",
          "driver_id",
          "proposed_fare",
          "verified_fare",
          "passenger_fare_response",
          "driver_status",
          "customer_status",
          "created_by_user_id",
          "driver_to_pickup_km",
          "pickup_distance_fee",
          "trip_distance_km"
        ].join(",")
      )
      .eq("booking_code", bookingCode)
      .eq("created_by_user_id", auth.user.id)
      .maybeSingle();

    if (bookingError) {
      return NextResponse.json(
        { ok: false, error: bookingError.message },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Booking not found" },
        { status: 404 }
      );
    }

    const bookingRow = booking as Record<string, any>;
    const driverId = firstNonBlank(bookingRow.driver_id, bookingRow.assigned_driver_id);

    let driver: Record<string, any> | null = null;
    let driverLocation: Record<string, any> | null = null;

    if (driverId) {
      const { data: driverProfile } = await supabase
        .from("driver_profiles")
        .select("driver_id, full_name, callsign, municipality, phone")
        .eq("driver_id", driverId)
        .maybeSingle();

      if (driverProfile) {
        driver = {
          id: firstNonBlank((driverProfile as any).driver_id, driverId),
          name: firstNonBlank((driverProfile as any).full_name, (driverProfile as any).callsign),
          phone: firstNonBlank((driverProfile as any).phone),
          town: firstNonBlank((driverProfile as any).municipality),
        };
      } else {
        driver = {
          id: driverId,
          name: null,
          phone: null,
          town: null,
        };
      }

      const { data: latestLocation } = await supabase
        .from("driver_locations_latest")
        .select("driver_id, latitude, longitude, updated_at")
        .eq("driver_id", driverId)
        .maybeSingle();

      if (latestLocation) {
        driverLocation = {
          driver_id: firstNonBlank((latestLocation as any).driver_id, driverId),
          lat: num((latestLocation as any).latitude),
          lng: num((latestLocation as any).longitude),
          updated_at: firstNonBlank((latestLocation as any).updated_at),
        };
      }
    }

    const route = buildRouteContract(bookingRow);
    const bookingCompat = mergeCompatBooking(bookingRow, driver, driverLocation, route);

    return NextResponse.json(
      {
        ok: true,
        auth_source: auth.auth_source,
        booking: bookingCompat,
        trip: bookingCompat,
        driver,
        driver_location: driverLocation,
        route,
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
