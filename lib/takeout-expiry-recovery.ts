import type { NextRequest } from "next/server";

export type TakeoutFeeProposalResetResult = {
  didReset: boolean;
  bookingId: string | null;
  bookingCode: string | null;
  error: string | null;
};

// Handles only the expired fee-proposal window after a driver accepted.
// It intentionally does not depend on vendor_status, customer_status,
// driver_status, or takeout_pricing_status because those fields can remain
// stale when a takeout acceptance passes through the generic status route.
export async function resetExpiredTakeoutFeeProposal(
  serviceSupabase: any,
  params: {
    bookingId?: string | null;
    bookingCode?: string | null;
    expiredDriverId: string;
  }
): Promise<TakeoutFeeProposalResetResult> {
  const bookingId = String(params.bookingId || "").trim() || null;
  const bookingCode = String(params.bookingCode || "").trim() || null;
  const expiredDriverId = String(params.expiredDriverId || "").trim();

  if ((!bookingId && !bookingCode) || !expiredDriverId) {
    return {
      didReset: false,
      bookingId,
      bookingCode,
      error: "MISSING_BOOKING_OR_DRIVER_ID",
    };
  }

  const nowIso = new Date().toISOString();

  let resetQuery = serviceSupabase
    .from("bookings")
    .update({
      status: "searching",
      vendor_status: "vendor_accepted",
      customer_status: "vendor_accepted",
      driver_status: null,
      driver_id: null,
      assigned_driver_id: null,
      assigned_at: null,
      driver_accept_expires_at: null,
      takeout_driver_accept_expires_at: null,
      takeout_fee_proposal_expires_at: null,
      driver_fee_proposal_expires_at: null,
      takeout_pricing_status: null,
      takeout_delivery_fee: null,
      takeout_service_fee: null,
      takeout_total_payable: null,
      takeout_cash_collection_required: null,
      takeout_fee_proposed_by_driver_id: null,
      takeout_fee_proposed_at: null,
      takeout_fee_expires_at: null,
      takeout_customer_confirmed_at: null,
      last_expired_driver_id: expiredDriverId,
      updated_at: nowIso,
      // takeout_route_plan intentionally preserved.
    })
    .eq("service_type", "takeout")
    .in("status", ["assigned", "accepted"])
    .eq("assigned_driver_id", expiredDriverId)
    .is("takeout_customer_confirmed_at", null)
    .is("takeout_fee_proposed_at", null)
    .is("takeout_delivery_fee", null)
    .lte("driver_fee_proposal_expires_at", nowIso);

  resetQuery = bookingCode
    ? resetQuery.eq("booking_code", bookingCode)
    : resetQuery.eq("id", bookingId as string);

  const resetRes = await resetQuery.select("id,booking_code").limit(1);

  if (resetRes.error) {
    return {
      didReset: false,
      bookingId,
      bookingCode,
      error: resetRes.error.message,
    };
  }

  if (!Array.isArray(resetRes.data) || resetRes.data.length === 0) {
    return { didReset: false, bookingId, bookingCode, error: null };
  }

  const row = resetRes.data[0] as any;
  return {
    didReset: true,
    bookingId: String(row?.id || bookingId || "") || null,
    bookingCode: String(row?.booking_code || bookingCode || "") || null,
    error: null,
  };
}

export type TakeoutReassignResult = {
  attempted: boolean;
  status: number | null;
  payload: any;
};

// mode="single" requires body.bookingId in the current auto-assign route.
export async function triggerTakeoutFeeProposalReassign(
  req: NextRequest,
  bookingId: string,
  expiredDriverId: string,
  reason: string
): Promise<TakeoutReassignResult> {
  if (!bookingId) {
    return { attempted: false, status: null, payload: null };
  }

  try {
    const assignRes = await fetch(
      new URL("/api/dispatch/auto-assign", req.nextUrl.origin),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "single",
          bookingId,
          exclude_driver_ids: [expiredDriverId],
          autoReassignReason: reason,
        }),
        cache: "no-store",
      }
    );

    const payload = await assignRes.json().catch(() => null);
    return { attempted: true, status: assignRes.status, payload };
  } catch (err: any) {
    return {
      attempted: true,
      status: null,
      payload: { ok: false, error: String(err?.message || err) },
    };
  }
}

export async function recordTakeoutExpiryLifecycleEvent(
  serviceSupabase: any,
  params: {
    bookingId: string;
    bookingCode: string | null;
    expiredDriverId: string;
    townRaw: string | null;
    reason: string;
    reassignmentAttempted: boolean;
    reassignmentSuccess: boolean;
    dispatchStatus: number | null;
    statusBefore: string;
  }
) {
  const lifecycleRes = await serviceSupabase.rpc(
    "record_booking_lifecycle_event",
    {
      p_booking_id: params.bookingId,
      p_booking_code: params.bookingCode,
      p_passenger_id: null,
      p_driver_id: params.expiredDriverId,
      p_previous_driver_id: params.expiredDriverId,
      p_event_type: "assignment_expired",
      p_status_before: params.statusBefore,
      p_status_after: "searching",
      p_town: params.townRaw,
      p_source: "system",
      p_actor_type: "system",
      p_actor_id: null,
      p_meta: {
        reason: params.reason,
        expiry_type: "fare_proposal_window",
        reassignment_attempted: params.reassignmentAttempted,
        reassignment_success: params.reassignmentSuccess,
        dispatch_status: params.dispatchStatus,
      },
    }
  );

  if (lifecycleRes.error) {
    console.error(
      "[JRIDE_TAKEOUT_LIFECYCLE_EVENT_INSERT_FAILED]",
      JSON.stringify({
        bookingCode: params.bookingCode,
        driverId: params.expiredDriverId,
        error: lifecycleRes.error.message,
      })
    );
  }
}

export function logTakeoutFeeProposalExpired(entry: {
  bookingCode: string | null;
  expiredDriverId: string;
  expiredAt: string | null;
  reset: boolean;
  reassigned: boolean;
  newDriverId: null;
  dispatchPayload: any;
  reason: string;
}) {
  console.log(
    "[JRIDE_TAKEOUT_FEE_PROPOSAL_EXPIRED]",
    JSON.stringify(entry)
  );
}