import { NextResponse } from "next/server";
import {
  classifyVendorDecision,
  isTakeoutCompleted,
  metricTime,
  roundMetric,
  vendorResponseAt,
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

export async function GET() {
  try {
    const admin = createVendorMetricsAdmin();
    const sources = await loadVendorPerformanceSources(admin);
    const exclusions = activeMetricExclusions(sources);

    const settingByVendor = new Map<string, any>();
    for (const row of sources.settings) {
      const vendorId = text(row?.vendor_id);
      if (vendorId) settingByVendor.set(vendorId, row);
    }

    const bookingsByVendor = new Map<string, any[]>();
    const bookingById = new Map<string, any>();
    for (const row of sources.bookings) {
      const id = text(row?.id);
      const vendorId = text(row?.vendor_id);
      if (id) bookingById.set(id, row);
      if (!vendorId || metricBookingIsExcluded(row, exclusions)) continue;
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

    const vendors = sources.vendors
      .filter((vendor) => !exclusions.testVendorIds.has(text(vendor?.id)))
      .map((vendor) => {
        const vendorId = text(vendor?.id);
        const setting = settingByVendor.get(vendorId) || {};
        const cutoff = text(setting?.metrics_started_at || vendor?.created_at || new Date().toISOString());
        const cutoffMs = metricTime(cutoff) ?? Date.now();
        const decisionLimit = Math.max(10, Number(setting?.recent_decision_limit || 20));
        const ratingLimit = Math.max(5, Number(setting?.recent_rating_limit || 20));
        const acceptanceMinimum = Math.max(1, Number(setting?.public_acceptance_min_decisions || 10));
        const ratingMinimum = Math.max(1, Number(setting?.public_rating_min_surveys || 5));

        const decisions = (bookingsByVendor.get(vendorId) || [])
          .filter((row) => (metricTime(row?.created_at) ?? 0) >= cutoffMs)
          .map((row) => ({ row, decision: classifyVendorDecision(row) }))
          .filter((entry) => entry.decision !== null)
          .sort((a, b) => {
            const left = metricTime(vendorResponseAt(a.row) || a.row?.updated_at || a.row?.created_at) ?? 0;
            const right = metricTime(vendorResponseAt(b.row) || b.row?.updated_at || b.row?.created_at) ?? 0;
            return right - left;
          })
          .slice(0, decisionLimit);

        const accepted = decisions.filter((entry) => entry.decision === "accepted").length;
        const acceptanceVisible = decisions.length >= acceptanceMinimum;
        const acceptanceRate = acceptanceVisible && decisions.length
          ? roundMetric((accepted / decisions.length) * 100, 0)
          : null;

        const ratings = (ratingsByVendor.get(vendorId) || [])
          .filter((row) => (metricTime(row?.created_at) ?? 0) >= cutoffMs)
          .sort((a, b) => (metricTime(b?.created_at) ?? 0) - (metricTime(a?.created_at) ?? 0))
          .slice(0, ratingLimit);

        const ratingVisible = ratings.length >= ratingMinimum;
        const ratingAverage = ratingVisible && ratings.length
          ? roundMetric(
              ratings.reduce((sum, row) => sum + Number(row?.vendor_rating || 0), 0) / ratings.length,
              1
            )
          : null;

        return {
          vendor_id: vendorId,
          display_name: text(vendor?.display_name || vendor?.email || vendorId),
          town: text(vendor?.town),
          acceptance_visible: acceptanceVisible,
          acceptance_rate: acceptanceRate,
          rating_visible: ratingVisible,
          rating_average: ratingAverage,
          public_state: acceptanceVisible || ratingVisible ? "measured" : "building",
          public_label: acceptanceVisible || ratingVisible ? "Recent verified JRide activity" : "New on JRide",
        };
      });

    return NextResponse.json(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        vendors,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "VENDOR_PERFORMANCE_PUBLIC_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
