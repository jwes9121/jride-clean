import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDrivingRoadMetricsToTarget } from "@/lib/routing/mapboxRoad";
import {
  computeRidePickupFee,
  RIDE_PICKUP_NORMAL_MAX_KM,
} from "@/lib/pricing/pickupFee";

const DRIVER_STALE_AFTER_SECONDS = 120;
const DRIVER_ACCEPT_TTL_SECONDS = 300;
const ONLINE_LIKE = new Set(["online", "available", "idle", "waiting"]);
const ACTIVE_TRIP_STATUSES = [
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ageSeconds(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
}

function effectiveMinWallet(value: unknown): number {
  const configured = finiteNumber(value);
  return configured != null && configured >= 250 ? configured : 250;
}

function normalizeVehicle(value: unknown): string {
  const raw = lower(value);
  if (raw.includes("motor") || raw.includes("moto") || raw.includes("bike")) {
    return "motorcycle";
  }
  if (raw.includes("trike") || raw.includes("tricycle") || raw.includes("toda")) {
    return "tricycle";
  }
  return raw;
}

function isUniqueViolation(error: any): boolean {
  return text(error?.code) === "23505" || lower(error?.message).includes("duplicate key");
}

export type ErrandStage0AssignmentResultV2 = {
  ok: boolean;
  assigned?: boolean;
  booking_id?: string;
  booking_code?: string;
  driver_id?: string;
  pickup_road_distance_km?: number;
  pickup_distance_fee?: number;
  driver_accept_expires_at?: string;
  error?: string;
  message?: string;
  excluded_driver_count?: number;
};

async function loadBooking(admin: any, bookingId: string, bookingCode: string) {
  let query = admin.from("bookings").select("*").limit(1);
  query = bookingId
    ? query.eq("id", bookingId)
    : query.eq("booking_code", bookingCode);
  return query.maybeSingle();
}

export async function assignErrandStage0V2(input: {
  bookingId?: string | null;
  bookingCode?: string | null;
}): Promise<ErrandStage0AssignmentResultV2> {
  const admin = supabaseAdmin();
  const bookingId = text(input.bookingId);
  const bookingCode = text(input.bookingCode);

  if (!bookingId && !bookingCode) {
    return { ok: false, error: "MISSING_BOOKING" };
  }

  let loaded = await loadBooking(admin, bookingId, bookingCode);
  if (loaded.error) {
    return { ok: false, error: "BOOKING_READ_FAILED", message: loaded.error.message };
  }
  if (!loaded.data) return { ok: false, error: "BOOKING_NOT_FOUND" };

  let booking: any = loaded.data;
  if (lower(booking.service_type) !== "errand") {
    return { ok: false, error: "NOT_ERRAND_BOOKING" };
  }

  let status = lower(booking.status);
  if (!["requested", "pending", "searching", "assigned"].includes(status)) {
    return { ok: false, error: "ERRAND_NOT_ASSIGNABLE", message: status };
  }

  const existingDriverId = text(booking.assigned_driver_id || booking.driver_id);
  if (existingDriverId) {
    const expiresAt = text(booking.driver_accept_expires_at);
    const expired =
      status === "assigned" &&
      !!expiresAt &&
      Number.isFinite(Date.parse(expiresAt)) &&
      Date.parse(expiresAt) <= Date.now();

    if (!expired) {
      return {
        ok: true,
        assigned: true,
        booking_id: text(booking.id),
        booking_code: text(booking.booking_code),
        driver_id: existingDriverId,
        pickup_road_distance_km:
          finiteNumber(booking.driver_to_pickup_km) ?? undefined,
        pickup_distance_fee: finiteNumber(booking.pickup_distance_fee) ?? undefined,
        driver_accept_expires_at: expiresAt || undefined,
      };
    }

    const expiredResult = await admin.rpc("errand_driver_expire_offer_v1", {
      p_booking_id: booking.id,
      p_driver_id: existingDriverId,
    });
    if (expiredResult.error) {
      return {
        ok: false,
        error: "ERRAND_OFFER_EXPIRY_FAILED",
        message: expiredResult.error.message,
      };
    }

    loaded = await loadBooking(admin, text(booking.id), "");
    if (loaded.error || !loaded.data) {
      return {
        ok: false,
        error: "BOOKING_READ_AFTER_EXPIRY_FAILED",
        message: loaded.error?.message,
      };
    }
    booking = loaded.data;
    status = lower(booking.status);
  }

  const town = text(booking.town);
  const pickupLat = finiteNumber(booking.pickup_lat);
  const pickupLng = finiteNumber(booking.pickup_lng);
  if (!town || pickupLat == null || pickupLng == null) {
    return { ok: false, error: "ERRAND_STAGE0_LOCATION_INCOMPLETE" };
  }

  const jobRes = await admin
    .from("errand_jobs")
    .select("vehicle_requirement,cargo_classification,estimated_cargo_weight_kg,confirmed_cargo_weight_kg")
    .eq("booking_id", booking.id)
    .maybeSingle();
  if (jobRes.error || !jobRes.data) {
    return {
      ok: false,
      error: "ERRAND_JOB_NOT_FOUND",
      message: jobRes.error?.message,
    };
  }

  const requiredVehicle = lower((jobRes.data as any).vehicle_requirement);

  const outcomesRes = await admin
    .from("errand_driver_offer_outcomes")
    .select("driver_id")
    .eq("booking_id", booking.id);
  if (outcomesRes.error) {
    return {
      ok: false,
      error: "ERRAND_OFFER_OUTCOME_READ_FAILED",
      message: outcomesRes.error.message,
    };
  }

  const excludedDriverIds = new Set(
    (Array.isArray(outcomesRes.data) ? outcomesRes.data : [])
      .map((row: any) => text(row.driver_id))
      .filter(Boolean)
  );

  // JRIDE_ERRAND_NO_MUNICIPAL_BOUNDARY_V1
  // Errand eligibility is based on the driver's fresh live coordinates and
  // road-route distance to Stage 0, not registered town or municipal borders.
  const locationRes = await admin
    .from("driver_locations")
    .select("driver_id,status,updated_at,lat,lng,town,home_town,vehicle_type");
  if (locationRes.error) {
    return {
      ok: false,
      error: "DRIVER_LOCATION_READ_FAILED",
      message: locationRes.error.message,
    };
  }

  const latestByDriver = new Map<string, any>();
  for (const row of Array.isArray(locationRes.data) ? locationRes.data : []) {
    const id = text((row as any).driver_id);
    if (!id || excludedDriverIds.has(id)) continue;
    const previous = latestByDriver.get(id);
    const previousTime = previous ? Date.parse(text(previous.updated_at)) || 0 : 0;
    const nextTime = Date.parse(text((row as any).updated_at)) || 0;
    if (!previous || nextTime >= previousTime) latestByDriver.set(id, row);
  }

  const freshLocations = Array.from(latestByDriver.values()).filter((row: any) => {
    const age = ageSeconds(row.updated_at);
    const online = ONLINE_LIKE.has(lower(row.status));
    const lat = finiteNumber(row.lat);
    const lng = finiteNumber(row.lng);
    const vehicle = normalizeVehicle(row.vehicle_type);
    const vehicleEligible =
      !requiredVehicle || requiredVehicle === "either" || requiredVehicle === vehicle;

    return (
      age != null &&
      age <= DRIVER_STALE_AFTER_SECONDS &&
      online &&
      lat != null &&
      lng != null &&
      vehicleEligible
    );
  });

  if (freshLocations.length === 0) {
    return {
      ok: true,
      assigned: false,
      booking_id: text(booking.id),
      booking_code: text(booking.booking_code),
      error: "NO_NEARBY_DRIVER_AVAILABLE",
      excluded_driver_count: excludedDriverIds.size,
    };
  }

  const candidateIds = freshLocations.map((row: any) => text(row.driver_id));
  const driverRes = await admin
    .from("drivers")
    .select("id,wallet_balance,min_wallet_required,wallet_locked,roster_status")
    .in("id", candidateIds);
  if (driverRes.error) {
    return { ok: false, error: "DRIVER_READ_FAILED", message: driverRes.error.message };
  }

  const driverById = new Map<string, any>();
  for (const row of Array.isArray(driverRes.data) ? driverRes.data : []) {
    driverById.set(text((row as any).id), row);
  }

  const activeRes = await admin
    .from("bookings")
    .select("driver_id,assigned_driver_id")
    .in("status", ACTIVE_TRIP_STATUSES)
    .or(
      `driver_id.in.(${candidateIds.join(",")}),assigned_driver_id.in.(${candidateIds.join(",")})`
    );
  if (activeRes.error) {
    return {
      ok: false,
      error: "ACTIVE_TRIP_READ_FAILED",
      message: activeRes.error.message,
    };
  }

  const busyDrivers = new Set<string>();
  for (const row of Array.isArray(activeRes.data) ? activeRes.data : []) {
    const direct = text((row as any).driver_id);
    const assigned = text((row as any).assigned_driver_id);
    if (direct) busyDrivers.add(direct);
    if (assigned) busyDrivers.add(assigned);
  }

  const eligibleLocations = freshLocations.filter((row: any) => {
    const id = text(row.driver_id);
    const driver = driverById.get(id);
    if (!driver || busyDrivers.has(id)) return false;

    const locked = Boolean(driver.wallet_locked);
    const rosterStatus = lower(driver.roster_status);
    const rosterEligible = !rosterStatus || rosterStatus === "active";
    const balance = finiteNumber(driver.wallet_balance) ?? 0;
    const minimum = effectiveMinWallet(driver.min_wallet_required);
    return !locked && rosterEligible && balance >= minimum;
  });

  if (eligibleLocations.length === 0) {
    return {
      ok: true,
      assigned: false,
      booking_id: text(booking.id),
      booking_code: text(booking.booking_code),
      error: "NO_WALLET_ELIGIBLE_DRIVER_AVAILABLE",
      excluded_driver_count: excludedDriverIds.size,
    };
  }

  const roadMetrics = await getDrivingRoadMetricsToTarget(
    { lat: pickupLat, lng: pickupLng },
    eligibleLocations.map((row: any) => ({
      id: text(row.driver_id),
      lat: Number(row.lat),
      lng: Number(row.lng),
    }))
  );

  const ranked = eligibleLocations
    .map((row: any) => ({
      driverId: text(row.driver_id),
      metric: roadMetrics.get(text(row.driver_id)) || null,
    }))
    .filter(
      (entry) =>
        entry.metric != null && entry.metric.distanceKm <= RIDE_PICKUP_NORMAL_MAX_KM
    )
    .sort((a, b) => (a.metric?.distanceKm || 0) - (b.metric?.distanceKm || 0));

  if (ranked.length === 0) {
    return {
      ok: true,
      assigned: false,
      booking_id: text(booking.id),
      booking_code: text(booking.booking_code),
      error:
        roadMetrics.size === 0
          ? "ROAD_DISTANCE_UNAVAILABLE"
          : "NO_DRIVER_WITHIN_NORMAL_PICKUP_RANGE",
      excluded_driver_count: excludedDriverIds.size,
    };
  }

  for (const candidate of ranked) {
    if (!candidate.metric) continue;
    const pickupDistanceKm = candidate.metric.distanceKm;
    const pickupFee = computeRidePickupFee(pickupDistanceKm);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + DRIVER_ACCEPT_TTL_SECONDS * 1000
    ).toISOString();

    const updateRes = await admin
      .from("bookings")
      .update({
        driver_id: candidate.driverId,
        assigned_driver_id: candidate.driverId,
        status: "assigned",
        assigned_at: now.toISOString(),
        driver_accept_expires_at: expiresAt,
        driver_to_pickup_km: Number(pickupDistanceKm.toFixed(3)),
        pickup_distance_fee: pickupFee,
        updated_at: now.toISOString(),
      })
      .eq("id", booking.id)
      .is("assigned_driver_id", null)
      .in("status", ["requested", "pending", "searching"])
      .select(
        "id,booking_code,assigned_driver_id,pickup_distance_fee,driver_to_pickup_km"
      )
      .maybeSingle();

    if (updateRes.error) {
      if (isUniqueViolation(updateRes.error)) continue;
      return {
        ok: false,
        error: "ERRAND_ASSIGN_UPDATE_FAILED",
        message: updateRes.error.message,
      };
    }
    if (!updateRes.data) continue;

    await admin
      .from("errand_jobs")
      .update({ errand_stage: "driver_assigned", updated_at: now.toISOString() })
      .eq("booking_id", booking.id);

    return {
      ok: true,
      assigned: true,
      booking_id: text((updateRes.data as any).id),
      booking_code: text((updateRes.data as any).booking_code),
      driver_id: text((updateRes.data as any).assigned_driver_id),
      pickup_road_distance_km: Number(pickupDistanceKm.toFixed(3)),
      pickup_distance_fee: pickupFee,
      driver_accept_expires_at: expiresAt,
      excluded_driver_count: excludedDriverIds.size,
    };
  }

  return {
    ok: true,
    assigned: false,
    booking_id: text(booking.id),
    booking_code: text(booking.booking_code),
    error: "DRIVER_ASSIGNMENT_RACE_LOST",
    excluded_driver_count: excludedDriverIds.size,
  };
}
