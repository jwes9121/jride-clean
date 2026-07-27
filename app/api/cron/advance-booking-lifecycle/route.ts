import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { offerAdvanceBooking } from "@/lib/advance-booking/offer";
import type { VehicleType } from "@/lib/advance-booking/types";

export const dynamic = "force-dynamic";

function noStore() {
  return { "Cache-Control": "no-store, no-cache", Pragma: "no-cache" };
}

type LifecyclePhase = "passenger_timeout" | "booking_cutoff";

type LifecycleError = {
  id: string;
  phase: LifecyclePhase;
  error: string;
};

type PassengerTimeoutRpcResult = {
  ok?: boolean;
  released?: boolean;
  error?: string;
  message?: string;
  reason?: string;
  expiredDriverId?: string;
  pickupLat?: number;
  pickupLng?: number;
  pickupTown?: string;
  vehicleType?: string;
  scheduledPickupAt?: string;
  rerequestOffer?: boolean;
};

type CutoffRpcResult = {
  ok?: boolean;
  cancelled?: boolean;
  error?: string;
  message?: string;
  reason?: string;
  previousStatus?: string;
  cancelledStatus?: string;
  releasedQueueCount?: number;
};

// Vercel automatically sends Authorization: Bearer <CRON_SECRET> when
// invoking a scheduled route, per Vercel's documented cron-security
// pattern (https://vercel.com/docs/cron-jobs/manage-cron-jobs). Missing
// or unset CRON_SECRET fails closed (never authorizes) rather than
// skipping the check.
function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const authHeader = req.headers.get("authorization") || "";
  return authHeader === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401, headers: noStore() }
    );
  }

  const supabase = supabaseAdmin();
  const nowIso = new Date().toISOString();

  console.log("[advance-booking-lifecycle] cron started", {
    generatedAt: nowIso,
  });

  const errors: LifecycleError[] = [];
  let releasedPassengerTimeouts = 0;
  let reoffersTriggered = 0;
  let cancelledNoDriver = 0;

  // ---------------------------------------------------------------
  // Phase 1 - passenger response timeout.
  // Mirrors release_expired_advance_booking_passenger_response()'s own
  // guard conditions (status='fare_proposed', response window expired,
  // booking cutoff not yet reached) - the RPC re-validates all of this
  // under lock regardless, this SELECT just avoids calling the RPC for
  // bookings that obviously aren't eligible.
  // ---------------------------------------------------------------
  const { data: passengerTimeoutRows, error: passengerTimeoutScanError } =
    await supabase
      .from("advance_bookings")
      .select("id")
      .eq("status", "fare_proposed")
      .not("passenger_response_expires_at", "is", null)
      .lte("passenger_response_expires_at", nowIso)
      .gt("booking_expires_at", nowIso);

  if (passengerTimeoutScanError) {
    return NextResponse.json(
      {
        ok: false,
        error: "PASSENGER_TIMEOUT_SCAN_FAILED",
        message: passengerTimeoutScanError.message,
      },
      { status: 500, headers: noStore() }
    );
  }

  for (const row of passengerTimeoutRows ?? []) {
    const advanceBookingId = String((row as any).id);

    try {
      const { data: releaseData, error: releaseError } = await supabase.rpc(
        "release_expired_advance_booking_passenger_response",
        { p_advance_booking_id: advanceBookingId }
      );

      if (releaseError) {
        errors.push({
          id: advanceBookingId,
          phase: "passenger_timeout",
          error: releaseError.message,
        });
        continue;
      }

      const result = releaseData as PassengerTimeoutRpcResult | null;

      if (!result?.ok) {
        errors.push({
          id: advanceBookingId,
          phase: "passenger_timeout",
          error: result?.message || result?.error || "Unknown release failure.",
        });
        continue;
      }

      // released=false is a legitimate non-error outcome (e.g. another
      // process already handled it, or it's no longer eligible) - not
      // pushed to errors[].
      if (!result.released) continue;

      releasedPassengerTimeouts += 1;

      if (
        result.rerequestOffer &&
        result.pickupLat != null &&
        result.pickupLng != null &&
        result.pickupTown &&
        result.vehicleType &&
        result.scheduledPickupAt
      ) {
        const reoffer = await offerAdvanceBooking({
          advanceBookingId,
          pickupLat: Number(result.pickupLat),
          pickupLng: Number(result.pickupLng),
          pickupTown: String(result.pickupTown),
          vehicleType: result.vehicleType as VehicleType,
          scheduledPickupAt: new Date(result.scheduledPickupAt),
          excludedDriverIds: result.expiredDriverId
            ? [String(result.expiredDriverId)]
            : [],
        });

        if (!reoffer.ok) {
          errors.push({
            id: advanceBookingId,
            phase: "passenger_timeout",
            error: reoffer.error,
          });
        } else {
          reoffersTriggered += 1;
          console.log(
            "[advance-booking-lifecycle] re-offer after passenger timeout",
            {
              advanceBookingId,
              expiredDriverId: result.expiredDriverId ?? null,
              offersCreated: reoffer.offersCreated,
            }
          );
        }
      }
    } catch (e: any) {
      errors.push({
        id: advanceBookingId,
        phase: "passenger_timeout",
        error: String(e?.message ?? e),
      });
    }
  }

  // ---------------------------------------------------------------
  // Phase 2 - booking cutoff, no committed driver.
  // ---------------------------------------------------------------
  const { data: cutoffRows, error: cutoffScanError } = await supabase
    .from("advance_bookings")
    .select("id")
    .in("status", ["open", "fare_proposed", "dispatcher_intervention"])
    .not("booking_expires_at", "is", null)
    .lte("booking_expires_at", nowIso)
    .is("committed_driver_id", null);

  if (cutoffScanError) {
    return NextResponse.json(
      {
        ok: false,
        error: "BOOKING_CUTOFF_SCAN_FAILED",
        message: cutoffScanError.message,
        passengerTimeoutCandidates: (passengerTimeoutRows ?? []).length,
        releasedPassengerTimeouts,
        reoffersTriggered,
        cancelledNoDriver,
        errors,
      },
      { status: 500, headers: noStore() }
    );
  }

  for (const row of cutoffRows ?? []) {
    const advanceBookingId = String((row as any).id);

    try {
      const { data: cancelData, error: cancelError } = await supabase.rpc(
        "cancel_expired_advance_booking_no_driver",
        { p_advance_booking_id: advanceBookingId }
      );

      if (cancelError) {
        errors.push({
          id: advanceBookingId,
          phase: "booking_cutoff",
          error: cancelError.message,
        });
        continue;
      }

      const result = cancelData as CutoffRpcResult | null;

      if (!result?.ok) {
        errors.push({
          id: advanceBookingId,
          phase: "booking_cutoff",
          error: result?.message || result?.error || "Unknown cancellation failure.",
        });
        continue;
      }

      if (result.cancelled) {
        cancelledNoDriver += 1;
      }
    } catch (e: any) {
      errors.push({
        id: advanceBookingId,
        phase: "booking_cutoff",
        error: String(e?.message ?? e),
      });
    }
  }

  console.log("[advance-booking-lifecycle] cron completed", {
    generatedAt: nowIso,
    passengerTimeoutCandidates: (passengerTimeoutRows ?? []).length,
    releasedPassengerTimeouts,
    reoffersTriggered,
    bookingCutoffCandidates: (cutoffRows ?? []).length,
    cancelledNoDriver,
    errors: errors.length,
  });

  return NextResponse.json(
    {
      ok: true,
      generatedAt: nowIso,
      passengerTimeoutCandidates: (passengerTimeoutRows ?? []).length,
      releasedPassengerTimeouts,
      reoffersTriggered,
      bookingCutoffCandidates: (cutoffRows ?? []).length,
      cancelledNoDriver,
      errors,
    },
    { status: 200, headers: noStore() }
  );
}
