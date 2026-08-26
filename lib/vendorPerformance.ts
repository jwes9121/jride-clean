import { vendorTimeoutDisplay } from "@/lib/vendorTimeoutDisplay";

export type VendorPerformanceBooking = Record<string, any>;

export type VendorDecision = "accepted" | "unaccepted" | "pending";

export const PUBLIC_ACCEPTANCE_MIN_DECISIONS = 10;
export const PUBLIC_RATING_MIN_RESPONSES = 5;
export const PUBLIC_RECENT_DECISION_LIMIT = 20;
export const PUBLIC_RECENT_RATING_LIMIT = 20;

export function cleanVendorMetricText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeVendorMetricStatus(value: unknown): string {
  const normalized = cleanVendorMetricText(value)
    .toLowerCase()
    .replace(/\s+/g, "_");

  if (normalized === "canceled") return "cancelled";
  if (normalized === "accepted") return "vendor_accepted";
  if (!normalized || normalized === "requested") return "vendor_pending";
  return normalized;
}

export function vendorCancellationReason(row: VendorPerformanceBooking): string {
  return cleanVendorMetricText(
    row?.vendor_cancel_reason || row?.cancel_reason || ""
  );
}

export function isVendorTimeoutDecision(
  row: VendorPerformanceBooking
): boolean {
  const status = normalizeVendorMetricStatus(row?.vendor_status);
  const reason = vendorCancellationReason(row).toLowerCase();

  return Boolean(
    cleanVendorMetricText(row?.vendor_timeout_at) ||
      status === "vendor_timeout" ||
      reason.includes("did not respond within") ||
      reason.includes("vendor timeout")
  );
}

export function isVendorAcceptedDecision(
  row: VendorPerformanceBooking
): boolean {
  if (cleanVendorMetricText(row?.vendor_accepted_at)) return true;

  const status = normalizeVendorMetricStatus(row?.vendor_status);
  return [
    "vendor_accepted",
    "driver_assigned",
    "driver_accepted",
    "preparing",
    "pickup_ready",
    "rider_arrived_vendor",
    "arrived_vendor",
    "picked_up",
    "delivering",
    "completed",
  ].includes(status);
}

export function vendorDecision(row: VendorPerformanceBooking): VendorDecision {
  if (isVendorAcceptedDecision(row)) return "accepted";

  const status = normalizeVendorMetricStatus(row?.vendor_status);
  if (
    isVendorTimeoutDecision(row) ||
    cleanVendorMetricText(row?.vendor_rejected_at) ||
    status === "cancelled"
  ) {
    return "unaccepted";
  }

  return "pending";
}

export function isCompletedTakeoutOrder(
  row: VendorPerformanceBooking
): boolean {
  return [
    normalizeVendorMetricStatus(row?.vendor_status),
    normalizeVendorMetricStatus(row?.customer_status),
    normalizeVendorMetricStatus(row?.status),
  ].includes("completed");
}

export function vendorDecisionTimestamp(
  row: VendorPerformanceBooking
): number {
  if (isVendorTimeoutDecision(row)) {
    const display = vendorTimeoutDisplay(row);
    const timeoutValue = new Date(String(display.displayed_at || "")).getTime();
    if (Number.isFinite(timeoutValue)) return timeoutValue;
  }

  const raw =
    row?.vendor_responded_at ||
    row?.vendor_accepted_at ||
    row?.vendor_rejected_at ||
    row?.updated_at ||
    row?.created_at ||
    "";
  const value = new Date(String(raw)).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function bookingCreatedTimestamp(
  row: VendorPerformanceBooking
): number {
  const value = new Date(String(row?.created_at || "")).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function vendorResponseSeconds(
  row: VendorPerformanceBooking
): number | null {
  const created = bookingCreatedTimestamp(row);
  const responded = vendorDecisionTimestamp(row);
  if (!created || !responded || responded < created) return null;
  return Math.round((responded - created) / 1000);
}

export function clampVendorRating(value: unknown): number | null {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;
  return rating;
}

export function computePublicVendorPerformance(
  bookings: VendorPerformanceBooking[],
  ratings: Array<Record<string, any>>
) {
  const decisions = bookings
    .filter((row) => vendorDecision(row) !== "pending")
    .sort((a, b) => vendorDecisionTimestamp(b) - vendorDecisionTimestamp(a))
    .slice(0, PUBLIC_RECENT_DECISION_LIMIT);

  const accepted = decisions.filter(
    (row) => vendorDecision(row) === "accepted"
  ).length;
  const unaccepted = decisions.length - accepted;
  const acceptanceReady = decisions.length >= PUBLIC_ACCEPTANCE_MIN_DECISIONS;
  const acceptanceRate = acceptanceReady
    ? Math.round((accepted / decisions.length) * 100)
    : null;

  const recentRatings = ratings
    .map((row) => ({
      ...row,
      _rating: clampVendorRating(row?.vendor_rating),
      _created: new Date(String(row?.created_at || "")).getTime() || 0,
    }))
    .filter((row) => row._rating !== null)
    .sort((a, b) => b._created - a._created)
    .slice(0, PUBLIC_RECENT_RATING_LIMIT);

  const ratingReady = recentRatings.length >= PUBLIC_RATING_MIN_RESPONSES;
  const ratingAverage = ratingReady
    ? Math.round(
        (recentRatings.reduce(
          (sum, row) => sum + Number(row._rating || 0),
          0
        ) /
          recentRatings.length) *
          10
      ) / 10
    : null;

  let publicText = "New on JRide | Performance tracking active";
  if (acceptanceRate !== null && ratingAverage !== null) {
    publicText =
      "Recent acceptance " +
      acceptanceRate +
      "% | Customer rating " +
      ratingAverage.toFixed(1) +
      "/5";
  } else if (acceptanceRate !== null) {
    publicText =
      "Recent acceptance " +
      acceptanceRate +
      "% | Customer feedback building";
  } else if (ratingAverage !== null) {
    publicText =
      "Performance tracking active | Customer rating " +
      ratingAverage.toFixed(1) +
      "/5";
  }

  return {
    acceptance_ready: acceptanceReady,
    public_acceptance_rate: acceptanceRate,
    rating_ready: ratingReady,
    public_customer_rating: ratingAverage,
    public_performance_text: publicText,
    internal_recent_decisions: decisions.length,
    internal_recent_accepted: accepted,
    internal_recent_unaccepted: unaccepted,
    internal_recent_ratings: recentRatings.length,
  };
}
