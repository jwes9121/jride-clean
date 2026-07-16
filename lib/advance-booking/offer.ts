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
  pickupTown: string;
  vehicleType: VehicleType;
  scheduledPickupAt: Date;
  excludedDriverIds?: string[];
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
    input.pickupTown,
    input.vehicleType,
    input.scheduledPickupAt,
    input.advanceBookingId,
    MAX_SIMULTANEOUS_OFFERS,
    input.excludedDriverIds ?? []
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
    driverId: driver.driverId,
    staggerPosition: index + 1,
    offerSentAt: new Date(
      now + index * OFFER_STAGGER_SECONDS * 1000
    ).toISOString(),
    offerExpiresAt: new Date(
      now +
        index * OFFER_STAGGER_SECONDS * 1000 +
        OFFER_TIMEOUT_SECONDS * 1000
    ).toISOString(),
  }));

  const { data, error } = await supabase.rpc(
    "upsert_advance_booking_offers",
    {
      p_advance_booking_id: input.advanceBookingId,
      p_offer_rows: rows,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as
    | {
        ok?: boolean;
        error?: string;
        message?: string;
        offersCreated?: number;
        driverIds?: string[];
      }
    | null;

  if (!result?.ok) {
    return {
      ok: false,
      error:
        result?.message ||
        result?.error ||
        "Advance booking offers could not be created.",
    };
  }

  return {
    ok: true,
    offersCreated: Number(result.offersCreated ?? 0),
    driverIds: Array.isArray(result.driverIds)
      ? result.driverIds.map(String)
      : [],
  };
}
