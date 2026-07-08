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

    const { data: offer, error: offerError } = await supabase
      .from("advance_booking_queue")
      .select(`
        *,
        advance_bookings(*)
      `)
      .eq("id", offerId)
      .eq("driver_id", auth.driverId)
      .eq("status", "offered")
      .single();

    if (offerError || !offer) {
      return NextResponse.json(
        {
          ok: false,
          error: "OFFER_NOT_FOUND",
        },
        {
          status: 404,
          headers: noStoreHeaders(),
        }
      );
    }

    const pricing = estimateFare(
  Number(offer.advance_bookings.distance_km || 0),
  new Date(offer.advance_bookings.scheduled_pickup_at),
  0
);

    const { error: updateOfferError } = await supabase
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
      .eq("id", offerId);

    if (updateOfferError) {
      return NextResponse.json(
        {
          ok: false,
          error: updateOfferError.message,
        },
        {
          status: 500,
          headers: noStoreHeaders(),
        }
      );
    }

    await supabase
      .from("advance_bookings")
      .update({
        driver_reserved_at: new Date().toISOString(),
        estimated_pickup_fee: pricing.pickupFee,
        estimated_total: pricing.total,
      })
      .eq("id", offer.advance_booking_id);

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