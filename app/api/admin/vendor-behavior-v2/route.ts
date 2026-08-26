import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { vendorTimeoutDisplay } from "@/lib/vendorTimeoutDisplay";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAY_MS = 24 * 60 * 60 * 1000;
const ONLINE_FRESH_MS = 2 * 60 * 1000;

function json(status: number, body: Record<string, any>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function ts(v: unknown): number {
  const n = new Date(String(v || "")).getTime();
  return Number.isFinite(n) ? n : 0;
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normStatus(v: unknown): string {
  const s = clean(v).toLowerCase().replace(/\s+/g, "_");
  if (s === "canceled") return "cancelled";
  return s;
}

function isCompleted(row: any): boolean {
  if (clean(row?.completed_at)) return true;
  return [
    normStatus(row?.status),
    normStatus(row?.vendor_status),
    normStatus(row?.customer_status),
  ].includes("completed");
}

function acceptedEvidence(row: any): boolean {
  if (clean(row?.vendor_accepted_at)) return true;
  if (
    clean(row?.assigned_at) ||
    clean(row?.takeout_fee_proposed_at) ||
    clean(row?.takeout_customer_confirmed_at)
  ) {
    return true;
  }
  if (
    clean(row?.vendor_driver_arrived_at) ||
    clean(row?.vendor_order_picked_at) ||
    clean(row?.completed_at)
  ) {
    return true;
  }
  if (clean(row?.assigned_driver_id) || clean(row?.driver_id)) return true;
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
  ].includes(normStatus(row?.vendor_status));
}

function isTimeout(row: any): boolean {
  const reason = clean(
    row?.vendor_cancel_reason || row?.cancel_reason
  ).toLowerCase();
  return Boolean(
    clean(row?.vendor_timeout_at) ||
      normStatus(row?.vendor_status) === "vendor_timeout" ||
      reason.includes("did not respond within") ||
      reason.includes("vendor timeout")
  );
}

function decision(row: any): "accepted" | "unaccepted" | "pending" {
  if (acceptedEvidence(row)) return "accepted";
  const status = normStatus(row?.vendor_status);
  if (
    isTimeout(row) ||
    clean(row?.vendor_rejected_at) ||
    status === "cancelled"
  ) {
    return "unaccepted";
  }
  return "pending";
}

function responseSeconds(row: any): number | null {
  const start = ts(row?.created_at);
  const end = isTimeout(row)
    ? ts(vendorTimeoutDisplay(row).displayed_at)
    : ts(
        row?.vendor_responded_at ||
          row?.vendor_accepted_at ||
          row?.vendor_rejected_at ||
          row?.updated_at
      );
  if (!start || !end || end < start) return null;
  return Math.round((end - start) / 1000);
}

function stats(rows: any[]) {
  const accepted = rows.filter((r) => decision(r) === "accepted");
  const unaccepted = rows.filter((r) => decision(r) === "unaccepted");
  const pending = rows.filter((r) => decision(r) === "pending");
  const completed = rows.filter(isCompleted);
  const responses = rows
    .map(responseSeconds)
    .filter((v): v is number => v !== null && v >= 0);
  const decided = accepted.length + unaccepted.length;
  return {
    offered: rows.length,
    accepted: accepted.length,
    completed: completed.length,
    accepted_not_completed: accepted.filter((r) => !isCompleted(r)).length,
    unaccepted: unaccepted.length,
    timed_out: unaccepted.filter(isTimeout).length,
    rejected: unaccepted.filter((r) => !isTimeout(r)).length,
    pending: pending.length,
    acceptance_rate: decided
      ? Math.round((accepted.length / decided) * 1000) / 10
      : null,
    average_response_seconds: responses.length
      ? Math.round(
          responses.reduce((a, b) => a + b, 0) / responses.length
        )
      : null,
  };
}

function missedOrder(row: any) {
  const base = {
    id: clean(row?.id),
    booking_code: clean(row?.booking_code) || clean(row?.id),
    passenger_name: clean(row?.passenger_name) || "Customer",
    amount: Number(row?.takeout_items_subtotal || 0),
    reason:
      clean(row?.vendor_cancel_reason || row?.cancel_reason) ||
      "No reason recorded",
    order_placed_at: row?.created_at || null,
  };

  if (isTimeout(row)) {
    const timing = vendorTimeoutDisplay(row);
    return {
      ...base,
      outcome: "Vendor timeout",
      missed_at: timing.displayed_at,
      exact_event_at: timing.exact_event_at,
      expected_deadline_at: timing.expected_deadline_at,
      date_is_exact: timing.date_is_exact,
      time_label: timing.time_label,
      timestamp_note: timing.timestamp_note,
      timeout_window_minutes: timing.timeout_window_minutes,
    };
  }

  const exactAt = clean(row?.vendor_rejected_at);
  const recordedAt =
    exactAt ||
    clean(row?.vendor_responded_at) ||
    clean(row?.updated_at) ||
    clean(row?.created_at) ||
    null;

  return {
    ...base,
    outcome: "Vendor rejected",
    missed_at: recordedAt,
    exact_event_at: exactAt || null,
    expected_deadline_at: null,
    date_is_exact: Boolean(exactAt),
    time_label: exactAt ? "Rejected at" : "Recorded at",
    timestamp_note: exactAt
      ? "Exact vendor rejection time"
      : "No dedicated vendor rejection timestamp was captured. JRide is showing the recorded booking update time.",
    timeout_window_minutes: null,
  };
}

function groupLabel(status: string): string {
  if (status === "batch2") return "Batch 2";
  if (status === "removed_from_pilot") return "Removed";
  if (["pilot", "pilot_lagawe", "active"].includes(status)) {
    return "Pilot / Active";
  }
  return "Unclassified";
}

function groupMatches(status: string, cohort: string): boolean {
  if (cohort === "all") return status !== "removed_from_pilot";
  if (cohort === "batch2") return status === "batch2";
  if (cohort === "removed") return status === "removed_from_pilot";
  return ["pilot", "pilot_lagawe", "active"].includes(status);
}

export async function GET(req: NextRequest) {
  const admin = adminClient();
  if (!admin) {
    return json(500, { ok: false, error: "SERVER_MISCONFIG" });
  }

  const days = Math.max(
    1,
    Math.min(365, Number(req.nextUrl.searchParams.get("days") || 30))
  );
  const cohort = clean(
    req.nextUrl.searchParams.get("cohort") || "pilot_active"
  ).toLowerCase();
  const town = clean(req.nextUrl.searchParams.get("town"));
  const now = Date.now();
  const since = new Date(now - days * DAY_MS).toISOString();

  const [vendorsRes, onboardingRes, testAccountsRes, exclusionsRes] =
    await Promise.all([
      admin
        .from("vendor_accounts")
        .select(
          "id,email,display_name,town,accepting_orders,created_at,performance_metrics_started_at"
        )
        .order("display_name", { ascending: true }),
      admin
        .from("vendor_onboarding_credentials")
        .select("vendor_id,status"),
      admin
        .from("analytics_test_accounts")
        .select("subject_type,subject_id,reason")
        .eq("active", true),
      admin
        .from("analytics_booking_exclusions")
        .select("booking_id")
        .eq("active", true),
    ]);

  for (const result of [
    vendorsRes,
    onboardingRes,
    testAccountsRes,
    exclusionsRes,
  ]) {
    if (result.error) {
      return json(500, {
        ok: false,
        error: "VENDOR_BEHAVIOR_READ_FAILED",
        message: result.error.message,
      });
    }
  }

  const statusByVendor = new Map<string, string>();
  for (const row of Array.isArray(onboardingRes.data)
    ? onboardingRes.data
    : []) {
    statusByVendor.set(
      clean(row?.vendor_id),
      clean(row?.status).toLowerCase()
    );
  }

  const testVendorIds = new Set(
    (Array.isArray(testAccountsRes.data) ? testAccountsRes.data : [])
      .filter((r: any) => clean(r?.subject_type) === "vendor")
      .map((r: any) => clean(r?.subject_id))
      .filter(Boolean)
  );
  const testPassengerIds = new Set(
    (Array.isArray(testAccountsRes.data) ? testAccountsRes.data : [])
      .filter((r: any) => clean(r?.subject_type) === "passenger_user")
      .map((r: any) => clean(r?.subject_id))
      .filter(Boolean)
  );
  const excludedBookingIds = new Set(
    (Array.isArray(exclusionsRes.data) ? exclusionsRes.data : [])
      .map((r: any) => clean(r?.booking_id))
      .filter(Boolean)
  );

  const allVendors = (
    Array.isArray(vendorsRes.data) ? vendorsRes.data : []
  ).filter((vendor: any) => !testVendorIds.has(clean(vendor?.id)));
  const filteredVendors = allVendors.filter((vendor: any) => {
    const status = statusByVendor.get(clean(vendor?.id)) || "";
    if (!groupMatches(status, cohort)) return false;
    if (
      town &&
      clean(vendor?.town).toLowerCase() !== town.toLowerCase()
    ) {
      return false;
    }
    return true;
  });
  const vendorIds = filteredVendors
    .map((v: any) => clean(v?.id))
    .filter(Boolean);

  if (!vendorIds.length) {
    return json(200, {
      ok: true,
      days,
      cohort,
      generated_at: new Date(now).toISOString(),
      vendors: [],
      cohort_counts: {},
    });
  }

  const [bookingsRes, ratingsRes, presenceRes] = await Promise.all([
    admin
      .from("bookings")
      .select(
        "id,booking_code,vendor_id,created_by_user_id,passenger_name,status,vendor_status,customer_status,created_at,updated_at,completed_at,assigned_driver_id,driver_id,assigned_at,takeout_fee_proposed_at,takeout_customer_confirmed_at,vendor_driver_arrived_at,vendor_order_picked_at,vendor_responded_at,vendor_accepted_at,vendor_rejected_at,vendor_timeout_at,vendor_cancel_reason,cancel_reason,takeout_items_subtotal"
      )
      .eq("service_type", "takeout")
      .in("vendor_id", vendorIds)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20000),
    admin
      .from("takeout_ratings")
      .select(
        "booking_id,passenger_id,vendor_id,vendor_rating,created_at"
      )
      .in("vendor_id", vendorIds)
      .gte("created_at", since)
      .limit(10000),
    admin
      .from("vendor_presence_minutes")
      .select(
        "vendor_id,minute_started_at,last_seen_at,accepting_orders,client"
      )
      .in("vendor_id", vendorIds)
      .gte("minute_started_at", since)
      .order("last_seen_at", { ascending: false })
      .limit(50000),
  ]);

  for (const result of [bookingsRes, ratingsRes, presenceRes]) {
    if (result.error) {
      return json(500, {
        ok: false,
        error: "VENDOR_BEHAVIOR_DETAIL_READ_FAILED",
        message: result.error.message,
      });
    }
  }

  const bookings = (
    Array.isArray(bookingsRes.data) ? bookingsRes.data : []
  ).filter((row: any) => {
    if (testPassengerIds.has(clean(row?.created_by_user_id))) return false;
    if (excludedBookingIds.has(clean(row?.id))) return false;
    return true;
  });
  const bookingById = new Map(
    bookings.map((r: any) => [clean(r?.id), r] as const)
  );
  const ratings = Array.isArray(ratingsRes.data) ? ratingsRes.data : [];
  const presence = Array.isArray(presenceRes.data) ? presenceRes.data : [];

  const rows = filteredVendors.map((vendor: any) => {
    const vendorId = clean(vendor?.id);
    const status = statusByVendor.get(vendorId) || "";
    const vendorBookings = bookings.filter(
      (r: any) => clean(r?.vendor_id) === vendorId
    );
    const vendorStats = stats(vendorBookings);
    const vendorPresence = presence.filter(
      (r: any) => clean(r?.vendor_id) === vendorId
    );
    const latestPresence = vendorPresence[0] || null;
    const lastSeen = ts(latestPresence?.last_seen_at);
    const currentState =
      vendor?.accepting_orders !== true
        ? "closed"
        : lastSeen >= now - ONLINE_FRESH_MS
          ? "online"
          : "open_but_offline";

    const vendorRatings = ratings
      .filter((r: any) => clean(r?.vendor_id) === vendorId)
      .filter(
        (r: any) => !testPassengerIds.has(clean(r?.passenger_id))
      )
      .filter((r: any) => {
        const booking = bookingById.get(clean(r?.booking_id));
        return booking ? isCompleted(booking) : false;
      })
      .map((r: any) => Number(r?.vendor_rating))
      .filter(
        (n: number) => Number.isFinite(n) && n >= 1 && n <= 5
      );

    const missed = vendorBookings
      .filter((r: any) => decision(r) === "unaccepted")
      .slice(0, 20)
      .map(missedOrder);

    return {
      vendor_id: vendorId,
      display_name:
        clean(vendor?.display_name) || clean(vendor?.email) || vendorId,
      email: clean(vendor?.email) || null,
      town: clean(vendor?.town) || null,
      marketplace_status: status,
      vendor_group: groupLabel(status),
      current_state: currentState,
      last_seen_at: lastSeen ? new Date(lastSeen).toISOString() : null,
      presence_client: clean(latestPresence?.client) || null,
      heartbeat_tracking_started_at:
        vendor?.performance_metrics_started_at || null,
      online_hours_tracked:
        Math.round((vendorPresence.length / 60) * 10) / 10,
      ...vendorStats,
      survey_responses: vendorRatings.length,
      survey_average: vendorRatings.length
        ? Math.round(
            (vendorRatings.reduce(
              (a: number, b: number) => a + b,
              0
            ) /
              vendorRatings.length) *
              10
          ) / 10
        : null,
      average_daily_completed:
        Math.round((vendorStats.completed / days) * 100) / 100,
      average_daily_unaccepted:
        Math.round((vendorStats.unaccepted / days) * 100) / 100,
      average_weekly_completed:
        Math.round(
          (vendorStats.completed / Math.max(1, days / 7)) * 100
        ) / 100,
      average_weekly_unaccepted:
        Math.round(
          (vendorStats.unaccepted / Math.max(1, days / 7)) * 100
        ) / 100,
      average_monthly_completed:
        Math.round(
          (vendorStats.completed / Math.max(1, days / 30)) * 100
        ) / 100,
      average_monthly_unaccepted:
        Math.round(
          (vendorStats.unaccepted / Math.max(1, days / 30)) * 100
        ) / 100,
      recent_missed_orders: missed,
    };
  });

  const cohortCounts: Record<string, number> = {
    pilot_active: 0,
    batch2: 0,
    removed: 0,
    unclassified: 0,
  };
  for (const vendor of allVendors) {
    const status = statusByVendor.get(clean(vendor?.id)) || "";
    if (["pilot", "pilot_lagawe", "active"].includes(status)) {
      cohortCounts.pilot_active += 1;
    } else if (status === "batch2") {
      cohortCounts.batch2 += 1;
    } else if (status === "removed_from_pilot") {
      cohortCounts.removed += 1;
    } else {
      cohortCounts.unclassified += 1;
    }
  }

  return json(200, {
    ok: true,
    days,
    cohort,
    generated_at: new Date(now).toISOString(),
    order_history_note:
      "Admin order statistics use real historical Takeout activity inside the selected reporting range. Historical timeout deadlines are derived from the stored five- or fifteen-minute rule when an exact event timestamp was not captured. The public vendor-profile baseline remains separate.",
    presence_note:
      "Online-hour tracking begins only when the new portal heartbeat feature was deployed; historical online hours before that point cannot be reconstructed.",
    cohort_counts: cohortCounts,
    vendors: rows,
  });
}
