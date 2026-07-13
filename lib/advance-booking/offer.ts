import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { findNearestEligibleDrivers } from "./eligibility";
import {
  OFFER_STAGGER_SECONDS,
  MAX_SIMULTANEOUS_OFFERS,
  OFFER_TIMEOUT_SECONDS,
} from "./constants";
import type { VehicleType } from "./types";

export type OfferAdvanceBookingInput = {
  advanceBookingId: string;
  pickupLat: number;
  pickupLng: number;
  vehicleType: VehicleType;
  scheduledPickupAt: Date;
};

export type OfferAdvanceBookingResult =
  | {
      ok: true;
      offersCreated: number;
      driverIds: string[];
    }
  | {
      ok: false;
      error: string;
    };

export async function offerAdvanceBooking(
  input: OfferAdvanceBookingInput
): Promise<OfferAdvanceBookingResult> {
  const supabase = supabaseAdmin();

  const drivers = await findNearestEligibleDrivers(
    input.pickupLat,
    input.pickupLng,
    input.vehicleType,
    input.scheduledPickupAt,
    input.advanceBookingId,
    MAX_SIMULTANEOUS_OFFERS
  );

  if (drivers.length === 0) {
    return {
      ok: true,
      offersCreated: 0,
      driverIds: [],
    };
  }

  const now = Date.now();

  const rows = drivers.map((driver, index) => ({
    advance_booking_id: input.advanceBookingId,
    driver_id: driver.driverId,
    status: "offered",
    stagger_position: index + 1,
    offer_sent_at: new Date(
      now + index * OFFER_STAGGER_SECONDS * 1000
    ).toISOString(),
    offer_expires_at: new Date(
      now + index * OFFER_STAGGER_SECONDS * 1000 + OFFER_TIMEOUT_SECONDS * 1000
    ).toISOString(),
    commitment_confirmed: false,
  }));

  const { error } = await supabase
    .from("advance_booking_queue")
    .insert(rows);

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  return {
    ok: true,
    offersCreated: rows.length,
    driverIds: drivers.map((d) => d.driverId),
  };
}