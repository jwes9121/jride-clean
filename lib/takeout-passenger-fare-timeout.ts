export const TAKEOUT_PASSENGER_FARE_CONFIRMATION_TIMEOUT_REASON =
  "passenger_fare_confirmation_timeout";

export type TakeoutPassengerFareTimeoutCancelResult = {
  didCancel: boolean;
  bookingId: string | null;
  bookingCode: string | null;
  error: string | null;
};

// Cancels only an expired, unconfirmed TakeOut fee proposal.
// Proposal amounts/timestamps are intentionally preserved for audit.
export async function cancelExpiredTakeoutPassengerFareConfirmation(
  serviceSupabase: any,
  params: {
    bookingId?: string | null;
    bookingCode?: string | null;
    expiredDriverId: string;
  }
): Promise<TakeoutPassengerFareTimeoutCancelResult> {
  const bookingId = String(params.bookingId || "").trim() || null;
  const bookingCode = String(params.bookingCode || "").trim() || null;
  const expiredDriverId = String(params.expiredDriverId || "").trim();

  if ((!bookingId && !bookingCode) || !expiredDriverId) {
    return {
      didCancel: false,
      bookingId,
      bookingCode,
      error: "MISSING_BOOKING_OR_DRIVER_ID",
    };
  }

  const nowIso = new Date().toISOString();

  let cancelQuery = serviceSupabase
    .from("bookings")
    .update({
      status: "cancelled",
      vendor_status: "cancelled",
      customer_status: "cancelled",
      driver_status: "cancelled",
      driver_id: null,
      assigned_driver_id: null,
      assigned_at: null,
      driver_accept_expires_at: null,
      takeout_driver_accept_expires_at: null,
      takeout_pricing_status: "expired",
      cancel_reason: TAKEOUT_PASSENGER_FARE_CONFIRMATION_TIMEOUT_REASON,
      last_expired_driver_id: expiredDriverId,
      updated_at: nowIso,
      // Preserve the fee proposal, its owner, and both proposal deadlines.
      // The terminal booking status prevents the expired quote from being reused.
    })
    .eq("service_type", "takeout")
    .in("status", ["assigned", "accepted"])
    .eq("assigned_driver_id", expiredDriverId)
    .is("takeout_customer_confirmed_at", null)
    .not("takeout_fee_proposed_at", "is", null)
    .not("takeout_delivery_fee", "is", null)
    .not("takeout_fee_expires_at", "is", null)
    .lte("takeout_fee_expires_at", nowIso)
    .not("driver_fee_proposal_expires_at", "is", null)
    .lte("driver_fee_proposal_expires_at", nowIso);

  cancelQuery = bookingCode
    ? cancelQuery.eq("booking_code", bookingCode)
    : cancelQuery.eq("id", bookingId as string);

  const cancelRes = await cancelQuery.select("id,booking_code").limit(1);

  if (cancelRes.error) {
    return {
      didCancel: false,
      bookingId,
      bookingCode,
      error: cancelRes.error.message,
    };
  }

  if (!Array.isArray(cancelRes.data) || cancelRes.data.length === 0) {
    return { didCancel: false, bookingId, bookingCode, error: null };
  }

  const row = cancelRes.data[0] as any;
  return {
    didCancel: true,
    bookingId: String(row?.id || bookingId || "") || null,
    bookingCode: String(row?.booking_code || bookingCode || "") || null,
    error: null,
  };
}

export async function recordTakeoutPassengerFareTimeoutLifecycleEvent(
  serviceSupabase: any,
  params: {
    bookingId: string;
    bookingCode: string | null;
    passengerId: string | null;
    expiredDriverId: string;
    townRaw: string | null;
    statusBefore: string;
    expiresAt: string | null;
  }
) {
  const lifecycleRes = await serviceSupabase.rpc(
    "record_booking_lifecycle_event",
    {
      p_booking_id: params.bookingId,
      p_booking_code: params.bookingCode,
      p_passenger_id: params.passengerId,
      p_driver_id: params.expiredDriverId,
      p_previous_driver_id: null,
      p_event_type: "fare_response_expired",
      p_status_before: params.statusBefore,
      p_status_after: "cancelled",
      p_town: params.townRaw,
      p_source: "system_cron",
      p_actor_type: "system",
      p_actor_id: null,
      p_meta: {
        reason: TAKEOUT_PASSENGER_FARE_CONFIRMATION_TIMEOUT_REASON,
        expires_at: params.expiresAt,
        timeout_owner: "passenger",
        driver_penalty: false,
        reassign: false,
      },
    }
  );

  if (lifecycleRes.error) {
    console.error(
      "[JRIDE_TAKEOUT_PASSENGER_FARE_TIMEOUT_LIFECYCLE_FAILED]",
      JSON.stringify({
        bookingCode: params.bookingCode,
        driverId: params.expiredDriverId,
        error: lifecycleRes.error.message,
      })
    );
  }
}

export function logTakeoutPassengerFareConfirmationTimeout(entry: {
  bookingCode: string | null;
  expiredDriverId: string;
  expiredAt: string | null;
  cancelled: boolean;
  reason: string;
}) {
  console.log(
    "[JRIDE_TAKEOUT_PASSENGER_FARE_CONFIRMATION_TIMEOUT]",
    JSON.stringify(entry)
  );
}
