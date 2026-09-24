export const TAKEOUT_DRIVER_FEE_TIMEOUT_REASON = "driver_fee_proposal_timeout";
export const TAKEOUT_DRIVER_FEE_TIMEOUT_MESSAGE =
  "Booking cancelled because the driver did not submit a delivery fee within 5 minutes. Please book again.";

export type TakeoutDriverFeeTimeoutResult = {
  didCancel: boolean;
  bookingId: string | null;
  bookingCode: string | null;
  error: string | null;
};

// Only the accepted driver and the exact expired submission window observed by
// the cron can be cancelled. A newer assignment or an actual fare proposal wins
// the race and leaves no row to update.
export async function cancelExpiredTakeoutDriverFeeProposal(
  serviceSupabase: any,
  params: {
    bookingId: string;
    bookingCode: string | null;
    expiredDriverId: string;
    expectedDriverFeeProposalExpiresAt: string;
  }
): Promise<TakeoutDriverFeeTimeoutResult> {
  const bookingId = String(params.bookingId || "").trim();
  const bookingCode = String(params.bookingCode || "").trim() || null;
  const expiredDriverId = String(params.expiredDriverId || "").trim();
  const expectedExpiresAt = String(
    params.expectedDriverFeeProposalExpiresAt || ""
  ).trim();
  if (!bookingId || !expiredDriverId || !expectedExpiresAt) {
    return {
      didCancel: false,
      bookingId: bookingId || null,
      bookingCode,
      error: "MISSING_BOOKING_DRIVER_OR_DEADLINE",
    };
  }

  const nowIso = new Date().toISOString();
  const result = await serviceSupabase
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
      cancel_reason: TAKEOUT_DRIVER_FEE_TIMEOUT_MESSAGE,
      last_expired_driver_id: expiredDriverId,
      updated_at: nowIso,
      // Keep the original submission deadline for audit.
    })
    .eq("id", bookingId)
    .eq("service_type", "takeout")
    .in("status", ["assigned", "accepted"])
    .eq("assigned_driver_id", expiredDriverId)
    .eq("takeout_pricing_status", "pricing_pending")
    .is("takeout_customer_confirmed_at", null)
    .is("takeout_fee_proposed_at", null)
    .is("takeout_fee_expires_at", null)
    .is("takeout_delivery_fee", null)
    .eq("driver_fee_proposal_expires_at", expectedExpiresAt)
    .lte("driver_fee_proposal_expires_at", nowIso)
    .select("id,booking_code")
    .limit(1);

  if (result.error) {
    return {
      didCancel: false,
      bookingId,
      bookingCode,
      error: result.error.message,
    };
  }
  if (!result.data?.length) {
    return { didCancel: false, bookingId, bookingCode, error: null };
  }
  return {
    didCancel: true,
    bookingId,
    bookingCode: String(result.data[0].booking_code || bookingCode || "") || null,
    error: null,
  };
}

export async function notifyTakeoutDriverFeeTimeout(
  serviceSupabase: any,
  params: { expiredDriverId: string; bookingCode: string | null }
): Promise<{ sent: boolean; error: string | null }> {
  const expiredDriverId = String(params.expiredDriverId || "").trim();
  if (!expiredDriverId) return { sent: false, error: "MISSING_DRIVER_ID" };
  const label = params.bookingCode ? ` ${params.bookingCode}` : "";
  const result = await serviceSupabase.from("driver_notifications").insert({
    driver_id: expiredDriverId,
    type: "takeout_fee_proposal_timeout",
    message:
      `Takeout booking${label} was cancelled because you did not submit a delivery fee ` +
      "within 5 minutes after accepting it. You may accept another booking.",
  });
  return {
    sent: !result.error,
    error: result.error?.message || null,
  };
}

export async function recordTakeoutDriverFeeTimeoutLifecycleEvent(
  serviceSupabase: any,
  params: {
    bookingId: string;
    bookingCode: string | null;
    passengerId: string | null;
    expiredDriverId: string;
    townRaw: string | null;
    statusBefore: string;
    expiresAt: string;
  }
) {
  const result = await serviceSupabase.rpc("record_booking_lifecycle_event", {
    p_booking_id: params.bookingId,
    p_booking_code: params.bookingCode,
    p_passenger_id: params.passengerId,
    p_driver_id: params.expiredDriverId,
    p_previous_driver_id: null,
    p_event_type: "assignment_expired",
    p_status_before: params.statusBefore,
    p_status_after: "cancelled",
    p_town: params.townRaw,
    p_source: "system_cron",
    p_actor_type: "system",
    p_actor_id: null,
    p_meta: {
      reason: TAKEOUT_DRIVER_FEE_TIMEOUT_REASON,
      expires_at: params.expiresAt,
      timeout_owner: "driver",
      reassign: false,
    },
  });
  if (result.error) {
    console.error(
      "[JRIDE_TAKEOUT_DRIVER_FEE_TIMEOUT_LIFECYCLE_FAILED]",
      JSON.stringify({
        bookingCode: params.bookingCode,
        driverId: params.expiredDriverId,
        error: result.error.message,
      })
    );
  }
}
