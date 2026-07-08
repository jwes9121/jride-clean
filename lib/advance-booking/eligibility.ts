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

  const { data: locations, error } = await supabase
    .from("driver_locations_latest")
    .select("driver_id, lat, lng, status, vehicle_type, updated_at")
    .eq("vehicle_type", vehicleType);

  if (error || !locations || locations.length === 0) return [];

  const candidates: Array<{ driverId: string; distanceKm: number }> = [];

  for (const loc of locations) {
    if (!loc.driver_id) continue;
    if (!isOnlineStatus(loc.status)) continue;

    const driverLat = Number(loc.lat);
    const driverLng = Number(loc.lng);

    if (!Number.isFinite(driverLat) || !Number.isFinite(driverLng)) continue;

    const eligibility = await checkDriverEligibility(
      {
        driverId: String(loc.driver_id),
        vehicleType,
        scheduledPickupAt,
      },
      pickupLat,
      pickupLng,
      advanceBookingId
    );

    if (!eligibility.eligible) continue;

    candidates.push({
      driverId: String(loc.driver_id),
      distanceKm: eligibility.distanceToPickupKm ?? pickupDistanceKm(
  driverLat,
  driverLng,
  pickupLat,
  pickupLng
)
    });
  }

  return candidates
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, maxDrivers);
}