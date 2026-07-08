// lib/advance-booking/types.ts
//
// Canonical type definitions for JRide Advance Booking.
// No functions. No imports from other advance-booking modules.
// All other modules import from here.

// ------------------------------------------------------------
// Enums
// ------------------------------------------------------------

export type BookingMode = "daytime" | "night";

export type FareBracket = "normal" | "double" | "late_night";

export type DepartureOption = "current_gps" | "home" | "other";

export type PassReason =
  | "sleeping"
  | "too_far_to_reach_in_time"
  | "already_have_plans"
  | "vehicle_problem"
  | "personal_emergency"
  | "other";

export type VehicleType = "tricycle" | "motorcycle";

export type AdvanceBookingStatus =
  | "open"                   // queue open, sending driver offers
  | "fare_proposed"          // driver accepted, passenger reviewing fare
  | "fare_accepted"          // passenger accepted, driver reserved
  | "pickup_fee_pending"     // computing pickup fee (unused in current model - fare locked at TAKE)
  | "pickup_fee_proposed"    // unused in current model
  | "confirmed"              // driver locked, ready to convert
  | "converting"             // being converted to live booking
  | "live"                   // converted, normal JRide booking
  | "completed"              // trip completed
  | "cancelled_passenger"    // passenger cancelled
  | "cancelled_driver"       // committed driver cancelled after lock
  | "cancelled_no_driver"    // no driver accepted before cutoff
  | "dispatcher_intervention"; // escalated, dispatcher handling

export type DriverOfferStatus =
  | "offered"              // offer sent, awaiting driver response
  | "passed"               // driver explicitly passed
  | "offer_expired"        // 5-minute window elapsed, no response
  | "tentative_committed"  // driver tapped TAKE, awaiting passenger
  | "passenger_declined"   // passenger declined this driver's offer
  | "passenger_expired"    // passenger did not respond in time
  | "reserved"             // passenger accepted, driver reserved
  | "locked"               // past 2-hour lock window, commitment binding
  | "released"             // driver released before lock (no penalty)
  | "cancelled_driver"     // driver cancelled after lock
  | "emergency_released"   // dispatcher-approved release after lock
  | "completed"            // trip completed
  | "superseded";          // another driver was reserved before this one

export type ReminderType =
  | "24h_before"
  | "1h_before"
  | "30m_before"
  | "10m_before"
  | "60m_confirm"          // night reconfirmation
  | "5m_no_response"       // second alarm if no confirm response
  | "10m_dispatcher_alert" // dispatcher notified after no response
  | "pickup_fee_ready"     // unused in current model
  | "no_driver_warning"    // passenger informed still searching
  | "escalation_notice";   // priority push to drivers

export type ReminderTargetType = "passenger" | "driver" | "dispatcher";

export type EscalationLevel = 0 | 1 | 2 | 3 | 4;
// 0 = none
// 1 = low_interest (12h before, no drivers)
// 2 = priority_push (6h before, still no drivers)
// 3 = dispatcher_alert (3h before)
// 4 = urgent (90 min before)

// ------------------------------------------------------------
// Pricing
// ------------------------------------------------------------

export interface PricingResult {
  rideFare: number;
  nightPremium: number;        // 0 for normal bracket
  pickupFee: number;           // 0 if within FREE_PICKUP_KM
  platformFee: number;
  total: number;

  bookingMode: BookingMode;
  fareBracket: FareBracket;

  // For UI display
  pickupDistanceKm: number;
  pickupIsFree: boolean;
  nightRateApplied: boolean;
}

// Input for fare computation
export interface PricingInput {
  tripDistanceKm: number;
  pickupDistanceKm: number;      // distance from departure location to pickup point
  scheduledPickupAt: Date;       // used to determine fare bracket
}

// ------------------------------------------------------------
// Booking Creation
// ------------------------------------------------------------

export interface AdvanceBookingCreateInput {
  passengerId: string;           // passenger_profiles.user_id

  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;

  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;

  vehicleType: VehicleType;
  scheduledPickupAt: string;     // ISO 8601 string from client
  notes?: string;
}

export interface AdvanceBookingCreateResult {
  ok: boolean;
  advanceBookingId?: string;
  bookingMode?: BookingMode;
  fareBracket?: FareBracket;
  scheduledPickupAt?: string;
  error?: AdvanceBookingError;
}

// ------------------------------------------------------------
// Driver Offer
// ------------------------------------------------------------

export interface DriverOfferInput {
  advanceBookingId: string;
  driverId: string;
  driverLat: number;
  driverLng: number;
  staggerPosition: number;       // 1, 2, or 3
}

export interface DriverTakeInput {
  advanceBookingId: string;
  queueEntryId: string;
  driverId: string;
  departureOption: DepartureOption;
  departureLat: number;
  departureLng: number;
  commitmentConfirmed: true;     // must be true, enforced at API level
}

export interface DriverPassInput {
  advanceBookingId: string;
  queueEntryId: string;
  driverId: string;
  passReason: PassReason;
  passReasonDetail?: string;     // required only when passReason = 'other'
}

export interface DriverOfferResult {
  ok: boolean;
  queueEntryId?: string;
  pricingResult?: PricingResult;
  offerExpiresAt?: string;
  error?: AdvanceBookingError;
}

// ------------------------------------------------------------
// Passenger Response
// ------------------------------------------------------------

export interface PassengerResponseInput {
  advanceBookingId: string;
  passengerId: string;
  response: "accept" | "decline";
}

export interface PassengerResponseResult {
  ok: boolean;
  status?: AdvanceBookingStatus;
  driverReservedAt?: string;
  error?: AdvanceBookingError;
}

// ------------------------------------------------------------
// Driver Eligibility
// ------------------------------------------------------------

export interface EligibilityInput {
  driverId: string;
  vehicleType: VehicleType;
  scheduledPickupAt: Date;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  // populated when eligible = true
  driverLat?: number;
  driverLng?: number;
  distanceToPickupKm?: number;
}

// ------------------------------------------------------------
// Cancellation
// ------------------------------------------------------------

export interface CancelInput {
  advanceBookingId: string;
  cancelledBy: "passenger" | "driver" | "system" | "dispatcher";
  reason?: string;
}

export interface CancelResult {
  ok: boolean;
  advanceBookingId?: string;
  minutesBeforePickup?: number;  // for reliability event classification
  isLateCancellation?: boolean;  // true if within LOCK_HOURS_BEFORE_PICKUP
  error?: AdvanceBookingError;
}

// ------------------------------------------------------------
// Conversion to Live Booking
// ------------------------------------------------------------

export interface ConvertInput {
  advanceBookingId: string;
}

export interface ConvertResult {
  ok: boolean;
  liveBookingId?: string;
  error?: AdvanceBookingError;
}

// ------------------------------------------------------------
// Error Types
// ------------------------------------------------------------

export type AdvanceBookingError =
  | "PASSENGER_NOT_VERIFIED"
  | "BOOKING_WINDOW_TOO_SOON"        // < 2 hours from now
  | "BOOKING_WINDOW_TOO_FAR"         // > 24 hours from now
  | "INVALID_SCHEDULED_TIME"
  | "INVALID_COORDINATES"
  | "BOOKING_NOT_FOUND"
  | "DRIVER_NOT_FOUND"
  | "DRIVER_NOT_ELIGIBLE"
  | "DRIVER_SCHEDULE_CONFLICT"
  | "OFFER_NOT_FOUND"
  | "OFFER_EXPIRED"
  | "OFFER_ALREADY_TAKEN"
  | "COMMITMENT_NOT_CONFIRMED"
  | "BOOKING_NOT_IN_OPEN_STATUS"
  | "BOOKING_NOT_IN_FARE_PROPOSED_STATUS"
  | "BOOKING_ALREADY_RESERVED"
  | "BOOKING_LOCKED_NO_RELEASE"
  | "PASSENGER_RESPONSE_EXPIRED"
  | "BOOKING_NOT_CANCELLABLE"
  | "BOOKING_NOT_CONVERTIBLE"
  | "NO_ELIGIBLE_DRIVERS"
  | "HOME_LOCATION_NOT_SET"
  | "MISSING_PARAMS"
  | "DATABASE_ERROR"
  | "UNKNOWN_ERROR";
