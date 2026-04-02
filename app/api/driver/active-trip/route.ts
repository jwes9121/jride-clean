import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}

function parseDateMs(v: any): number | null {
  try {
    const t = Date.parse(String(v || ""));
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function mergeCompatTrip(
  trip: Record<string, any>,
  driver: Record<string, any> | null,
  driverLocation: Record<string, any> | null,
  route: { distance_km: number | null; eta_minutes: number | null; trip_km: number | null }
) {
  const out: Record<string, any> = { ...trip };

  const passengerName = firstNonBlank(
    trip.passenger_name,
    trip.customer_name,
    trip.rider_name
  );
  if (passengerName) {
    out.passenger_name = passengerName;
    out.passengerName = passengerName;
  }

  const fromLabel = firstNonBlank(
    trip.from_label,
    trip.pickup_label,
    trip.fromLabel,
    trip.pickup
  );
  if (fromLabel) {
    out.from_label = fromLabel;
    out.fromLabel = fromLabel;
    out.pickup_label = out.pickup_label || fromLabel;
    out.pickupLabel = out.pickupLabel || fromLabel;
  }

  const toLabel = firstNonBlank(
    trip.to_label,
    trip.dropoff_label,
    trip.toLabel,
    trip.dropoff
  );
  if (toLabel) {
    out.to_label = toLabel;
    out.toLabel = toLabel;
    out.dropoff_label = out.dropoff_label || toLabel;
    out.dropoffLabel = out.dropoffLabel || toLabel;
  }

  const bookingCode = firstNonBlank(trip.booking_code, trip.code);
  if (bookingCode) {
    out.booking_code = bookingCode;
    out.code = out.code || bookingCode;
  }

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

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function allow(req: Request) {
  const want = String(
    process.env.DRIVER_PING_SECRET ||
    process.env.JRIDE_DRIVER_SECRET ||
    ""
  ).trim();

  const got = String(
    req.headers.get("x-driver-ping-secret") ||
    req.headers.get("x-jride-driver-secret") ||
    ""
  ).trim();

  if (!want) return true;
  return Boolean(got) && got === want;
}

export async function GET(req: Request) {
  try {
    if (!allow(req)) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const u = new URL(req.url);
    const driverId = String(u.searchParams.get("driver_id") || "").trim();

    if (!driverId || !isUuidLike(driverId)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_DRIVER_ID", message: "driver_id is required (uuid)." },
        { status: 400 }
      );
    }

    const supabase = getAdminClient();
    const activeStatuses = ["assigned", "accepted", "fare_proposed", "on_the_way", "arrived", "on_trip", "ready"];

    function hasFareEvidence(r: any): boolean {
      const pf = r?.proposed_fare;
      const vf = r?.verified_fare;
      const pr = r?.passenger_fare_response;
      return pf != null || vf != null || pr != null;
    }

    function isMovementState(st: string): boolean {
      return st === "on_the_way" || st === "arrived" || st === "on_trip";
    }

    function isReadyButNotAccepted(r: any): boolean {
      const st = String(r?.status ?? "");
      if (st !== "ready") return false;
      const pr = String(r?.passenger_fare_response ?? "").toLowerCase();
      return pr !== "accepted";
    }

    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .or(`assigned_driver_id.eq.${driverId},driver_id.eq.${driverId}`)
      .in("status", activeStatuses)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      return NextResponse.json({ ok: false, error: "DB_ERROR", message: error.message }, { status: 500 });
    }

    const rows: any[] = Array.isArray(data) ? data : [];

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        driver_id: driverId,
        trip: null,
        booking: null,
        driver: null,
        driver_location: null,
        route: null,
        note: "NO_ACTIVE_TRIP",
        active_statuses: activeStatuses,
      });
    }

    const now = Date.now();
    const ASSIGNED_MAX_AGE_MINUTES = 90;
    const assignedMaxAgeMs = ASSIGNED_MAX_AGE_MINUTES * 60 * 1000;

    let picked: any = null;

    for (const r of rows) {
      const st = String(r?.status ?? "");
      if (!st || st === "assigned") continue;
      if (isMovementState(st) && !hasFareEvidence(r)) continue;
      if (isReadyButNotAccepted(r)) continue;
      picked = r;
      break;
    }

    if (!picked) {
      for (const r of rows) {
        const st = String(r?.status ?? "");
        if (st !== "assigned") continue;
        const t = parseDateMs(r?.updated_at) ?? parseDateMs(r?.created_at);
        if (t && (now - t) <= assignedMaxAgeMs) {
          picked = r;
          break;
        }
      }
    }

    const rawTrip = picked || null;
    if (!rawTrip) {
      return NextResponse.json({
        ok: true,
        driver_id: driverId,
        trip: null,
        booking: null,
        driver: null,
        driver_location: null,
        route: null,
        note: "NO_ACTIVE_TRIP",
        active_statuses: activeStatuses,
        assigned_max_age_minutes: ASSIGNED_MAX_AGE_MINUTES,
      });
    }

    const { data: driverProfile } = await supabase
      .from("driver_profiles")
      .select("driver_id, full_name, callsign, municipality, phone")
      .eq("driver_id", driverId)
      .maybeSingle();

    const driver = driverProfile
      ? {
          id: firstNonBlank(driverProfile.driver_id, driverId),
          name: firstNonBlank(driverProfile.full_name, driverProfile.callsign),
          phone: firstNonBlank(driverProfile.phone),
          town: firstNonBlank(driverProfile.municipality),
        }
      : {
          id: driverId,
          name: null,
          phone: null,
          town: null,
        };

    const { data: latestLocation } = await supabase
      .from("driver_locations_latest")
      .select("driver_id, latitude, longitude, updated_at")
      .eq("driver_id", driverId)
      .maybeSingle();

    const driverLocation = latestLocation
      ? {
          driver_id: firstNonBlank(latestLocation.driver_id, driverId),
          lat: num(latestLocation.latitude),
          lng: num(latestLocation.longitude),
          updated_at: firstNonBlank(latestLocation.updated_at),
        }
      : null;

    const route = buildRouteContract(rawTrip as Record<string, any>);
    const trip = mergeCompatTrip(rawTrip as Record<string, any>, driver, driverLocation, route);

    return NextResponse.json({
      ok: true,
      driver_id: driverId,
      trip,
      booking: trip,
      driver,
      driver_location: driverLocation,
      route,
      note: "ACTIVE_TRIP_FOUND",
      active_statuses: activeStatuses,
      assigned_max_age_minutes: ASSIGNED_MAX_AGE_MINUTES,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}