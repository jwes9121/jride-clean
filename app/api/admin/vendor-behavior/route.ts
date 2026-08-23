import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  classifyVendorDecision,
  elapsedMetricUnits,
  isInVendorMetricPeriod,
  isTakeoutCompleted,
  metricStatus,
  metricTime,
  roundMetric,
  type VendorMetricPeriod,
  vendorCancellationReason,
  vendorResponseAt,
  vendorResponseSeconds,
} from "@/lib/vendorPerformance";
import {
  activeMetricExclusions,
  createVendorMetricsAdmin,
  loadVendorPerformanceSources,
  metricBookingIsExcluded,
} from "@/lib/vendorPerformanceServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function periodFromRequest(req: NextRequest): VendorMetricPeriod {
  const raw = text(req.nextUrl.searchParams.get("period")).toLowerCase();
  if (raw === "week" || raw === "month" || raw === "all") return raw;
  return "today";
}

function isClosedWithoutPending(row: any): boolean {
  const statuses = [row?.status, row?.vendor_status, row?.customer_status].map(metricStatus);
  return statuses.some((status) => ["completed", "cancelled", "canceled", "vendor_timeout"].includes(status));
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function GET(req: NextRequest) {
  const session = await auth().catch(() => null as any);
  const role = text((session as any)?.user?.role).toLowerCase();

  if (role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "ADMIN_REQUIRED", message: "Admin access is required." },
      { status: 403 }
    );
  }

  try {
    const period = periodFromRequest(req);
    const now = new Date();
    const admin = createVendorMetricsAdmin();
    const sources = await loadVendorPerformanceSources(admin, { includePresence: true });
    const exclusions = activeMetricExclusions(sources);

    const settingByVendor = new Map<string, any>();
    for (const row of sources.settings) {
      const vendorId = text(row?.vendor_id);
      if (vendorId) settingByVendor.set(vendorId, row);
    }

    const presenceByVendor = new Map<string, any>();
    for (const row of sources.presenceCurrent) {
      const vendorId = text(row?.vendor_id);
      if (vendorId) presenceByVendor.set(vendorId, row);
    }

    const bucketsByVendor = new Map<string, any[]>();
    for (const row of sources.presenceBuckets) {
      const vendorId = text(row?.vendor_id);
      if (!vendorId) continue;
      const list = bucketsByVendor.get(vendorId) || [];
      list.push(row);
      bucketsByVendor.set(vendorId, list);
    }

    const bookingsByVendor = new Map<string, any[]>();
    const excludedCountByVendor = new Map<string, number>();
    const bookingById = new Map<string, any>();

    for (const row of sources.bookings) {
      const bookingId = text(row?.id);
      const vendorId = text(row?.vendor_id);
      if (bookingId) bookingById.set(bookingId, row);
      if (!vendorId) continue;

      if (metricBookingIsExcluded(row, exclusions)) {
        excludedCountByVendor.set(vendorId, (excludedCountByVendor.get(vendorId) || 0) + 1);
        continue;
      }

      const list = bookingsByVendor.get(vendorId) || [];
      list.push(row);
      bookingsByVendor.set(vendorId, list);
    }

    const ratingsByVendor = new Map<string, any[]>();
    for (const row of sources.ratings) {
      const vendorId = text(row?.vendor_id);
      const bookingId = text(row?.booking_id);
      const passengerId = text(row?.passenger_id);
      const rating = Number(row?.vendor_rating);
      const booking = bookingById.get(bookingId);

      if (!vendorId || !Number.isFinite(rating) || rating < 1 || rating > 5) continue;
      if (exclusions.testVendorIds.has(vendorId)) continue;
      if (bookingId && exclusions.excludedBookingIds.has(bookingId)) continue;
      if (passengerId && exclusions.testPassengerIds.has(passengerId)) continue;
      if (!booking || metricBookingIsExcluded(booking, exclusions) || !isTakeoutCompleted(booking)) continue;

      const list = ratingsByVendor.get(vendorId) || [];
      list.push(row);
      ratingsByVendor.set(vendorId, list);
    }

    const vendors = sources.vendors.map((vendor) => {
      const vendorId = text(vendor?.id);
      const setting = settingByVendor.get(vendorId) || {};
      const cutoff = text(setting?.metrics_started_at || vendor?.created_at || now.toISOString());
      const cutoffMs = metricTime(cutoff) ?? now.getTime();
      const testVendor = exclusions.testVendorIds.has(vendorId);

      const allRows = (bookingsByVendor.get(vendorId) || [])
        .filter((row) => (metricTime(row?.created_at) ?? 0) >= cutoffMs)
        .sort((a, b) => (metricTime(b?.created_at) ?? 0) - (metricTime(a?.created_at) ?? 0));

      const rows = period === "all"
        ? allRows
        : allRows.filter((row) => isInVendorMetricPeriod(row?.created_at, period, now));

      const decisions = rows.map((row) => ({ row, decision: classifyVendorDecision(row) }));
      const acceptedRows = decisions.filter((entry) => entry.decision === "accepted");
      const timeoutRows = decisions.filter((entry) => entry.decision === "timeout");
      const rejectedRows = decisions.filter((entry) => entry.decision === "rejected");
      const unacceptedRows = decisions.filter((entry) => entry.decision === "timeout" || entry.decision === "rejected");
      const completedRows = rows.filter(isTakeoutCompleted);
      const pendingRows = decisions.filter((entry) => entry.decision === null && !isClosedWithoutPending(entry.row));
      const otherClosedRows = decisions.filter((entry) => entry.decision === null && isClosedWithoutPending(entry.row));
      const responseSeconds = decisions
        .map((entry) => vendorResponseSeconds(entry.row))
        .filter((value): value is number => value !== null);

      const allDecisions = allRows.map((row) => ({ row, decision: classifyVendorDecision(row) }));
      const allCompleted = allRows.filter(isTakeoutCompleted).length;
      const allUnaccepted = allDecisions.filter((entry) => entry.decision === "timeout" || entry.decision === "rejected").length;
      const units = elapsedMetricUnits(cutoff, now);

      const vendorBuckets = (bucketsByVendor.get(vendorId) || [])
        .filter((row) => (metricTime(row?.bucket_start) ?? 0) >= cutoffMs);
      const selectedBuckets = period === "all"
        ? vendorBuckets
        : vendorBuckets.filter((row) => isInVendorMetricPeriod(row?.bucket_start, period, now));
      const onlineHours = selectedBuckets.length * (5 / 60);
      const presence = presenceByVendor.get(vendorId) || null;
      const lastSeenMs = metricTime(presence?.last_seen_at);
      const isRecentlyOnline = lastSeenMs !== null && now.getTime() - lastSeenMs <= 120000;
      const acceptingOrders = vendor?.accepting_orders === true;
      const presenceState = !acceptingOrders
        ? "closed"
        : isRecentlyOnline
          ? "online"
          : "open_but_offline";

      const eligibleRatings = (ratingsByVendor.get(vendorId) || [])
        .filter((row) => (metricTime(row?.created_at) ?? 0) >= cutoffMs);
      const ratingAverage = average(eligibleRatings.map((row) => Number(row?.vendor_rating || 0)));

      const decidedCount = acceptedRows.length + unacceptedRows.length;
      const acceptanceRate = decidedCount
        ? roundMetric((acceptedRows.length / decidedCount) * 100, 1)
        : null;

      const missedOrders = unacceptedRows
        .sort((a, b) => {
          const left = metricTime(vendorResponseAt(a.row) || a.row?.updated_at || a.row?.created_at) ?? 0;
          const right = metricTime(vendorResponseAt(b.row) || b.row?.updated_at || b.row?.created_at) ?? 0;
          return right - left;
        })
        .slice(0, 25)
        .map((entry) => ({
          booking_id: text(entry.row?.id),
          booking_code: text(entry.row?.booking_code),
          passenger_id: text(entry.row?.created_by_user_id) || null,
          passenger_name: text(entry.row?.passenger_name) || "Customer",
          outcome: entry.decision,
          reason: vendorCancellationReason(entry.row) || (entry.decision === "timeout" ? "Vendor did not respond before expiry" : "Vendor rejected before acceptance"),
          order_placed_at: text(entry.row?.created_at) || null,
          recorded_at: text(vendorResponseAt(entry.row) || entry.row?.updated_at) || null,
          recorded_at_exact: Boolean(
            entry.row?.vendor_timeout_at ||
            entry.row?.vendor_rejected_at ||
            entry.row?.vendor_responded_at
          ),
        }));

      return {
        vendor_id: vendorId,
        display_name: text(vendor?.display_name || vendor?.email || vendorId),
        town: text(vendor?.town),
        accepting_orders: acceptingOrders,
        test_vendor: testVendor,
        metrics_started_at: cutoff,
        current_state: presenceState,
        last_seen_at: text(presence?.last_seen_at) || null,
        last_seen_surface: text(presence?.surface) || null,
        period,
        offered_orders: rows.length,
        accepted_orders: acceptedRows.length,
        completed_orders: completedRows.length,
        accepted_not_completed: acceptedRows.filter((entry) => !isTakeoutCompleted(entry.row)).length,
        unaccepted_orders: unacceptedRows.length,
        vendor_timeouts: timeoutRows.length,
        vendor_rejections: rejectedRows.length,
        pending_orders: pendingRows.length,
        other_closed_orders: otherClosedRows.length,
        acceptance_rate: acceptanceRate,
        average_response_seconds: responseSeconds.length ? Math.round(average(responseSeconds) || 0) : null,
        online_hours: roundMetric(onlineHours, 2),
        eligible_vendor_surveys: eligibleRatings.length,
        vendor_rating_average: ratingAverage === null ? null : roundMetric(ratingAverage, 2),
        excluded_test_orders: excludedCountByVendor.get(vendorId) || 0,
        averages_since_baseline: {
          daily_offered: roundMetric(allRows.length / units.days, 2),
          daily_completed: roundMetric(allCompleted / units.days, 2),
          daily_unaccepted: roundMetric(allUnaccepted / units.days, 2),
          weekly_offered: roundMetric(allRows.length / units.weeks, 2),
          weekly_completed: roundMetric(allCompleted / units.weeks, 2),
          weekly_unaccepted: roundMetric(allUnaccepted / units.weeks, 2),
          monthly_offered: roundMetric(allRows.length / units.months, 2),
          monthly_completed: roundMetric(allCompleted / units.months, 2),
          monthly_unaccepted: roundMetric(allUnaccepted / units.months, 2),
          daily_online_hours: roundMetric((vendorBuckets.length * (5 / 60)) / units.days, 2),
          weekly_online_hours: roundMetric((vendorBuckets.length * (5 / 60)) / units.weeks, 2),
          monthly_online_hours: roundMetric((vendorBuckets.length * (5 / 60)) / units.months, 2),
        },
        missed_orders: missedOrders,
      };
    });

    vendors.sort((a, b) => {
      const stateOrder: Record<string, number> = { open_but_offline: 0, online: 1, closed: 2 };
      const stateDiff = (stateOrder[a.current_state] ?? 9) - (stateOrder[b.current_state] ?? 9);
      if (stateDiff !== 0) return stateDiff;
      return a.display_name.localeCompare(b.display_name, "en");
    });

    return NextResponse.json({
      ok: true,
      generated_at: now.toISOString(),
      period,
      rules: {
        online_heartbeat_seconds: 60,
        online_stale_after_seconds: 120,
        averages_include_current_partial_period: true,
        dummy_filter: "explicit_registry_only",
      },
      vendors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "VENDOR_BEHAVIOR_ADMIN_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
