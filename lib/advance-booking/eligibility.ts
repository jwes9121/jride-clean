import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MAX_SIMULTANEOUS_OFFERS } from "./constants";
import { pickupDistanceKm } from "./distance";
import type { EligibilityInput, EligibilityResult, VehicleType } from "./types";

const REUSABLE_QUEUE_STATUSES = new Set([
  "released",
  "superseded",
  "offer_expired",
]);

function isOnlineStatus(value: unknown): boolean {
  const s = String(value || "").trim().toLowerCase();
  return ["online", "available", "idle", "waiting"].includes(s);
}

function normVehicle(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function vehicleMatches(actual: unknown, requested: VehicleType): boolean {
  const a = normVehicle(actual);
  const r = normVehicle(requested);
  if (!a || !r) return false;
  return a === r;
}

function queueStatusAllowsReuse(value: unknown): boolean {
  return REUSABLE_QUEUE_STATUSES.has(
    String(value || "").trim().toLowerCase()
  );
}

export async function checkDriverEligibility(
  input: EligibilityInput,
  pickupLat: number,
  pickupLng: number,
  advanceBookingId: string
): Promise<EligibilityResult> {
  const supabase = supabaseAdmin();

  const { data: loc, error: locError } = await supabase
    .from("driver_locations_latest")
    .select("driver_id, lat, lng, status, vehicle_type, updated_at")
    .eq("driver_id", input.driverId)
    .single();

  if (locError || !loc) {
    return { eligible: false, reason: "Driver location not found." };
  }

  if (!isOnlineStatus(loc.status)) {
    return { eligible: false, reason: "Driver is not online." };
  }

  if (!vehicleMatches(loc.vehicle_type, input.vehicleType)) {
    return { eligible: false, reason: "Driver vehicle type does not match." };
  }

  const driverLat = Number(loc.lat);
  const driverLng = Number(loc.lng);

  if (!Number.isFinite(driverLat) || !Number.isFinite(driverLng)) {
    return { eligible: false, reason: "Driver location is invalid." };
  }

  const { data: driver, error: driverError } = await supabase
    .from("drivers")
    .select("id, driver_status, wallet_balance, min_wallet_required, wallet_locked")
    .eq("id", input.driverId)
    .single();

  if (driverError || !driver) {
    return { eligible: false, reason: "Driver record not found." };
  }

  if (!isOnlineStatus(driver.driver_status)) {
    return { eligible: false, reason: "Driver account is not online." };
  }

  if (driver.wallet_locked) {
    return { eligible: false, reason: "Driver wallet is locked." };
  }

  const walletBalance = Number(driver.wallet_balance ?? 0);
  const minWalletRequired = Number(driver.min_wallet_required ?? 0);

  if (
    !Number.isFinite(walletBalance) ||
    !Number.isFinite(minWalletRequired) ||
    walletBalance < minWalletRequired
  ) {
    return { eligible: false, reason: "Driver wallet is below minimum." };
  }

  const scheduledMs = input.scheduledPickupAt.getTime();
  const slotStart = new Date(scheduledMs - 45 * 60 * 1000).toISOString();
  const slotEnd = new Date(scheduledMs + 3 * 60 * 60 * 1000).toISOString();

  const { data: conflicts, error: conflictError } = await supabase
    .from("driver_reservation_slots")
    .select("id")
    .eq("driver_id", input.driverId)
    .eq("status", "active")
    .lt("slot_start", slotEnd)
    .gt("slot_end", slotStart)
    .limit(1);

  if (conflictError) {
    return { eligible: false, reason: "Could not verify schedule conflicts." };
  }

  if (conflicts && conflicts.length > 0) {
    return { eligible: false, reason: "Driver has a conflicting reservation." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("advance_booking_queue")
    .select("id, status")
    .eq("advance_booking_id", advanceBookingId)
    .eq("driver_id", input.driverId)
    .limit(1);

  if (existingError) {
    return { eligible: false, reason: "Could not verify previous offers." };
  }

  if (
    existing &&
    existing.length > 0 &&
    !queueStatusAllowsReuse(existing[0]?.status)
  ) {
    return {
      eligible: false,
      reason: "Driver already has a non-reusable queue state for this booking.",
    };
  }

  const distanceToPickupKm = pickupDistanceKm(
    driverLat,
    driverLng,
    pickupLat,
    pickupLng
  );

  return {
    eligible: true,
    driverLat,
    driverLng,
    distanceToPickupKm: Math.round(distanceToPickupKm * 100) / 100,
  };
}

export async function findNearestEligibleDrivers(
  pickupLat: number,
  pickupLng: number,
  vehicleType: VehicleType,
  scheduledPickupAt: Date,
  advanceBookingId: string,
  maxDrivers = MAX_SIMULTANEOUS_OFFERS
): Promise<Array<{ driverId: string; distanceKm: number }>> {
  const supabase = supabaseAdmin();

  const { data: locations, error } = await supabase
    .from("driver_locations_latest")
    .select("driver_id, lat, lng, status, vehicle_type, updated_at")
    .eq("vehicle_type", vehicleType);

  if (error || !locations || locations.length === 0) return [];

  const onlineLocs = locations.filter((loc) => {
    if (!loc.driver_id) return false;
    if (!isOnlineStatus(loc.status)) return false;
    if (!vehicleMatches(loc.vehicle_type, vehicleType)) return false;
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    return Number.isFinite(lat) && Number.isFinite(lng);
  });

  if (onlineLocs.length === 0) return [];

  const driverIds = onlineLocs.map((loc) => String(loc.driver_id));

  const scheduledMs = scheduledPickupAt.getTime();
  const windowStart = new Date(scheduledMs - 45 * 60 * 1000).toISOString();
  const windowEnd = new Date(scheduledMs + 3 * 60 * 60 * 1000).toISOString();

  const [driversResult, slotsResult, queueResult] = await Promise.all([
    supabase
      .from("drivers")
      .select(
        "id, driver_status, wallet_balance, min_wallet_required, wallet_locked"
      )
      .in("id", driverIds),

    supabase
      .from("driver_reservation_slots")
      .select("driver_id")
      .in("driver_id", driverIds)
      .eq("status", "active")
      .lt("slot_start", windowEnd)
      .gt("slot_end", windowStart),

    supabase
      .from("advance_booking_queue")
      .select("driver_id, status")
      .eq("advance_booking_id", advanceBookingId)
      .in("driver_id", driverIds),
  ]);

  if (driversResult.error || slotsResult.error || queueResult.error) {
    return [];
  }

  const driverById = new Map(
    (driversResult.data ?? []).map((d) => [String(d.id), d])
  );
  const conflictedIds = new Set(
    (slotsResult.data ?? []).map((s) => String(s.driver_id))
  );

  const blockedQueueDriverIds = new Set<string>();
  for (const row of queueResult.data ?? []) {
    if (!queueStatusAllowsReuse(row.status)) {
      blockedQueueDriverIds.add(String(row.driver_id));
    }
  }

  const candidates: Array<{ driverId: string; distanceKm: number }> = [];

  for (const loc of onlineLocs) {
    const driverId = String(loc.driver_id);

    if (conflictedIds.has(driverId)) continue;
    if (blockedQueueDriverIds.has(driverId)) continue;

    const driver = driverById.get(driverId);
    if (!driver) continue;
    if (!isOnlineStatus(driver.driver_status)) continue;
    if (driver.wallet_locked) continue;

    const walletBalance = Number(driver.wallet_balance ?? 0);
    const minWalletRequired = Number(driver.min_wallet_required ?? 0);

    if (
      !Number.isFinite(walletBalance) ||
      !Number.isFinite(minWalletRequired) ||
      walletBalance < minWalletRequired
    ) {
      continue;
    }

    const driverLat = Number(loc.lat);
    const driverLng = Number(loc.lng);

    candidates.push({
      driverId,
      distanceKm: pickupDistanceKm(
        driverLat,
        driverLng,
        pickupLat,
        pickupLng
      ),
    });
  }

  return candidates
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, maxDrivers);
}
