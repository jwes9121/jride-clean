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
  if (raw.includes("motor")) return "motorcycle";
  if (raw.includes("trike") || raw.includes("tricycle") || raw.includes("toda")) {
    return "tricycle";
  }
  return raw;
}

function isUniqueViolation(error: any): boolean {
  return text(error?.code) === "23505" || lower(error?.message).includes("duplicate key");
}

export type ErrandStage0AssignmentResult = {
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
};

export async function assignErrandStage0(input: {
  bookingId?: string | null;
  bookingCode?: string | null;
}): Promise<ErrandStage0AssignmentResult> {
  const admin = supabaseAdmin();
  const bookingId = text(input.bookingId);
  const bookingCode = text(input.bookingCode);

  if (!bookingId && !bookingCode) {
    return { ok: false, error: "MISSING_BOOKING" };
  }

  let bookingQuery = admin.from("bookings").select("*").limit(1);
  bookingQuery = bookingId
    ? bookingQuery.eq("id", bookingId)
    : bookingQuery.eq("booking_code", bookingCode);

  const { data: booking, error: bookingError } = await bookingQuery.maybeSingle();
  if (bookingError) {
    return { ok: false, error: "BOOKING_READ_FAILED", message: bookingError.message };
  }
  if (!booking) {
    return { ok: false, error: "BOOKING_NOT_FOUND" };
  }

  if (lower((booking as any).service_type) !== "errand") {
    return { ok: false, error: "NOT_ERRAND_BOOKING" };
  }

  const status = lower((booking as any).status);
  if (!["requested", "pending", "searching", "assigned"].includes(status)) {
    return { ok: false, error: "ERRAND_NOT_ASSIGNABLE", message: status };
  }

  const existingDriverId = text(
    (booking as any).assigned_driver_id || (booking as any).driver_id
  );
  if (existingDriverId) {
    return {
      ok: true,
      assigned: true,
      booking_id: text((booking as any).id),
      booking_code: text((booking as any).booking_code),
      driver_id: existingDriverId,
      pickup_road_distance_km:
        finiteNumber((booking as any).driver_to_pickup_km) ?? undefined,
      pickup_distance_fee:
        finiteNumber((booking as any).pickup_distance_fee) ?? undefined,
      driver_accept_expires_at:
        text((booking as any).driver_accept_expires_at) || undefined,
    };
  }

  const town = text((booking as any).town);
  const pickupLat = finiteNumber((booking as any).pickup_lat);
  const pickupLng = finiteNumber((booking as any).pickup_lng);

  if (!town || pickupLat == null || pickupLng == null) {
    return { ok: false, error: "ERRAND_STAGE0_LOCATION_INCOMPLETE" };
  }

  const { data: job, error: jobError } = await admin
    .from("errand_jobs")
    .select("vehicle_requirement, cargo_classification, estimated_cargo_weight_kg")
    .eq("booking_id", (booking as any).id)
    .maybeSingle();

  if (jobError || !job) {
    return {
      ok: false,
      error: "ERRAND_JOB_NOT_FOUND",
      message: jobError?.message,
    };
  }

  const requiredVehicle = lower((job as any).vehicle_requirement);

  const { data: locationRows, error: locationError } = await admin
    .from("driver_locations")
    .select("driver_id, status, updated_at, lat, lng, town, home_town, vehicle_type")
    .eq("town", town);

  if (locationError) {
    return {
      ok: false,
      error: "DRIVER_LOCATION_READ_FAILED",
      message: locationError.message,
    };
  }

  const latestByDriver = new Map<string, any>();
  for (const row of Array.isArray(locationRows) ? locationRows : []) {
    const driverId = text((row as any).driver_id);
    if (!driverId) continue;
    const previous = latestByDriver.get(driverId);
    const previousTime = previous ? Date.parse(text(previous.updated_at)) || 0 : 0;
    const nextTime = Date.parse(text((row as any).updated_at)) || 0;
    if (!previous || nextTime >= previousTime) latestByDriver.set(driverId, row);
  }

  const freshLocations = Array.from(latestByDriver.values()).filter((row: any) => {
    const age = ageSeconds(row.updated_at);
    const online = ONLINE_LIKE.has(lower(row.status));
    const lat = finiteNumber(row.lat);
    const lng = finiteNumber(row.lng);
    const driverVehicle = normalizeVehicle(row.vehicle_type);
    const vehicleEligible =
      requiredVehicle === "either" ||
      !requiredVehicle ||
      requiredVehicle === driverVehicle;

    return (
      age != null &&
      age <= DRIVER_STALE_AFTER_SECONDS &&
      online &&
      lat != null &&
      lng != null &&
      vehicleEligible &&
      lower(row.town) === lower(town)
    );
  });

  if (freshLocations.length === 0) {
    return {
      ok: true,
      assigned: false,
      booking_id: text((booking as any).id),
      booking_code: text((booking as any).booking_code),
      error: "NO_SAME_TOWN_DRIVER_AVAILABLE",
    };
  }

  const candidateIds = freshLocations.map((row: any) => text(row.driver_id));

  const { data: driverRows, error: driverError } = await admin
    .from("drivers")
    .select("id, wallet_balance, min_wallet_required, wallet_locked, roster_status")
    .in("id", candidateIds);

  if (driverError) {
    return { ok: false, error: "DRIVER_READ_FAILED", message: driverError.message };
  }

  const driverById = new Map<string, any>();
  for (const row of Array.isArray(driverRows) ? driverRows : []) {
    driverById.set(text((row as any).id), row);
  }

  const { data: activeRows, error: activeError } = await admin
    .from("bookings")
    .select("driver_id, assigned_driver_id")
    .in("status", ACTIVE_TRIP_STATUSES)
    .or(
      `driver_id.in.(${candidateIds.join(",")}),assigned_driver_id.in.(${candidateIds.join(",")})`
    );

  if (activeError) {
    return { ok: false, error: "ACTIVE_TRIP_READ_FAILED", message: activeError.message };
  }

  const busyDrivers = new Set<string>();
  for (const row of Array.isArray(activeRows) ? activeRows : []) {
    const driverId = text((row as any).driver_id);
    const assignedId = text((row as any).assigned_driver_id);
    if (driverId) busyDrivers.add(driverId);
    if (assignedId) busyDrivers.add(assignedId);
  }

  const walletEligibleLocations = freshLocations.filter((row: any) => {
    const driverId = text(row.driver_id);
    const driver = driverById.get(driverId);
    if (!driver || busyDrivers.has(driverId)) return false;

    const locked = Boolean(driver.wallet_locked);
    const rosterStatus = lower(driver.roster_status);
    const rosterEligible = !rosterStatus || rosterStatus === "active";
    const balance = finiteNumber(driver.wallet_balance) ?? 0;
    const minimum = effectiveMinWallet(driver.min_wallet_required);

    return !locked && rosterEligible && balance >= minimum;
  });

  if (walletEligibleLocations.length === 0) {
    return {
      ok: true,
      assigned: false,
      booking_id: text((booking as any).id),
      booking_code: text((booking as any).booking_code),
      error: "NO_WALLET_ELIGIBLE_DRIVER_AVAILABLE",
    };
  }

  const roadMetrics = await getDrivingRoadMetricsToTarget(
    { lat: pickupLat, lng: pickupLng },
    walletEligibleLocations.map((row: any) => ({
      id: text(row.driver_id),
      lat: Number(row.lat),
      lng: Number(row.lng),
    }))
  );

  const ranked = walletEligibleLocations
    .map((row: any) => ({
      row,
      driverId: text(row.driver_id),
      metric: roadMetrics.get(text(row.driver_id)) || null,
    }))
    .filter(
      (entry) =>
        entry.metric != null &&
        entry.metric.distanceKm <= RIDE_PICKUP_NORMAL_MAX_KM
    )
    .sort((a, b) => (a.metric?.distanceKm || 0) - (b.metric?.distanceKm || 0));

  if (ranked.length === 0) {
    return {
      ok: true,
      assigned: false,
      booking_id: text((booking as any).id),
      booking_code: text((booking as any).booking_code),
      error: roadMetrics.size === 0
        ? "ROAD_DISTANCE_UNAVAILABLE"
        : "NO_DRIVER_WITHIN_NORMAL_PICKUP_RANGE",
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

    const { data: updated, error: updateError } = await admin
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
      .eq("id", (booking as any).id)
      .is("assigned_driver_id", null)
      .in("status", ["requested", "pending", "searching"])
      .select("id, booking_code, assigned_driver_id, pickup_distance_fee, driver_to_pickup_km")
      .maybeSingle();

    if (updateError) {
      if (isUniqueViolation(updateError)) continue;
      return {
        ok: false,
        error: "ERRAND_ASSIGN_UPDATE_FAILED",
        message: updateError.message,
      };
    }

    if (!updated) continue;

    await admin
      .from("errand_jobs")
      .update({ errand_stage: "driver_assigned" })
      .eq("booking_id", (booking as any).id);

    return {
      ok: true,
      assigned: true,
      booking_id: text((updated as any).id),
      booking_code: text((updated as any).booking_code),
      driver_id: text((updated as any).assigned_driver_id),
      pickup_road_distance_km: Number(pickupDistanceKm.toFixed(3)),
      pickup_distance_fee: pickupFee,
      driver_accept_expires_at: expiresAt,
    };
  }

  return {
    ok: true,
    assigned: false,
    booking_id: text((booking as any).id),
    booking_code: text((booking as any).booking_code),
    error: "DRIVER_ASSIGNMENT_RACE_LOST",
  };
}
