// app/api/driver/advance-bookings/take/route.ts
//
// Stage 1 of the Advance Booking driver lifecycle: atomic temporary claim.
//
// This route grants one driver exclusive fare-preparation rights for one booking.
// It does NOT calculate fare and does NOT finalize commitment.
// Both of those belong in Stage 2 (fare submission -- not yet implemented).
//
// The actual atomicity guarantees are inside the database RPC
// claim_advance_booking_offer(), which uses:
//   - pg_advisory_xact_lock() to serialize concurrent claims
//   - FOR UPDATE on both the queue row and the booking row
//   - nine sequential checks before writing any rows
//
// Successful response includes farePreparationExpiresAt so Android
// can open the departure-selection + fare-review screen with a countdown.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  resolveAuthenticatedDriver,
  noStoreHeaders,
} from "@/lib/advance-booking/driverAuth";
import { FARE_PREPARATION_TIMEOUT_SECONDS } from "@/lib/advance-booking/constants";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, message: auth.message },
      { status: auth.status, headers: noStoreHeaders() }
    );
  }

  const body = await req.json().catch(() => ({}));
  const offerId = String(body?.offerId ?? "").trim();

  if (!offerId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_OFFER_ID" },
      { status: 400, headers: noStoreHeaders() }
    );
  }

  // commitmentConfirmed is no longer used in Stage 1.
  // It will be accepted (but ignored) until the Android app is updated
  // to remove it from the TAKE payload in a later commit.

  const { data, error } = await supabaseAdmin().rpc(
    "claim_advance_booking_offer",
    {
      p_queue_entry_id:          offerId,
      p_driver_id:               auth.driverId,
      p_fare_preparation_seconds: FARE_PREPARATION_TIMEOUT_SECONDS,
    }
  );

  if (error) {
    // RPC infrastructure failure (network, permission, function not found)
    console.error("[advance-booking:take:rpc]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "RPC_FAILED",
        message: error.message,
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  // The RPC returns a JSONB object with ok: true | false.
  // Non-200 status codes inside the RPC are expressed as ok: false + error string.
  const result = data as {
    ok: boolean;
    error?: string;
    message?: string;
    bookingStatus?: string;
    currentStatus?: string;
    queueEntryId?: string;
    advanceBookingId?: string;
    farePreparationExpiresAt?: string;
  };

  if (!result.ok) {
    const httpStatus =
      result.error === "OFFER_NOT_FOUND" ||
      result.error === "BOOKING_NOT_FOUND"
        ? 404
        : result.error === "OFFER_EXPIRED" ||
          result.error === "OFFER_NOT_AVAILABLE"
        ? 410
        : result.error === "ALREADY_CLAIMED" ||
          result.error === "BOOKING_NOT_CLAIMABLE"
        ? 409
        : result.error === "INTERNAL_ERROR"
        ? 500
        : 400;

    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status: httpStatus, headers: noStoreHeaders() }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      advanceBookingId:         result.advanceBookingId,
      farePreparationExpiresAt: result.farePreparationExpiresAt,
      // farePreparationExpiresAt is returned so Android can:
      //   1. Open the departure-selection screen.
      //   2. Show a 10-minute countdown.
      //   3. POST to the fare-submission endpoint before this deadline.
    },
    { headers: noStoreHeaders() }
  );
}
