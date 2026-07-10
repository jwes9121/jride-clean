import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MAX_SIMULTANEOUS_OFFERS } from "./constants";
import { pickupDistanceKm } from "./distance";
import type { EligibilityInput, EligibilityResult, VehicleType } from "./types";

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

  if (driver.wallet_locked) {
    return { eligible: false, reason: "Driver wallet is locked." };
  }

  const walletBalance = Number(driver.wallet_balance ?? 0);
  const minWalletRequired = Number(driver.min_wallet_required ?? 0);

  if (walletBalance < minWalletRequired) {
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
    .select("id")
    .eq("advance_booking_id", advanceBookingId)
    .eq("driver_id", input.driverId)
    .limit(1);

  if (existingError) {
    return { eligible: false, reason: "Could not verify previous offers." };
  }

  if (existing && existing.length > 0) {
    return { eligible: false, reason: "Driver already received this offer." };
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

  // Step 1: fetch online driver locations filtered by vehicle type (same query as before)
  const { data: locations, error } = await supabase
    .from("driver_locations_latest")
    .select("driver_id, lat, lng, status, vehicle_type, updated_at")
    .eq("vehicle_type", vehicleType);

  if (error || !locations || locations.length === 0) return [];

  // Keep only online drivers with valid coordinates and matching vehicle type
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

  // Booking window for conflict detection.
  // slot_start = pickup - 45 min (Reserved Mode begins).
  // slot_end   = pickup + 3h (matches production slotEnd in checkDriverEligibility).
  const scheduledMs = scheduledPickupAt.getTime();
  const windowStart = new Date(scheduledMs - 45 * 60 * 1000).toISOString();
  const windowEnd   = new Date(scheduledMs + 3 * 60 * 60 * 1000).toISOString();

  // Steps 2-4: bulk load drivers, conflict slots, and existing offers in parallel.
  // 3 queries regardless of how many drivers exist.
  const [driversResult, slotsResult, offersResult] = await Promise.all([
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
      .select("driver_id")
      .eq("advance_booking_id", advanceBookingId)
      .in("driver_id", driverIds),
  ]);

  // Fail-closed: if any bulk query errors, return empty rather than using
  // partial results which could incorrectly accept or reject drivers.
  if (driversResult.error || slotsResult.error || offersResult.error) {
    return [];
  }

  // Index by driver_id for O(1) in-memory lookup
  const driverById = new Map(
    (driversResult.data ?? []).map((d) => [String(d.id), d])
  );
  const conflictedIds = new Set(
    (slotsResult.data ?? []).map((s) => String(s.driver_id))
  );
  const offeredIds = new Set(
    (offersResult.data ?? []).map((o) => String(o.driver_id))
  );

  // Step 5: filter in memory using the same rules as checkDriverEligibility.
  // Note: driver_status is NOT evaluated here because production checkDriverEligibility
  // fetches the field but does not evaluate it. Authoritative online check is loc.status.
  const candidates: Array<{ driverId: string; distanceKm: number }> = [];

  for (const loc of onlineLocs) {
    const driverId = String(loc.driver_id);

    // Reservation conflict
    if (conflictedIds.has(driverId)) continue;

    // Already received an offer for this booking
    if (offeredIds.has(driverId)) continue;

    // Driver record checks
    const driver = driverById.get(driverId);
    if (!driver) continue;

    // Wallet lock
    if (driver.wallet_locked) continue;

    // Wallet balance threshold.
    // Number.isFinite() guards against NaN: NaN < x returns false, so malformed
    // values would bypass the check without the explicit isFinite guard.
    const walletBalance     = Number(driver.wallet_balance ?? 0);
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

    // Reuse existing pickupDistanceKm() -- no Haversine duplication
    candidates.push({
      driverId,
      distanceKm: pickupDistanceKm(driverLat, driverLng, pickupLat, pickupLng),
    });
  }

  return candidates
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, maxDrivers);
}