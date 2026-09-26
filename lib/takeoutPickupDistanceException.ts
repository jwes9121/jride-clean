import type { NextRequest } from "next/server";
import {
  markTakeoutDriverUnavailable,
  openTakeoutDriverUnavailableOperationsCase,
  reachedTakeoutUniqueDriverOfferLimit,
  recordTakeoutDriverUnavailableLifecycleEvent,
  triggerTakeoutFeeProposalReassign,
} from "@/lib/takeout-expiry-recovery";

const TAKEOUT_TEST_VENDOR_ID = "11111111-1111-1111-1111-111111111111";
const TAKEOUT_TEST_PASSENGER_ID = "a80e8043-6477-4ce0-96a7-06ef7007b541";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function isDedicatedTestOrder(order: any): boolean {
  return (
    text(order?.vendor_id) === TAKEOUT_TEST_VENDOR_ID &&
    text(order?.created_by_user_id) === TAKEOUT_TEST_PASSENGER_ID
  );
}

export type TakeoutPickupExceptionResult = {
  handled: boolean;
  released: boolean;
  reassigned: boolean;
  dispatchReviewRequired: boolean;
  bookingId: string | null;
  bookingCode: string | null;
  actualDistanceKm: number | null;
  cappedPickupFee: number | null;
  error: string | null;
};

export async function handleTakeoutPickupDistanceException(args: {
  req: NextRequest;
  serviceSupabase: any;
  order: any;
  driverId: string;
  pricingSnapshot: Record<string, unknown>;
  actualDistanceKm: number | null;
  cappedPickupFee: number | null;
  source: "automatic" | "manual";
}): Promise<TakeoutPickupExceptionResult> {
  const {
    req,
    serviceSupabase,
    order,
    driverId,
    pricingSnapshot,
    actualDistanceKm,
    cappedPickupFee,
    source,
  } = args;

  const bookingId = text(order?.id);
  const bookingCode = text(order?.booking_code) || null;
  const previousDriverId = text(order?.last_expired_driver_id) || null;

  const baseResult = {
    handled: true,
    released: false,
    reassigned: false,
    dispatchReviewRequired: false,
    bookingId: bookingId || null,
    bookingCode,
    actualDistanceKm,
    cappedPickupFee,
    error: null as string | null,
  };

  if (!bookingId || !driverId) {
    return {
      ...baseResult,
      handled: false,
      error: "MISSING_BOOKING_OR_DRIVER_ID",
    };
  }

  const nowIso = new Date().toISOString();
  const exceptionSnapshot = {
    ...(order?.takeout_pricing_snapshot &&
    typeof order.takeout_pricing_snapshot === "object"
      ? order.takeout_pricing_snapshot
      : {}),
    ...pricingSnapshot,
    outcome: "pickup_distance_exception",
    takeout_pickup_distance_exception_required: true,
    takeout_pickup_distance_exception_source: source,
    takeout_pickup_distance_exception_driver_id: driverId,
    takeout_pickup_distance_exception_at: nowIso,
    takeout_pickup_distance_exception_status: "reassignment_requested",
    takeout_pickup_distance_km:
      actualDistanceKm == null ? null : actualDistanceKm,
    takeout_pickup_excess_fee:
      cappedPickupFee == null ? null : cappedPickupFee,
    pickup_distance_fee:
      cappedPickupFee == null ? null : cappedPickupFee,
  };

  const releaseRes = await serviceSupabase
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
      takeout_auto_dispatch_exhausted: false,
      takeout_auto_dispatch_exhausted_at: null,
      last_expired_driver_id: driverId,
      takeout_pricing_snapshot: exceptionSnapshot,
      updated_at: nowIso,
      // takeout_route_plan intentionally preserved.
    })
    .eq("id", bookingId)
    .eq("service_type", "takeout")
    .in("status", ["assigned", "accepted"])
    .eq("assigned_driver_id", driverId)
    .is("takeout_customer_confirmed_at", null)
    .is("takeout_fee_proposed_at", null)
    .is("takeout_delivery_fee", null)
    .select("id,booking_code,town")
    .limit(1);

  if (releaseRes.error) {
    return {
      ...baseResult,
      error: releaseRes.error.message,
    };
  }

  if (!Array.isArray(releaseRes.data) || releaseRes.data.length === 0) {
    return {
      ...baseResult,
      error: "TAKEOUT_STEP_CHANGED",
    };
  }

  const releasedRow = releaseRes.data[0] as any;
  const released = true;
  const uniqueLimitReached =
    order?.takeout_auto_dispatch_exhausted === true ||
    reachedTakeoutUniqueDriverOfferLimit(previousDriverId, driverId);
  const testOrder = isDedicatedTestOrder(order);

  if (!uniqueLimitReached && !testOrder) {
    const reassign = await triggerTakeoutFeeProposalReassign(
      req,
      bookingId,
      driverId,
      "pickup_distance_over_10km"
    );

    if (reassign.payload?.assigned === true) {
      return {
        ...baseResult,
        released,
        reassigned: true,
      };
    }
  }

  const unavailable = await markTakeoutDriverUnavailable(serviceSupabase, {
    bookingId,
    bookingCode,
    expiredDriverId: driverId,
  });

  const operations = await openTakeoutDriverUnavailableOperationsCase(
    serviceSupabase,
    { bookingId }
  );

  await recordTakeoutDriverUnavailableLifecycleEvent(serviceSupabase, {
    bookingId,
    bookingCode,
    expiredDriverId: driverId,
    previousExpiredDriverId: previousDriverId,
    townRaw: text(releasedRow?.town) || text(order?.town) || null,
    reason: testOrder
      ? "pickup_distance_over_10km_test_order_dispatch_review"
      : uniqueLimitReached
        ? "pickup_distance_over_10km_unique_driver_limit"
        : "pickup_distance_over_10km_no_reassignment",
    operationsAlerted: operations.opened || operations.error == null,
  });

  return {
    ...baseResult,
    released,
    dispatchReviewRequired: unavailable.didMark || operations.opened,
    error: unavailable.error || operations.error,
  };
}
