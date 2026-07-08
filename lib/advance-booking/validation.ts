// lib/advance-booking/validation.ts
//
// Input and business rule validation for JRide Advance Booking.
// No database access. No side effects. 100% testable.

import {
  ADVANCE_MIN_HOURS,
  ADVANCE_MAX_HOURS,
} from "./constants";

import type { AdvanceBookingError, VehicleType } from "./types";

export interface ValidationResult {
  ok: boolean;
  error?: AdvanceBookingError;
  message?: string;
}

const VALID_VEHICLE_TYPES: VehicleType[] = ["tricycle", "motorcycle"];

/**
 * Validate that scheduledPickupAt is:
 *   - a valid date
 *   - at least ADVANCE_MIN_HOURS from now
 *   - at most ADVANCE_MAX_HOURS from now
 */
export function validateBookingWindow(
  scheduledPickupAt: Date,
  now: Date = new Date()
): ValidationResult {
  if (isNaN(scheduledPickupAt.getTime())) {
    return {
      ok: false,
      error: "INVALID_SCHEDULED_TIME",
      message: "Scheduled pickup time is not a valid date.",
    };
  }

  const diffMs = scheduledPickupAt.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < ADVANCE_MIN_HOURS) {
    return {
      ok: false,
      error: "BOOKING_WINDOW_TOO_SOON",
      message: `Advance bookings must be scheduled at least ${ADVANCE_MIN_HOURS} hours from now.`,
    };
  }

  if (diffHours > ADVANCE_MAX_HOURS) {
    return {
      ok: false,
      error: "BOOKING_WINDOW_TOO_FAR",
      message: `Advance bookings cannot be scheduled more than ${ADVANCE_MAX_HOURS} hours in advance.`,
    };
  }

  return { ok: true };
}

/**
 * Validate coordinates.
 * Checks that lat/lng are finite numbers within valid geographic ranges.
 */
export function validateCoordinates(
  lat: number,
  lng: number,
  label = "location"
): ValidationResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      ok: false,
      error: "INVALID_COORDINATES",
      message: `${label} coordinates are not valid numbers.`,
    };
  }

  if (lat < -90 || lat > 90) {
    return {
      ok: false,
      error: "INVALID_COORDINATES",
      message: `${label} latitude must be between -90 and 90.`,
    };
  }

  if (lng < -180 || lng > 180) {
    return {
      ok: false,
      error: "INVALID_COORDINATES",
      message: `${label} longitude must be between -180 and 180.`,
    };
  }

  return { ok: true };
}

/**
 * Validate vehicle type.
 */
export function validateVehicleType(
  vehicleType: unknown
): ValidationResult {
  if (!VALID_VEHICLE_TYPES.includes(vehicleType as VehicleType)) {
    return {
      ok: false,
      error: "MISSING_PARAMS",
      message: `Vehicle type must be one of: ${VALID_VEHICLE_TYPES.join(", ")}.`,
    };
  }

  return { ok: true };
}

/**
 * Validate all required string fields are present and non-empty.
 */
export function validateRequiredStrings(
  fields: Record<string, unknown>
): ValidationResult {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return {
        ok: false,
        error: "MISSING_PARAMS",
        message: `${key} is required and must be a non-empty string.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Compute booking_expires_at = scheduled_pickup_at - 2 hours.
 * The queue closes at this point; no new offers can be sent.
 * Must always be set explicitly at INSERT -- never derived in a DB constraint.
 */
export function computeBookingExpiresAt(scheduledPickupAt: Date): Date {
  return new Date(
    scheduledPickupAt.getTime() - ADVANCE_MIN_HOURS * 60 * 60 * 1000
  );
}

/**
 * Compute the lock time = scheduled_pickup_at - LOCK_HOURS_BEFORE_PICKUP.
 * Before this time: driver may release without penalty.
 * After this time: release counts as late cancellation.
 */
export function computeLockAt(
  scheduledPickupAt: Date,
  lockHoursBefore: number
): Date {
  return new Date(
    scheduledPickupAt.getTime() - lockHoursBefore * 60 * 60 * 1000
  );
}

/**
 * Returns true if the current time is past the lock window for this booking.
 */
export function isWithinLockWindow(
  scheduledPickupAt: Date,
  lockHoursBefore: number,
  now: Date = new Date()
): boolean {
  const lockAt = computeLockAt(scheduledPickupAt, lockHoursBefore);
  return now >= lockAt;
}

/**
 * Returns minutes between now and scheduled pickup.
 * Negative if pickup is in the past.
 */
export function minutesUntilPickup(
  scheduledPickupAt: Date,
  now: Date = new Date()
): number {
  return Math.round(
    (scheduledPickupAt.getTime() - now.getTime()) / (1000 * 60)
  );
}
