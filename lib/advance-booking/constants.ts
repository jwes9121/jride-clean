// lib/advance-booking/constants.ts
//
// All hardcoded business rules for JRide Advance Booking.
// No functions. No imports. No side effects.
//
// To change a rule: update this file, redeploy.
// If rules need per-route flexibility later, migrate to a business_rules table.

// ------------------------------------------------------------
// Booking Window
// ------------------------------------------------------------

// Minimum hours between booking creation and scheduled pickup
export const ADVANCE_MIN_HOURS = 2;

// Maximum hours between booking creation and scheduled pickup
export const ADVANCE_MAX_HOURS = 24;

// ------------------------------------------------------------
// Lock Window
// ------------------------------------------------------------

// Hours before scheduled pickup when driver commitment becomes locked.
// Before this window: driver may release without penalty.
// Inside this window: release counts as late cancellation.
export const LOCK_HOURS_BEFORE_PICKUP = 2;

// ------------------------------------------------------------
// Offer Mechanics
// ------------------------------------------------------------

// Seconds a driver has to TAKE or PASS after receiving an offer
export const OFFER_TIMEOUT_SECONDS = 300; // 5 minutes

// Seconds between staggered offers to multiple drivers
// Driver A -> +30s Driver B -> +60s Driver C
export const OFFER_STAGGER_SECONDS = 30;

// Maximum drivers offered simultaneously (staggered)
export const MAX_SIMULTANEOUS_OFFERS = 3;

// Seconds passenger has to Accept or Decline after driver taps TAKE
export const PASSENGER_RESPONSE_TIMEOUT_SECONDS = 300; // 5 minutes

// ------------------------------------------------------------
// Pickup Fee
// ------------------------------------------------------------

// Distance in km within which pickup is free
export const FREE_PICKUP_KM = 1.5;

// Rate per km beyond FREE_PICKUP_KM (in PHP)
// Update this when LGU changes the pickup fee rate
export const PICKUP_FEE_RATE_PER_KM = 10;

// ------------------------------------------------------------
// Platform Fee
// ------------------------------------------------------------

// Flat platform fee per completed trip (in PHP)
// Matches existing JRide platform cut
export const PLATFORM_FEE_NORMAL = 15; // fare < 50
export const PLATFORM_FEE_STANDARD = 20; // fare >= 50

// ------------------------------------------------------------
// Night Rate Schedule
// All hours are in Philippine Time (PHT = UTC+8)
// ------------------------------------------------------------

// 05:00 - 19:59 PHT: normal fare (daytime mode)
export const DAYTIME_START_HOUR_PHT = 5;
export const DAYTIME_END_HOUR_PHT = 19;

// 20:00 - 22:59 PHT: double fare (night mode)
export const DOUBLE_FARE_START_HOUR_PHT = 20;
export const DOUBLE_FARE_END_HOUR_PHT = 22;

// 23:00 - 04:59 PHT: base P100 + fare matrix (late night mode)
export const LATE_NIGHT_START_HOUR_PHT = 23;
// Late night wraps past midnight so end is defined by DAYTIME_START_HOUR_PHT

// Base fare added to matrix for late night bracket (in PHP)
export const LATE_NIGHT_BASE_FARE = 100;

// ------------------------------------------------------------
// LGU Fare Matrix (PHP)
// Update when the LGU issues a revised rate schedule.
// Distance-based rates applied to trip distance (pickup to destination).
// ------------------------------------------------------------

export const FARE_MATRIX = {
  // Minimum fare regardless of distance
  minimumFare: 40,

  // Base flag-down (first km included)
  baseFare: 40,

  // Per km rate after the first km
  perKmRate: 12,
} as const;

// ------------------------------------------------------------
// Reminder Schedule
// How many minutes before pickup each reminder fires.
// ------------------------------------------------------------

export const REMINDER_MINUTES = {
  passenger: [24 * 60, 60, 30, 10], // 24h, 1h, 30m, 10m before pickup
  driver: [24 * 60, 60, 30, 10],    // same schedule for drivers
} as const;

// Night trip reconfirmation (minutes before pickup)
// Driver must actively confirm they are still committed
export const NIGHT_RECONFIRM_MINUTES_BEFORE = 60;

// Minutes of no acknowledgment before dispatcher is alerted
export const DISPATCHER_ALERT_NO_ACK_MINUTES = 10;

// ------------------------------------------------------------
// Escalation Ladder (minutes before pickup)
// ------------------------------------------------------------

export const ESCALATION = {
  // If no driver has accepted yet by this point, send priority push
  priorityPushMinutes: 6 * 60,     // 6 hours before pickup

  // If still no driver, alert dispatcher
  dispatcherAlertMinutes: 3 * 60,  // 3 hours before pickup

  // Dispatcher URGENT alert
  urgentAlertMinutes: 90,          // 90 minutes before pickup

  // Inform passenger honestly that we are still searching
  informPassengerMinutes: 60,      // 60 minutes before pickup
} as const;
