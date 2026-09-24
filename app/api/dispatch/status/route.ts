import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  evaluateShortTripAutomaticFare,
  type ShortTripFareEvaluation,
} from "@/lib/shortTripAutomaticPilot";
import {
  isRegularRideServiceType,
  SHORT_TRIP_AUTOMATIC_FARE_VERSION,
} from "@/lib/shortTripAutomaticFare";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  assigned: ["accepted"],
  accepted: ["fare_proposed"],
  fare_proposed: ["ready"],
  ready: ["on_the_way"],
  on_the_way: ["arrived"],
  arrived: ["on_trip"],
  on_trip: ["completed"],
};

function clean(v: any): string {
  return typeof v === "string" ? v.trim() : "";
}

function getAdminClient(req: NextRequest) {
  const headerSecret = clean(req.headers.get("x-jride-driver-secret"));
  const expected = clean(process.env.DRIVER_PING_SECRET);

  if (!headerSecret || !expected || headerSecret !== expected) return null;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function finalizeTripSafe(
  supabase: any,
  input: { bookingCode?: string; bookingId?: string; serviceType?: string }
) {
  const id = clean(input.bookingId);
  const serviceType = clean(input.serviceType).toLowerCase();

  if (!id) {
    return { ok: false, error: "MISSING_BOOKING_ID" };
  }

  const settlementRpc =
    serviceType === "errand"
      ? "settle_completed_errand_wallet_v1"
      : "settle_completed_ride_wallet_v2";

  const { data, error } = await supabase.rpc(settlementRpc, {
    p_booking_id: id,
    p_settled_by: "dispatch_status_route",
  });

  if (error) {
    return { ok: false, error: String(error?.message || error) };
  }

  if (data && data.ok === false) {
    return {
      ok: false,
      error: String(data.error || "FINALIZE_TRIP_FAILED"),
      data,
    };
  }

  return {
    ok: true,
    data,
    settlementRpc,
    usedArgs: { p_booking_id: id },
  };
}

async function finalizePromoSafe(supabase: any, booking: any) {
  const promoStatus = clean(booking?.promo_status).toLowerCase();
  const promoProgramCode = clean(booking?.promo_program_code) || "ANDROID_FIRST_RIDE_40";
  const driverId = clean(booking?.driver_id || booking?.assigned_driver_id);
  const bookingId = clean(booking?.id);
  const bookingCode = clean(booking?.booking_code);

  if (!bookingId || !driverId || promoStatus !== "reserved") {
    return { ok: true, skipped: true };
  }

  const verifiedFareRaw = Number(booking?.verified_fare ?? 0);
  const proposedFareRaw = Number(booking?.proposed_fare ?? 0);
  const pickupFeeRaw = Number(booking?.pickup_distance_fee ?? 0);
  const fareBaseRaw = Number.isFinite(verifiedFareRaw) && verifiedFareRaw > 0 ? verifiedFareRaw : proposedFareRaw;
  const fareBase = Number.isFinite(fareBaseRaw) && fareBaseRaw > 0 ? fareBaseRaw : 0;
  const pickupFee = Number.isFinite(pickupFeeRaw) && pickupFeeRaw > 0 ? pickupFeeRaw : 0;
  const completedTotal = Number(Math.max(fareBase + pickupFee + 15, 0).toFixed(2));

  const { data, error } = await supabase.rpc("jride_promo_finalize_completed_booking", {
    p_booking_id: bookingId,
    p_completed_total: completedTotal,
    p_driver_id: driverId,
    p_booking_code: bookingCode,
    p_program_code: promoProgramCode,
  });

  if (error) {
    return { ok: false, error: String(error?.message || error) };
  }

  return { ok: true, data: data ?? null, completed_total: completedTotal };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const bookingCode = clean(body?.bookingCode || body?.booking_code);
    const bookingId = clean(body?.bookingId || body?.booking_id);
    const nextStatus = clean(body?.status || body?.newStatus).toLowerCase();

    if ((!bookingCode && !bookingId) || !nextStatus) {
      return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    }

    const routeClient = createRouteHandlerClient({ cookies });
    const adminClient = getAdminClient(req);
    const supabase = adminClient ?? routeClient;
    // Cookie clients must prove driver identity before using private settlement RPCs.
    let authenticatedDriverId: string | null = null;
    if (!adminClient) {
      const { data, error } = await routeClient.auth.getUser();
      if (error || !data?.user?.id) {
        return NextResponse.json({ ok: false, error: "NOT_AUTHED" }, { status: 401 });
      }
      authenticatedDriverId = data.user.id;
    }

    let query = supabase
      .from("bookings")
      .select(
        "id, booking_code, status, service_type, driver_id, assigned_driver_id, created_by_user_id, town, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, proposed_fare, verified_fare, pickup_distance_fee, promo_applied_amount, promo_status, promo_program_code, passenger_fare_response, driver_accept_expires_at, driver_fee_proposal_expires_at, ride_fare_mode, ride_fare_pricing_version, ride_fare_provenance, short_trip_fare_evaluation"
      )
      .limit(1);

    if (bookingCode) {
      query = query.eq("booking_code", bookingCode);
    } else {
      query = query.eq("id", bookingId);
    }

    const { data: booking, error } = await query.single();

    if (error || !booking) {
      return NextResponse.json({ ok: false, error: "booking_not_found" }, { status: 404 });
    }

    if (authenticatedDriverId &&
        authenticatedDriverId !== clean(booking.assigned_driver_id || booking.driver_id)) {
      return NextResponse.json({ ok: false, error: "BOOKING_NOT_ASSIGNED_TO_DRIVER" }, { status: 403 });
    }

    const current = clean(booking.status).toLowerCase();
    const allowed = ALLOWED_TRANSITIONS[current] || [];

    if (!allowed.includes(nextStatus)) {
      return NextResponse.json(
        { ok: false, error: "invalid_transition", from: current, to: nextStatus },
        { status: 409 }
      );
    }

    if (nextStatus === "fare_proposed" || current === "fare_proposed") {
      return NextResponse.json(
        {
          ok: false,
          error: "canonical_fare_route_required",
          message:
            nextStatus === "fare_proposed"
              ? "Use the driver fare-proposal route."
              : "Use the passenger fare-response route.",
        },
        { status: 409 }
      );
    }

    if (nextStatus === "completed") {
      const settlementClient = adminClient ?? supabaseAdmin({ noStore: true });
      const finalized = await finalizeTripSafe(settlementClient, {
        bookingCode: booking.booking_code || bookingCode,
        bookingId: booking.id || bookingId,
        serviceType: booking.service_type,
      });

      if (!finalized.ok) {
        return NextResponse.json(
          { ok: false, error: finalized.error || "complete_finalize_failed" },
          { status: 500 }
        );
      }

      const promoFinalized = await finalizePromoSafe(settlementClient, booking);
      if (!promoFinalized.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: promoFinalized.error || "promo_finalize_failed",
            completed_via: "admin_finalize_trip_and_credit_wallets",
            settlement_rpc: finalized.settlementRpc,
            result: finalized.data ?? null,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        completed_via: "admin_finalize_trip_and_credit_wallets",
        settlement_rpc: finalized.settlementRpc,
        result: finalized.data ?? null,
        promo_finalize: promoFinalized,
      });
    }

    const updatePayload: Record<string, any> = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    let shortTripEvaluation: ShortTripFareEvaluation | null = null;

    if (nextStatus === "accepted") {
      const expectedAcceptExpiry = clean(booking.driver_accept_expires_at);
      const expectedAcceptExpiryMs = Date.parse(expectedAcceptExpiry);
      if (
        !expectedAcceptExpiry ||
        !Number.isFinite(expectedAcceptExpiryMs) ||
        expectedAcceptExpiryMs <= Date.now()
      ) {
        return NextResponse.json(
          { ok: false, error: "driver_accept_window_expired_or_changed" },
          { status: 409 }
        );
      }

      if (isRegularRideServiceType(booking.service_type)) {
        try {
          shortTripEvaluation = await evaluateShortTripAutomaticFare({
            booking,
            driverId: clean(booking.assigned_driver_id || booking.driver_id),
            supabase,
          });
        } catch (pilotError: any) {
          console.warn(
            "[SHORT_TRIP_AUTOMATIC_FARE_EVALUATION_FAILED]",
            JSON.stringify({
              booking_code: clean(booking.booking_code) || null,
              error: String(pilotError?.message ?? pilotError),
            })
          );
        }
      }

      if (shortTripEvaluation?.outcome === "automatic" && shortTripEvaluation.fare) {
        const fare = shortTripEvaluation.fare;
        updatePayload.status = "ready";
        updatePayload.proposed_fare = fare.automaticRideFare;
        updatePayload.verified_fare = fare.automaticRideFare;
        updatePayload.submitted_regular_fare = null;
        updatePayload.passenger_fare_response = "accepted";
        updatePayload.driver_accept_expires_at = null;
        updatePayload.driver_fee_proposal_expires_at = null;
        updatePayload.driver_to_pickup_km = shortTripEvaluation.driverToPickupKm;
        updatePayload.pickup_distance_fee = fare.pickupDistanceFee;
        updatePayload.trip_distance_km = shortTripEvaluation.roadDistanceKm;
        updatePayload.ride_fare_mode = SHORT_TRIP_AUTOMATIC_FARE_VERSION;
        updatePayload.ride_fare_pricing_version = SHORT_TRIP_AUTOMATIC_FARE_VERSION;
        updatePayload.ride_fare_provenance = String(
          shortTripEvaluation.snapshot.provenance ||
            "mapbox_road_open_meteo_glo90_v1"
        );
        updatePayload.short_trip_road_distance_km = shortTripEvaluation.roadDistanceKm;
        updatePayload.short_trip_validated_elevation_gain_m =
          shortTripEvaluation.elevation.cumulativePositiveElevationGainM;
        updatePayload.short_trip_free_elevation_allowance_m =
          fare.freeElevationAllowanceM;
        updatePayload.short_trip_chargeable_elevation_gain_m =
          fare.chargeableElevationGainM;
        updatePayload.short_trip_distance_component = fare.distanceComponent;
        updatePayload.short_trip_elevation_premium = fare.elevationPremium;
        updatePayload.short_trip_ride_minimum_applied = fare.rideMinimumApplied;
        updatePayload.short_trip_passenger_minimum_applied =
          fare.passengerTotalMinimumApplied;
        updatePayload.short_trip_automatic_ride_fare = fare.automaticRideFare;
        updatePayload.short_trip_convenience_fee = fare.convenienceFee;
        updatePayload.short_trip_total = fare.total;
        updatePayload.short_trip_elevation_source = shortTripEvaluation.elevation.source;
        updatePayload.short_trip_elevation_status = shortTripEvaluation.elevation.status;
        updatePayload.short_trip_elevation_validation_reason =
          shortTripEvaluation.elevation.validationReason;
        updatePayload.short_trip_fare_evaluation = shortTripEvaluation.snapshot;
      } else {
        updatePayload.driver_fee_proposal_expires_at = new Date(
          Date.now() + 5 * 60 * 1000
        ).toISOString();
        updatePayload.driver_accept_expires_at = null;
        if (shortTripEvaluation) {
          updatePayload.ride_fare_mode = null;
          updatePayload.ride_fare_pricing_version = null;
          updatePayload.ride_fare_provenance = null;
          updatePayload.short_trip_road_distance_km = shortTripEvaluation.roadDistanceKm;
          updatePayload.short_trip_validated_elevation_gain_m =
            shortTripEvaluation.elevation.cumulativePositiveElevationGainM;
          updatePayload.short_trip_free_elevation_allowance_m = 25;
          updatePayload.short_trip_chargeable_elevation_gain_m = null;
          updatePayload.short_trip_distance_component = null;
          updatePayload.short_trip_elevation_premium = null;
          updatePayload.short_trip_ride_minimum_applied = null;
          updatePayload.short_trip_passenger_minimum_applied = null;
          updatePayload.short_trip_automatic_ride_fare = null;
          updatePayload.short_trip_convenience_fee = null;
          updatePayload.short_trip_total = null;
          updatePayload.short_trip_elevation_source = shortTripEvaluation.elevation.source;
          updatePayload.short_trip_elevation_status = shortTripEvaluation.elevation.status;
          updatePayload.short_trip_elevation_validation_reason =
            shortTripEvaluation.elevation.validationReason;
          updatePayload.short_trip_fare_evaluation = shortTripEvaluation.snapshot;
        }
      }
    }

    let updateQuery = supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", booking.id)
      .eq("status", current);

    const assignedDriverId = clean(
      booking.assigned_driver_id || booking.driver_id
    );
    updateQuery = assignedDriverId
      ? updateQuery.eq("assigned_driver_id", assignedDriverId)
      : updateQuery.is("assigned_driver_id", null);

    if (nextStatus === "accepted") {
      const expectedAcceptExpiry = clean(booking.driver_accept_expires_at);
      updateQuery = updateQuery
        .eq("driver_accept_expires_at", expectedAcceptExpiry)
        .gt("driver_accept_expires_at", updatePayload.updated_at)
        .is("passenger_fare_response", null);
    }

    const { data: updatedRows, error: updateError } = await updateQuery
      .select("id,status")
      .limit(1);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        {
          status: updateError.message.includes("WINDOW_EXPIRED") ? 409 : 500,
        }
      );
    }

    if (!updatedRows?.[0]) {
      return NextResponse.json(
        { ok: false, error: "status_transition_lost_race" },
        { status: 409 }
      );
    }

    const automaticFareApplied =
      shortTripEvaluation?.outcome === "automatic" &&
      shortTripEvaluation.fare != null &&
      updatePayload.status === "ready";

    if (automaticFareApplied) {
      try {
        const lifecycleClient = adminClient ?? supabaseAdmin({ noStore: true });
        const lifecycleRes = await lifecycleClient.rpc(
          "record_booking_lifecycle_event",
          {
            p_booking_id: booking.id,
            p_booking_code: clean(booking.booking_code) || null,
            p_passenger_id: clean(booking.created_by_user_id) || null,
            p_driver_id: assignedDriverId || null,
            p_previous_driver_id: null,
            p_event_type: "fare_accepted",
            p_status_before: "assigned",
            p_status_after: "ready",
            p_town: clean(booking.town) || null,
            p_source: SHORT_TRIP_AUTOMATIC_FARE_VERSION,
            p_actor_type: "driver",
            p_actor_id: assignedDriverId || null,
            p_meta: {
              ...(shortTripEvaluation?.snapshot || {}),
              accepted_without_proposed_fare: true,
            },
          }
        );
        if (lifecycleRes.error) {
          console.warn(
            "[SHORT_TRIP_AUTOMATIC_FARE_LIFECYCLE_EVENT_FAILED]",
            JSON.stringify({
              booking_code: clean(booking.booking_code) || null,
              error: lifecycleRes.error.message,
            })
          );
        }
      } catch (lifecycleError: any) {
        console.warn(
          "[SHORT_TRIP_AUTOMATIC_FARE_LIFECYCLE_EVENT_EXCEPTION]",
          JSON.stringify({
            booking_code: clean(booking.booking_code) || null,
            error: String(lifecycleError?.message ?? lifecycleError),
          })
        );
      }
    }

    return NextResponse.json({
      ok: true,
      automatic_fare: automaticFareApplied,
      status: automaticFareApplied ? "ready" : nextStatus,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
