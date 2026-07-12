import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  resolveAuthenticatedDriver,
  noStoreHeaders,
} from "@/lib/advance-booking/driverAuth";
import { estimateFare } from "@/lib/advance-booking/pricing";

export async function POST(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        message: auth.message,
      },
      {
        status: auth.status,
        headers: noStoreHeaders(),
      }
    );
  }

  try {
    const body = await req.json();

    const {
      offerId,
      departureOption,
      departureLat,
      departureLng,
      commitmentConfirmed,
    } = body;

    if (!offerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_OFFER_ID",
        },
        {
          status: 400,
          headers: noStoreHeaders(),
        }
      );
    }

    if (!commitmentConfirmed) {
      return NextResponse.json(
        {
          ok: false,
          error: "COMMITMENT_REQUIRED",
        },
        {
          status: 400,
          headers: noStoreHeaders(),
        }
      );
    }

    const supabase = supabaseAdmin();

    // Query 1: fetch queue row without embed.
    const { data: offer, error: offerError } = await supabase
      .from("advance_booking_queue")
      .select("id, advance_booking_id, driver_id, status")
      .eq("id", offerId)
      .eq("driver_id", auth.driverId)
      .eq("status", "offered")
      .single();

    if (offerError || !offer) {
      return NextResponse.json(
        {
          ok: false,
          error: "OFFER_NOT_FOUND",
          message: offerError?.message ?? "Offer not found.",
        },
        {
          status: 404,
          headers: noStoreHeaders(),
        }
      );
    }

    // Query 2: fetch booking row separately.
    const { data: booking, error: bookingError } = await supabase
      .from("advance_bookings")
      .select("id, distance_km, scheduled_pickup_at")
      .eq("id", offer.advance_booking_id)
      .single();

    if (bookingError || !booking) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_NOT_FOUND",
          message: bookingError?.message ?? "Booking record not found.",
        },
        {
          status: 404,
          headers: noStoreHeaders(),
        }
      );
    }

    const pricing = estimateFare(
      Number(booking.distance_km || 0),
      new Date(booking.scheduled_pickup_at),
      0
    );

    // Update filters driver_id and status = "offered" to prevent
    // the same queue row from being taken twice by the same driver.
    // NOTE: This does not prevent two different drivers from taking different
    // offered rows for the same advance_booking_id. Booking-level race
    // protection requires the atomic RPC that will replace this route.
    // Zero-row update (row already taken) returns 409.
    const { data: updatedOffer, error: updateOfferError } = await supabase
      .from("advance_booking_queue")
      .update({
        status: "tentative_committed",
        departure_option: departureOption,
        departure_lat: departureLat,
        departure_lng: departureLng,
        departure_set_at: new Date().toISOString(),
        pickup_fee_computed: pricing.pickupFee,
        fare_locked_total: pricing.total,
        commitment_confirmed: true,
      })
      .eq("id", offerId)
      .eq("driver_id", auth.driverId)
      .eq("status", "offered")
      .select("id")
      .maybeSingle();

    if (updateOfferError || !updatedOffer) {
      return NextResponse.json(
        {
          ok: false,
          error: updateOfferError?.message ?? "Offer is no longer available.",
        },
        {
          status: updateOfferError ? 500 : 409,
          headers: noStoreHeaders(),
        }
      );
    }

    // Capture booking update error explicitly.
    // NOTE: queue row is already tentative_committed at this point.
    // Without a transaction/RPC, a failure here cannot be rolled back.
    const { error: updateBookingError } = await supabase
      .from("advance_bookings")
      .update({
        driver_reserved_at: new Date().toISOString(),
        estimated_pickup_fee: pricing.pickupFee,
        estimated_total: pricing.total,
      })
      .eq("id", offer.advance_booking_id);

    if (updateBookingError) {
      return NextResponse.json(
        {
          ok: false,
          error: updateBookingError.message,
        },
        {
          status: 500,
          headers: noStoreHeaders(),
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        advanceBookingId: offer.advance_booking_id,
        pickupFee: pricing.pickupFee,
        total: pricing.total,
      },
      {
        headers: noStoreHeaders(),
      }
    );
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_SERVER_ERROR",
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      }
    );
  }
}
