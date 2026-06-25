import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DriverRow = {
  driver_id: string;
  status: string | null;
  updated_at: string | null;
  lat: number | null;
  lng: number | null;
  town?: string | null;
  vehicle_type?: string | null;
};

type DriverWalletRow = {
  id: string;
  wallet_balance: number | null;
  min_wallet_required: number | null;
  wallet_locked: boolean | null;
};

type BookingRow = {
  id: string;
  booking_code: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  town?: string | null;
  status?: string | null;
  driver_id?: string | null;
  assigned_driver_id?: string | null;
  last_expired_driver_id?: string | null;
  is_emergency?: boolean | null;
  service_type?: string | null;
  vendor_status?: string | null;
  takeout_items_subtotal?: number | string | null;
};
const REQUEST_SEARCH_EXPIRY_SECONDS = 300; // JRIDE_SEARCHING_EXPIRE_5MIN_V1
const ASSIGN_FRESHNESS_SECONDS = 120;
const SCAN_LIMIT = 5;

function norm(v: any): string {
  return String(v ?? "").trim().toLowerCase();
}

function text(v: any): string {
  return String(v ?? "").trim();
}

function normalizeVehicleType(v: any): string {
  const s = norm(v);
  if (!s) return "";
  if (s.includes("motor")) return "motorcycle";
  if (s.includes("trike")) return "tricycle";
  if (s.includes("tricycle")) return "tricycle";
  return s;
}


function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoNow(): string {
  return new Date().toISOString();
}

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function modeNormalized(v: any): "scan_requested" | "single" | "unknown" {
  const m = norm(v);
  if (m === "scan_requested") return "scan_requested";
  if (m === "scan_pending") return "scan_requested";
  if (m === "single") return "single";
  return "unknown";
}

function buildBaseDebug(extra?: Record<string, any>) {
  return {
    freshness_seconds_threshold: ASSIGN_FRESHNESS_SECONDS,
    scan_limit: SCAN_LIMIT,
    timestamp: isoNow(),
    ...(extra || {}),
  };
}

function getNearbyTowns(town: string): string[] {
  const map: Record<string, string[]> = {
    Lagawe: ["Lamut", "Hingyon"],
    Lamut: ["Lagawe", "Kiangan"],
    Hingyon: ["Lagawe"],
    Banaue: ["Hingyon"],
  };
  return map[town] || [];
}

function allowedTownsForBooking(bookingTown: string, emergencyMode: boolean): string[] {
  const town = text(bookingTown);
  if (!town) return [];
  if (!emergencyMode) return [town];
  return [town, ...getNearbyTowns(town)];
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function mapboxMatrixToken(): string {
  return String(
    process.env.MAPBOX_ACCESS_TOKEN ||
      process.env.MAPBOX_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      ""
  ).trim();
}

async function getRoadDurationsSeconds(
  target: { lat: number; lng: number },
  drivers: DriverRow[]
): Promise<Map<string, number>> {
  const token = mapboxMatrixToken();
  if (!token || !drivers.length) return new Map();

  const candidates = drivers
    .map((d) => ({
      driver_id: text(d.driver_id),
      lat: num(d.lat),
      lng: num(d.lng),
    }))
    .filter((d) => d.driver_id && d.lat != null && d.lng != null)
    .slice(0, 24);

  if (!candidates.length) return new Map();

  const allCoords = [
    ...candidates.map((d) => `${d.lng},${d.lat}`),
    `${target.lng},${target.lat}`,
  ].join(";");

  const destinationIndex = candidates.length;

  const url =
    `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${allCoords}` +
    `?sources=${candidates.map((_, idx) => idx).join(",")}` +
    `&destinations=${destinationIndex}` +
    `&annotations=duration` +
    `&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error("[AUTO_ASSIGN_MAPBOX_MATRIX_ERROR]", res.status, await res.text());
      return new Map();
    }

    const json = (await res.json()) as { durations?: (number | null)[][] };
    const durations = Array.isArray(json?.durations) ? json.durations : [];

    const out = new Map<string, number>();
    candidates.forEach((driver, idx) => {
      const value = durations[idx]?.[0];
      if (typeof value === "number" && Number.isFinite(value)) {
        out.set(driver.driver_id, value);
      }
    });

    return out;
  } catch (e: any) {
    console.error("[AUTO_ASSIGN_MAPBOX_MATRIX_EXCEPTION]", String(e?.message || e));
    return new Map();
  }
}


function isAssignableAutoAssignState(booking: BookingRow): boolean {
  const status = norm(booking?.status);
  const serviceType = norm(booking?.service_type);
  const vendorStatus = norm(booking?.vendor_status);

  if (status === "searching") return true;

  return (
    serviceType === "takeout" &&
    status === "requested" &&
    vendorStatus === "vendor_accepted"
  );
}

function isTakeoutCashFirst(booking: BookingRow): boolean {
  const subtotal = num(booking?.takeout_items_subtotal) ?? 0;
  return norm(booking?.service_type) === "takeout" && subtotal > 500;
}

function assignmentTargetCoords(booking: BookingRow): {
  lat: number | null;
  lng: number | null;
  basis: "pickup_vendor" | "dropoff_customer_cash_first";
} {
  if (isTakeoutCashFirst(booking)) {
    return {
      lat: num(booking?.dropoff_lat),
      lng: num(booking?.dropoff_lng),
      basis: "dropoff_customer_cash_first",
    };
  }

  return {
    lat: num(booking?.pickup_lat),
    lng: num(booking?.pickup_lng),
    basis: "pickup_vendor",
  };
}

function effectiveMinWalletRequired(v: any): number {
  const n = num(v);
  if (n == null) return 250;
  return Math.max(250, n);
}

function compareDrivers(a: DriverRow, b: DriverRow, pickupLat: number | null, pickupLng: number | null): number {
  const aLat = num(a.lat);
  const aLng = num(a.lng);
  const bLat = num(b.lat);
  const bLng = num(b.lng);

  const aHasCoords = aLat != null && aLng != null && pickupLat != null && pickupLng != null;
  const bHasCoords = bLat != null && bLng != null && pickupLat != null && pickupLng != null;

  if (aHasCoords && bHasCoords) {
    const aKm = haversineKm(aLat as number, aLng as number, pickupLat as number, pickupLng as number);
    const bKm = haversineKm(bLat as number, bLng as number, pickupLat as number, pickupLng as number);
    if (aKm !== bKm) return aKm - bKm;
  } else if (aHasCoords && !bHasCoords) {
  
    return -1;
  } else if (!aHasCoords && bHasCoords) {
    return 1;
  }

  const aMs = a.updated_at ? new Date(a.updated_at).getTime() : 0;
  const bMs = b.updated_at ? new Date(b.updated_at).getTime() : 0;

  if (aMs !== bMs) return bMs - aMs;
  return String(a.driver_id || "").localeCompare(String(b.driver_id || ""));
}

type MatchDebug = {
  booking_id: string | null;
  booking_code: string | null;
  booking_status_seen: string | null;
  booking_driver_id_seen: string | null;
  booking_town_seen: string | null;
  emergency_mode: boolean;
  allowed_towns: string[];
  scanned_driver_count: number;
  rejected_wrong_status_count: number;
  rejected_missing_updated_at_count: number;
  rejected_invalid_updated_at_count: number;
  rejected_stale_count: number;
  rejected_excluded_count: number;
  rejected_wrong_town_count: number;
  rejected_wrong_vehicle_count: number;
  rejected_low_wallet_count: number;
  rejected_wallet_locked_count: number;
  eligible_count: number;
  chosen_driver_id: string | null;
  chosen_driver_town: string | null;
  chosen_driver_distance_km: number | null;
  requested_vehicle_type: string | null;
  chosen_driver_vehicle_type: string | null;
  freshness_seconds_threshold: number;
  excluded_driver_ids: string[];
  assignment_distance_basis: "pickup_vendor" | "dropoff_customer_cash_first";
  takeout_items_subtotal: number | null;
};

async function matchSingle(
  supabase: any,
  booking: BookingRow,
  excludeDriverIds: string[]
): Promise<{
  assigned: boolean;
  driver_id?: string | null;
  booking_code?: string | null;
  reason?: string;
  decision: "assigned" | "skipped" | "blocked";
  debug: MatchDebug;
}> {
  const excluded = (excludeDriverIds || []).map((x) => String(x || "").trim()).filter(Boolean);
  const bookingTown = text(booking?.town);
  const emergencyMode = !!booking?.is_emergency;
    const requestedVehicleType = normalizeVehicleType(booking?.service_type);
  const allowedTowns = allowedTownsForBooking(bookingTown, emergencyMode);
  const targetCoords = assignmentTargetCoords(booking);
  const pickupLat = targetCoords.lat;
  const pickupLng = targetCoords.lng;

  const debug: MatchDebug = {
    booking_id: booking?.id ?? null,
    booking_code: booking?.booking_code ?? null,
    booking_status_seen: booking?.status ? String(booking.status) : null,
    booking_driver_id_seen: booking?.driver_id ? String(booking.driver_id) : null,
    booking_town_seen: bookingTown || null,
    emergency_mode: emergencyMode,
    allowed_towns: allowedTowns,
    scanned_driver_count: 0,
    rejected_wrong_status_count: 0,
    rejected_missing_updated_at_count: 0,
    rejected_invalid_updated_at_count: 0,
    rejected_stale_count: 0,
    rejected_excluded_count: 0,
    rejected_wrong_town_count: 0,
    rejected_wrong_vehicle_count: 0,
    rejected_low_wallet_count: 0,
    rejected_wallet_locked_count: 0,
    eligible_count: 0,
    chosen_driver_id: null,
    chosen_driver_town: null,
    chosen_driver_distance_km: null,
    requested_vehicle_type: requestedVehicleType || null,
    chosen_driver_vehicle_type: null,
    freshness_seconds_threshold: ASSIGN_FRESHNESS_SECONDS,
    excluded_driver_ids: excluded,
    assignment_distance_basis: targetCoords.basis,
    takeout_items_subtotal: num(booking?.takeout_items_subtotal),
  };

  if (!booking?.id) {
    return {
      assigned: false,
      reason: "INVALID_BOOKING",
      decision: "blocked",
      debug,
    };
  }

    if (!isAssignableAutoAssignState(booking)) {
    return {
      assigned: false,
      reason: "BOOKING_NOT_ASSIGNABLE",
      decision: "blocked",
      debug,
    };
  }

  if (text((booking as any).passenger_fare_response).toLowerCase() === "rejected" && (booking as any).assigned_driver_id) {
    const rejectedAssignedDriverId = text((booking as any).assigned_driver_id);
    if (rejectedAssignedDriverId && !excluded.includes(rejectedAssignedDriverId)) {
      excluded.push(rejectedAssignedDriverId);
      debug.excluded_driver_ids = excluded;
    }
  }

  if (booking.driver_id) {
    return {
      assigned: false,
      reason: "BOOKING_ALREADY_ASSIGNED",
      decision: "blocked",
      debug,
    };
  }

  if (!bookingTown) {
    return {
      assigned: false,
      reason: "BOOKING_TOWN_MISSING",
      decision: "blocked",
      debug,
    };
  }

  if (allowedTowns.length === 0) {
    return {
      assigned: false,
      reason: "NO_ALLOWED_TOWNS",
      decision: "blocked",
      debug,
    };
  }

  const nowMs = Date.now();

  const { data: drivers, error: driversError } = await supabase
    .from("driver_locations")
    .select("driver_id, status, updated_at, lat, lng, town, vehicle_type");

  if (driversError) {
    return {
      assigned: false,
      reason: "DRIVER_SCAN_FAILED",
      decision: "blocked",
      debug,
    };
  }

  const allDrivers = (drivers || []) as DriverRow[];
  debug.scanned_driver_count = allDrivers.length;

  const driverIds = allDrivers
    .map((d) => text(d.driver_id))
    .filter(Boolean);

  const walletByDriverId = new Map<string, DriverWalletRow>();
  if (driverIds.length > 0) {
    const { data: walletRows, error: walletError } = await supabase
      .from("drivers")
      .select("id, wallet_balance, min_wallet_required, wallet_locked")
      .in("id", driverIds);

    if (walletError) {
      return {
        assigned: false,
        reason: "DRIVER_WALLET_SCAN_FAILED",
        decision: "blocked",
        debug,
      };
    }

    for (const row of (walletRows || []) as DriverWalletRow[]) {
      walletByDriverId.set(text(row.id), row);
    }
  }

  const allowedTownSet = new Set(allowedTowns.map((x) => text(x).toLowerCase()));
  const eligible: DriverRow[] = [];

  for (const d of allDrivers) {
    const st = norm(d.status);
    const driverTown = text(d.town).toLowerCase();

    if (excluded.includes(String(d.driver_id || "").trim())) {
      debug.rejected_excluded_count++;
      continue;
    }

    if (st !== "online") {
      debug.rejected_wrong_status_count++;
      continue;
    }

    if (!driverTown || !allowedTownSet.has(driverTown)) {
      debug.rejected_wrong_town_count++;
      continue;
    }

    const rawDriverVehicleType = d.vehicle_type;
      let driverVehicleType = normalizeVehicleType(rawDriverVehicleType);

      if (!driverVehicleType && rawDriverVehicleType) {
        const rawVehicleText = String(rawDriverVehicleType).toLowerCase().trim();

        if (rawVehicleText.includes("tri")) {
          driverVehicleType = "tricycle";
        } else if (rawVehicleText.includes("motor")) {
          driverVehicleType = "motorcycle";
        }
      }
      // JRIDE_AUTO_ASSIGN_VEHICLE_NORMALIZER_V15 // JRIDE_AUTO_ASSIGN_SCOPE_V14

    // JRIDE_SHARED_DRIVER_POOL_TAKEOUT_V1
    // Soft-launch rule: takeout uses the same ride-capable drivers.
    // A takeout booking may be assigned to tricycle or motorcycle drivers.
    // Ride bookings still require their requested vehicle type.
    const vehicleAllowedForBooking = (
  (!requestedVehicleType ||
      (requestedVehicleType === "takeout"
        ? ["tricycle", "motorcycle"].includes(driverVehicleType)
        : driverVehicleType === requestedVehicleType))
  ||
  (
    (requestedVehicleType === "takeout") &&
    (driverVehicleType === "tricycle" || driverVehicleType === "motorcycle")
  )
)
// JRIDE_AUTO_ASSIGN_TAKEOUT_SHARED_POOL_V11;

    if (!vehicleAllowedForBooking) {
      debug.rejected_wrong_vehicle_count++;
      continue;
    }

    // JRIDE_SHARED_DRIVER_POOL_ACTIVE_LOCK_V1
    // One driver cannot hold ride and takeout work at the same time.
    const { data: busyRows, error: busyErr } = await supabase
      .from("bookings")
      .select("id, booking_code, status, service_type, driver_id, assigned_driver_id")
      .or(`driver_id.eq.${d.driver_id},assigned_driver_id.eq.${d.driver_id}`)
      .in("status", [
        "assigned",
        "accepted",
        "fare_proposed",
        "ready",
        "on_the_way",
        "arrived",
        "on_trip",
        "pickup_ready",
      ])
      .limit(1);

    if (busyErr) {
      (debug as any).rejected_busy_lookup_count = ((debug as any).rejected_busy_lookup_count || 0) + 1;
      continue;
    }

    if ((busyRows || []).length > 0) {
      (debug as any).rejected_busy_driver_count = ((debug as any).rejected_busy_driver_count || 0) + 1;
      continue;
    }

    const wallet = walletByDriverId.get(text(d.driver_id));
    const walletLocked = Boolean(wallet?.wallet_locked);
    const walletBalance = num(wallet?.wallet_balance) ?? 0;
    const walletMinRequired = effectiveMinWalletRequired(wallet?.min_wallet_required);

    if (walletLocked) {
      debug.rejected_wallet_locked_count++;
      continue;
    }

    if (walletBalance < walletMinRequired) {
      debug.rejected_low_wallet_count++;
      continue;
    }

    if (!d.updated_at) {
      debug.rejected_missing_updated_at_count++;
      continue;
    }

    const updatedMs = new Date(d.updated_at).getTime();
    if (!Number.isFinite(updatedMs)) {
      debug.rejected_invalid_updated_at_count++;
      continue;
    }

    const ageSec = (nowMs - updatedMs) / 1000;
    if (ageSec > ASSIGN_FRESHNESS_SECONDS) {
      debug.rejected_stale_count++;
      continue;
    }

    eligible.push(d);
  }

  const roadDurations =
    pickupLat != null && pickupLng != null
      ? await getRoadDurationsSeconds({ lat: pickupLat, lng: pickupLng }, eligible)
      : new Map<string, number>();

  eligible.sort((a, b) => {
    const aId = text(a.driver_id);
    const bId = text(b.driver_id);
    const aRoad = roadDurations.get(aId);
    const bRoad = roadDurations.get(bId);

    if (aRoad != null && bRoad != null && aRoad !== bRoad) return aRoad - bRoad;
    if (aRoad != null && bRoad == null) return -1;
    if (aRoad == null && bRoad != null) return 1;

    return compareDrivers(a, b, pickupLat, pickupLng);
  });

  debug.eligible_count = eligible.length;

  if (eligible.length === 0) {
    return {
      assigned: false,
      reason: emergencyMode ? "NO_ELIGIBLE_DRIVERS_IN_EMERGENCY_TOWNS" : "NO_ELIGIBLE_LOCAL_DRIVERS",
      decision: "skipped",
      debug,
    };
  }

  const chosen = eligible[0];
  debug.chosen_driver_id = chosen.driver_id;
  debug.chosen_driver_town = text(chosen.town) || null;
  debug.chosen_driver_vehicle_type = normalizeVehicleType(chosen.vehicle_type) || null;

  const chosenLat = num(chosen.lat);
  const chosenLng = num(chosen.lng);
  if (chosenLat != null && chosenLng != null && pickupLat != null && pickupLng != null) {
    debug.chosen_driver_distance_km = Number(
      haversineKm(chosenLat, chosenLng, pickupLat, pickupLng).toFixed(2)
    );
  }

  (debug as any).chosen_driver_road_duration_seconds =
    roadDurations.get(text(chosen.driver_id)) ?? null;
  (debug as any).driver_selection_metric =
    roadDurations.size > 0 ? "mapbox_road_duration" : "haversine_fallback";

  const nowIso = isoNow();

  const updatePayload: Record<string, unknown> = {
    driver_id: chosen.driver_id,
    assigned_driver_id: chosen.driver_id,
    status: "assigned",
    assigned_at: nowIso,
    driver_accept_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    updated_at: nowIso,
  };

  if (norm(booking.service_type) === "takeout") {
    updatePayload.vendor_status = "driver_assigned";
    updatePayload.customer_status = "driver_assigned";
    updatePayload.driver_status = "driver_assigned";
    updatePayload.takeout_pricing_status = "waiting_driver_accept";
    updatePayload.takeout_driver_accept_expires_at = updatePayload.driver_accept_expires_at;
  }

  const guardedStatuses = norm(booking.service_type) === "takeout"
    ? ["requested", "searching"]
    : ["searching"];

  const { error: updateError } = await supabase
    .from("bookings")
    .update(updatePayload)
    .eq("id", booking.id)
    .in("status", guardedStatuses)
    .is("driver_id", null);

  if (updateError) {
    return {
      assigned: false,
      reason: "BOOKING_UPDATE_FAILED",
      decision: "blocked",
      debug,
    };
  }

  return {
    assigned: true,
    driver_id: chosen.driver_id,
    booking_code: booking.booking_code ?? null,
    decision: "assigned",
    debug,
  };
}

export async function POST(req: Request) {
  console.log("[DISPATCH_TRACE] auto_assign:start", { at: new Date().toISOString() });

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = supabaseAdmin();

    const mode = modeNormalized(body?.mode);
    const excludeDriverIds: string[] = Array.isArray(body?.exclude_driver_ids)
      ? body.exclude_driver_ids.map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];

    if (mode === "scan_requested") {
      // JRIDE_AUTO_ASSIGN_EXPIRE_BYPASS_V3
      // Expiry cleanup is intentionally bypassed here because the canonical
      // lifecycle guard currently rejects searching -> expired.
      // Assignment scan must not be blocked by cleanup.
      const expiredSearchingCount = 0;

     const { data: bookings, error } = await supabase
        .from("bookings")
        .select("id, booking_code, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, town, status, driver_id, assigned_driver_id, is_emergency, service_type, vendor_status, takeout_items_subtotal, passenger_fare_response, last_expired_driver_id")
        .or("status.eq.searching,and(service_type.eq.takeout,status.eq.requested,vendor_status.eq.vendor_accepted)")
        .is("driver_id", null)
        .order("created_at", { ascending: true })
        .limit(SCAN_LIMIT);

      if (error) {
        return json(
          {
            ok: false,
            error: "BOOKINGS_SCAN_FAILED",
            message: error.message,
            mode: "scan_requested",
            debug: buildBaseDebug(),
          },
          500
        );
      }

      const scanRows = (bookings || []) as BookingRow[];

      let assigned_count = 0;
      let skipped_count = 0;
      let blocked_count = 0;

      const results: Array<{
        booking_id: string;
        booking_code: string | null;
        assigned: boolean;
        decision: "assigned" | "skipped" | "blocked";
        driver_id: string | null;
        reason: string | null;
        debug: MatchDebug;
      }> = [];

      for (const booking of scanRows) {
        const expiredDriverId = String((booking as any).last_expired_driver_id || "").trim();

const bookingExclusions = [
  ...excludeDriverIds,
  expiredDriverId,
].filter(Boolean);

let result = await matchSingle(
  supabase,
  booking as BookingRow,
  bookingExclusions
);

if (
  !result.assigned &&
  result.reason === "NO_ELIGIBLE_LOCAL_DRIVERS" &&
  expiredDriverId
) {
  console.log("[AUTO_ASSIGN_FALLBACK] Retrying with previously expired driver allowed", {
    booking_code: (booking as any).booking_code,
    expired_driver_id: expiredDriverId,
  });

  result = await matchSingle(
    supabase,
    booking as BookingRow,
    excludeDriverIds
  );
}

        if (result.decision === "assigned") assigned_count++;
        else if (result.decision === "skipped") skipped_count++;
        else blocked_count++;

        results.push({
          booking_id: booking.id,
          booking_code: booking.booking_code ?? null,
          assigned: !!result.assigned,
          decision: result.decision,
          driver_id: result.driver_id ?? null,
          reason: result.reason ?? null,
          debug: result.debug,
        });
      }

      console.log("[DISPATCH_TRACE] auto_assign:scan_summary", {
        mode: "scan_requested",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count,
        exclude_driver_ids: excludeDriverIds,
      });

      return json({
        ok: true,
        mode: "scan_requested",
        accepted_legacy_mode_name: norm(body?.mode) === "scan_pending",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count,
        exclude_driver_ids: excludeDriverIds,
        results,
        debug: buildBaseDebug({
          booking_status_target: "searching",
          search_expiry_seconds: REQUEST_SEARCH_EXPIRY_SECONDS,
          expired_searching_count: expiredSearchingCount,
          booking_driver_target: "driver_id is null",
          booking_town_rule: "same town only unless booking.is_emergency = true",
        }),
      });
    }

    if (mode !== "single") {
      return json(
        {
          ok: false,
          error: "INVALID_MODE",
          mode: String(body?.mode ?? ""),
          debug: buildBaseDebug(),
        },
        400
      );
    }

    const bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) {
      return json(
        {
          ok: false,
          error: "MISSING_BOOKING_ID",
          mode: "single",
          debug: buildBaseDebug(),
        },
        400
      );
    }

        const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, booking_code, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, town, status, driver_id, assigned_driver_id, is_emergency, service_type, vendor_status, takeout_items_subtotal, passenger_fare_response, last_expired_driver_id")
      .eq("id", bookingId)
      .single();

    if (bookingError) {
      return json(
        {
          ok: false,
          error: "BOOKING_READ_FAILED",
          message: bookingError.message,
          mode: "single",
          booking_id: bookingId,
          debug: buildBaseDebug(),
        },
        500
      );
    }

    if (!booking) {
      return json(
        {
          ok: false,
          error: "BOOKING_NOT_FOUND",
          mode: "single",
          booking_id: bookingId,
          debug: buildBaseDebug(),
        },
        404
      );
    }

   const expiredDriverId = String((booking as any).last_expired_driver_id || "").trim();

const bookingExclusions = [
  ...excludeDriverIds,
  expiredDriverId,
].filter(Boolean);

let result = await matchSingle(
  supabase,
  booking as BookingRow,
  bookingExclusions
);

if (
  !result.assigned &&
  result.reason === "NO_ELIGIBLE_LOCAL_DRIVERS" &&
  expiredDriverId
) {
  console.log("[AUTO_ASSIGN_FALLBACK] Retrying with previously expired driver allowed", {
    booking_code: (booking as any).booking_code,
    expired_driver_id: expiredDriverId,
  });

  result = await matchSingle(
    supabase,
    booking as BookingRow,
    excludeDriverIds
  );
}

    console.log("[DISPATCH_TRACE] auto_assign:single_result", {
      booking_id: booking.id,
      booking_code: booking.booking_code ?? null,
      decision: result.decision,
      reason: result.reason ?? null,
      driver_id: result.driver_id ?? null,
      exclude_driver_ids: excludeDriverIds,
      debug: result.debug,
    });

    return json({
      ok: true,
      mode: "single",
      booking_id: booking.id,
      booking_code: booking.booking_code ?? null,
      assigned: !!result.assigned,
      decision: result.decision,
      driver_id: result.driver_id ?? null,
      reason: result.reason ?? null,
      exclude_driver_ids: excludeDriverIds,
      debug: result.debug,
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "AUTO_ASSIGN_FAILED",
        message: String(e?.message || e),
        debug: buildBaseDebug(),
      },
      500
    );
  }
}









