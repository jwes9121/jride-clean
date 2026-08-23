import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isCompletedTakeoutOrder,
  isVendorTimeoutDecision,
  vendorCancellationReason,
  vendorDecision,
  vendorDecisionTimestamp,
  vendorResponseSeconds,
} from "@/lib/vendorPerformance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAY_MS = 24 * 60 * 60 * 1000;
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const ONLINE_FRESH_MS = 2 * 60 * 1000;

function json(status: number, payload: Record<string, any>) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function numberValue(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function timestamp(value: unknown): number {
  const result = new Date(String(value || "")).getTime();
  return Number.isFinite(result) ? result : 0;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function adminClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function manilaDayStart(ms: number): number {
  return Math.floor((ms + PHT_OFFSET_MS) / DAY_MS) * DAY_MS - PHT_OFFSET_MS;
}

function manilaWeekStart(ms: number): number {
  const dayStart = manilaDayStart(ms);
  const shifted = new Date(dayStart + PHT_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return dayStart - daysSinceMonday * DAY_MS;
}

function manilaMonthStart(ms: number): number {
  const shifted = new Date(ms + PHT_OFFSET_MS);
  return (
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) -
    PHT_OFFSET_MS
  );
}

function nextManilaMonthStart(ms: number): number {
  const shifted = new Date(ms + PHT_OFFSET_MS);
  return (
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) -
    PHT_OFFSET_MS
  );
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function safeAverage(values: number[]): number | null {
  if (!values.length) return null;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function completePeriods(
  unit: "day" | "week" | "month",
  startMs: number,
  nowMs: number
): Array<[number, number]> {
  const out: Array<[number, number]> = [];

  if (unit === "day") {
    let cursor = manilaDayStart(startMs);
    if (startMs > cursor) cursor += DAY_MS;
    const end = manilaDayStart(nowMs);
    while (cursor < end) {
      out.push([cursor, cursor + DAY_MS]);
      cursor += DAY_MS;
    }
    return out;
  }

  if (unit === "week") {
    let cursor = manilaWeekStart(startMs);
    if (startMs > cursor) cursor += 7 * DAY_MS;
    const end = manilaWeekStart(nowMs);
    while (cursor < end) {
      out.push([cursor, cursor + 7 * DAY_MS]);
      cursor += 7 * DAY_MS;
    }
    return out;
  }

  let cursor = manilaMonthStart(startMs);
  if (startMs > cursor) cursor = nextManilaMonthStart(cursor);
  const end = manilaMonthStart(nowMs);
  while (cursor < end) {
    const next = nextManilaMonthStart(cursor);
    out.push([cursor, next]);
    cursor = next;
  }
  return out;
}

function rowsInWindow(rows: any[], startMs: number, endMs: number): any[] {
  return rows.filter((row) => {
    const created = timestamp(row?.created_at);
    return created >= startMs && created < endMs;
  });
}

function orderStats(rows: any[]) {
  const acceptedRows = rows.filter((row) => vendorDecision(row) === "accepted");
  const unacceptedRows = rows.filter(
    (row) => vendorDecision(row) === "unaccepted"
  );
  const pendingRows = rows.filter((row) => vendorDecision(row) === "pending");
  const completedRows = rows.filter(isCompletedTakeoutOrder);
  const acceptedNotCompleted = acceptedRows.filter(
    (row) => !isCompletedTakeoutOrder(row)
  );
  const timeoutRows = unacceptedRows.filter(isVendorTimeoutDecision);
  const rejectedRows = unacceptedRows.filter(
    (row) => !isVendorTimeoutDecision(row)
  );
  const responseValues = rows
    .map(vendorResponseSeconds)
    .filter((value): value is number => value !== null && value >= 0);
  const decisions = acceptedRows.length + unacceptedRows.length;

  return {
    offered: rows.length,
    accepted: acceptedRows.length,
    completed: completedRows.length,
    accepted_not_completed: acceptedNotCompleted.length,
    unaccepted: unacceptedRows.length,
    timed_out: timeoutRows.length,
    rejected: rejectedRows.length,
    pending: pendingRows.length,
    acceptance_rate: decisions
      ? round1((acceptedRows.length / decisions) * 100)
      : null,
    average_response_seconds: responseValues.length
      ? Math.round(
          responseValues.reduce((sum, value) => sum + value, 0) /
            responseValues.length
        )
      : null,
  };
}

function availabilityMinutes(
  events: any[],
  startMs: number,
  endMs: number,
  fallbackOpen: boolean
): number {
  if (endMs <= startMs) return 0;

  const sorted = [...events].sort(
    (a, b) => timestamp(a?.changed_at) - timestamp(b?.changed_at)
  );

  let state = fallbackOpen;
  for (const event of sorted) {
    const at = timestamp(event?.changed_at);
    if (!at || at > startMs) break;
    state = event?.accepting_orders === true;
  }

  let cursor = startMs;
  let openMs = 0;

  for (const event of sorted) {
    const at = timestamp(event?.changed_at);
    if (!at || at <= startMs || at >= endMs) continue;
    if (state) openMs += Math.max(0, at - cursor);
    state = event?.accepting_orders === true;
    cursor = at;
  }

  if (state) openMs += Math.max(0, endMs - cursor);
  return Math.round(openMs / 60000);
}

function presenceInWindow(
  rows: any[],
  startMs: number,
  endMs: number
): any[] {
  return rows.filter((row) => {
    const at = timestamp(row?.minute_started_at);
    return at >= startMs && at < endMs;
  });
}

function periodAverages(
  rows: any[],
  presenceRows: any[],
  availabilityEvents: any[],
  fallbackOpen: boolean,
  startMs: number,
  nowMs: number,
  unit: "day" | "week" | "month"
) {
  const periods = completePeriods(unit, startMs, nowMs);
  if (!periods.length) {
    return {
      complete_periods: 0,
      completed_orders: null,
      unaccepted_orders: null,
      online_hours: null,
      open_hours: null,
    };
  }

  const completed: number[] = [];
  const unaccepted: number[] = [];
  const onlineHours: number[] = [];
  const openHours: number[] = [];

  for (const [periodStart, periodEnd] of periods) {
    const stats = orderStats(rowsInWindow(rows, periodStart, periodEnd));
    const online = presenceInWindow(
      presenceRows,
      periodStart,
      periodEnd
    ).length;
    const open = availabilityMinutes(
      availabilityEvents,
      periodStart,
      periodEnd,
      fallbackOpen
    );

    completed.push(stats.completed);
    unaccepted.push(stats.unaccepted);
    onlineHours.push(online / 60);
    openHours.push(open / 60);
  }

  return {
    complete_periods: periods.length,
    completed_orders: safeAverage(completed),
    unaccepted_orders: safeAverage(unaccepted),
    online_hours: safeAverage(onlineHours),
    open_hours: safeAverage(openHours),
  };
}

function missedOrder(row: any) {
  const exactAt =
    clean(row?.vendor_timeout_at) || clean(row?.vendor_rejected_at) || "";
  const recordedAt =
    exactAt ||
    clean(row?.vendor_responded_at) ||
    clean(row?.updated_at) ||
    clean(row?.created_at) ||
    null;

  return {
    id: clean(row?.id),
    booking_code: clean(row?.booking_code) || clean(row?.id),
    passenger_name: clean(row?.passenger_name) || "Customer",
    amount: numberValue(
      row?.takeout_items_subtotal ?? row?.items_subtotal ?? row?.total_bill
    ),
    outcome: isVendorTimeoutDecision(row)
      ? "Vendor timeout"
      : "Vendor rejected",
    reason: vendorCancellationReason(row) || "No reason recorded",
    order_placed_at: row?.created_at || null,
    missed_at: recordedAt,
    date_is_exact: Boolean(exactAt),
  };
}

export async function GET(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const days = Math.max(
    1,
    Math.min(365, Number(req.nextUrl.searchParams.get("days") || 30))
  );
  const requestedVendorId = clean(
    req.nextUrl.searchParams.get("vendor_id")
  );
  const nowMs = Date.now();
  const requestedStartMs = nowMs - days * DAY_MS;

  let vendorsQuery = admin
    .from("vendor_accounts")
    .select(
      "id,email,display_name,town,accepting_orders,created_at,performance_metrics_started_at"
    )
    .order("display_name", { ascending: true });

  if (requestedVendorId) vendorsQuery = vendorsQuery.eq("id", requestedVendorId);
  const vendorsRes = await vendorsQuery;

  if (vendorsRes.error) {
    return json(500, {
      ok: false,
      error: "VENDORS_READ_FAILED",
      message: vendorsRes.error.message,
    });
  }

  const vendors = Array.isArray(vendorsRes.data) ? vendorsRes.data : [];
  const vendorIds = vendors.map((row: any) => clean(row?.id)).filter(Boolean);

  if (!vendorIds.length) {
    return json(200, {
      ok: true,
      days,
      generated_at: new Date(nowMs).toISOString(),
      vendors: [],
      exclusions: { test_accounts: [], bookings: [] },
    });
  }

  const cutoffValues = vendors
    .map((row: any) => timestamp(row?.performance_metrics_started_at))
    .filter((value: number) => value > 0);
  const earliestCutoff = cutoffValues.length
    ? Math.min(...cutoffValues)
    : nowMs;
  const queryStartMs = Math.min(requestedStartMs, earliestCutoff);

  const [
    bookingsRes,
    presenceRes,
    availabilityRes,
    ratingsRes,
    testAccountsRes,
    bookingExclusionsRes,
  ] = await Promise.all([
    admin
      .from("bookings")
      .select(
        "id,booking_code,vendor_id,created_by_user_id,passenger_name,service_type,status,vendor_status,customer_status,created_at,updated_at,completed_at,vendor_responded_at,vendor_accepted_at,vendor_rejected_at,vendor_timeout_at,vendor_cancel_reason,cancel_reason,takeout_items_subtotal,items_subtotal,total_bill"
      )
      .eq("service_type", "takeout")
      .in("vendor_id", vendorIds)
      .gte("created_at", iso(queryStartMs))
      .order("created_at", { ascending: false })
      .limit(20000),
    admin
      .from("vendor_presence_minutes")
      .select(
        "vendor_id,minute_started_at,last_seen_at,accepting_orders,client"
      )
      .in("vendor_id", vendorIds)
      .gte("minute_started_at", iso(queryStartMs))
      .order("minute_started_at", { ascending: false })
      .limit(50000),
    admin
      .from("vendor_availability_events")
      .select("vendor_id,accepting_orders,changed_at,source")
      .in("vendor_id", vendorIds)
      .order("changed_at", { ascending: true })
      .limit(20000),
    admin
      .from("takeout_ratings")
      .select(
        "id,booking_id,passenger_id,vendor_id,vendor_rating,created_at"
      )
      .in("vendor_id", vendorIds)
      .gte("created_at", iso(queryStartMs))
      .order("created_at", { ascending: false })
      .limit(20000),
    admin
      .from("analytics_test_accounts")
      .select(
        "id,subject_type,subject_id,reason,active,marked_by,created_at,updated_at"
      )
      .eq("active", true)
      .order("created_at", { ascending: false }),
    admin
      .from("analytics_booking_exclusions")
      .select(
        "id,booking_id,reason,active,marked_by,created_at,updated_at"
      )
      .eq("active", true)
      .order("created_at", { ascending: false }),
  ]);

  for (const result of [
    bookingsRes,
    presenceRes,
    availabilityRes,
    ratingsRes,
    testAccountsRes,
    bookingExclusionsRes,
  ]) {
    if (result.error) {
      return json(500, {
        ok: false,
        error: "VENDOR_BEHAVIOR_READ_FAILED",
        message: result.error.message,
      });
    }
  }

  const bookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];
  const presence = Array.isArray(presenceRes.data) ? presenceRes.data : [];
  const availability = Array.isArray(availabilityRes.data)
    ? availabilityRes.data
    : [];
  const ratings = Array.isArray(ratingsRes.data) ? ratingsRes.data : [];
  const testAccounts = Array.isArray(testAccountsRes.data)
    ? testAccountsRes.data
    : [];
  const bookingExclusions = Array.isArray(bookingExclusionsRes.data)
    ? bookingExclusionsRes.data
    : [];

  const testPassengerIds = new Set(
    testAccounts
      .filter((row: any) => clean(row?.subject_type) === "passenger_user")
      .map((row: any) => clean(row?.subject_id))
      .filter(Boolean)
  );
  const excludedBookingIds = new Set(
    bookingExclusions
      .map((row: any) => clean(row?.booking_id))
      .filter(Boolean)
  );

  const testProfileIds = Array.from(testPassengerIds);
  const testProfilesRes = testProfileIds.length
    ? await admin
        .from("passenger_profiles")
        .select("user_id,full_name,phone,email")
        .in("user_id", testProfileIds)
    : ({ data: [], error: null } as any);
  const testProfileById = new Map<string, any>();
  if (!testProfilesRes.error && Array.isArray(testProfilesRes.data)) {
    for (const profile of testProfilesRes.data) {
      testProfileById.set(clean(profile?.user_id), profile);
    }
  }

  const excludedBookingCodesRes = excludedBookingIds.size
    ? await admin
        .from("bookings")
        .select("id,booking_code,passenger_name,vendor_id,created_at")
        .in("id", Array.from(excludedBookingIds))
    : ({ data: [], error: null } as any);
  const excludedBookingById = new Map<string, any>();
  if (
    !excludedBookingCodesRes.error &&
    Array.isArray(excludedBookingCodesRes.data)
  ) {
    for (const booking of excludedBookingCodesRes.data) {
      excludedBookingById.set(clean(booking?.id), booking);
    }
  }

  const behaviorRows = vendors.map((vendor: any) => {
    const vendorId = clean(vendor?.id);
    const cutoffMs = timestamp(vendor?.performance_metrics_started_at) || nowMs;
    const rangeStartMs = Math.max(cutoffMs, requestedStartMs);

    const vendorBookings = bookings.filter((row: any) => {
      if (clean(row?.vendor_id) !== vendorId) return false;
      if (timestamp(row?.created_at) < rangeStartMs) return false;
      if (excludedBookingIds.has(clean(row?.id))) return false;
      if (testPassengerIds.has(clean(row?.created_by_user_id))) return false;
      return true;
    });

    const vendorPresence = presence.filter(
      (row: any) =>
        clean(row?.vendor_id) === vendorId &&
        timestamp(row?.minute_started_at) >= rangeStartMs
    );
    const vendorAvailability = availability.filter(
      (row: any) => clean(row?.vendor_id) === vendorId
    );

    const stats = orderStats(vendorBookings);
    const todayStats = orderStats(
      rowsInWindow(vendorBookings, manilaDayStart(nowMs), nowMs + 1)
    );
    const last7Stats = orderStats(
      rowsInWindow(vendorBookings, nowMs - 7 * DAY_MS, nowMs + 1)
    );
    const last30Stats = orderStats(
      rowsInWindow(vendorBookings, nowMs - 30 * DAY_MS, nowMs + 1)
    );

    const latestPresence = [...vendorPresence].sort(
      (a, b) => timestamp(b?.last_seen_at) - timestamp(a?.last_seen_at)
    )[0];
    const lastSeenMs = timestamp(latestPresence?.last_seen_at);
    const heartbeatFresh = lastSeenMs >= nowMs - ONLINE_FRESH_MS;
    const acceptingOrders = vendor?.accepting_orders === true;
    const currentState = !acceptingOrders
      ? "closed"
      : heartbeatFresh
        ? "online"
        : "open_but_offline";

    const onlineMinutes = vendorPresence.length;
    const onlineOpenMinutes = vendorPresence.filter(
      (row: any) => row?.accepting_orders === true
    ).length;
    const openMinutes = availabilityMinutes(
      vendorAvailability,
      rangeStartMs,
      nowMs,
      acceptingOrders
    );
    const openButOfflineMinutes = Math.max(
      0,
      openMinutes - onlineOpenMinutes
    );

    const vendorBookingIds = new Set(
      vendorBookings.map((row: any) => clean(row?.id))
    );
    const vendorRatings = ratings
      .filter((row: any) => {
        if (clean(row?.vendor_id) !== vendorId) return false;
        if (timestamp(row?.created_at) < rangeStartMs) return false;
        if (testPassengerIds.has(clean(row?.passenger_id))) return false;
        const bookingId = clean(row?.booking_id);
        if (!bookingId || !vendorBookingIds.has(bookingId)) return false;
        if (excludedBookingIds.has(bookingId)) return false;
        return true;
      })
      .map((row: any) => numberValue(row?.vendor_rating))
      .filter((value: number) => value >= 1 && value <= 5);

    const recentMissed = vendorBookings
      .filter((row: any) => vendorDecision(row) === "unaccepted")
      .sort((a: any, b: any) => vendorDecisionTimestamp(b) - vendorDecisionTimestamp(a))
      .slice(0, 20)
      .map(missedOrder);

    return {
      vendor_id: vendorId,
      display_name:
        clean(vendor?.display_name) || clean(vendor?.email) || vendorId,
      email: clean(vendor?.email) || null,
      town: clean(vendor?.town) || null,
      accepting_orders: acceptingOrders,
      metrics_started_at: vendor?.performance_metrics_started_at,
      current_state: currentState,
      last_seen_at: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
      last_seen_age_seconds: lastSeenMs
        ? Math.max(0, Math.round((nowMs - lastSeenMs) / 1000))
        : null,
      presence_client: clean(latestPresence?.client) || null,
      range: {
        days,
        starts_at: new Date(rangeStartMs).toISOString(),
        ...stats,
        online_minutes: onlineMinutes,
        online_hours: round1(onlineMinutes / 60),
        open_minutes: openMinutes,
        open_hours: round1(openMinutes / 60),
        open_but_offline_minutes: openButOfflineMinutes,
        open_but_offline_hours: round1(openButOfflineMinutes / 60),
        orders_per_online_hour:
          onlineMinutes > 0
            ? round1(stats.offered / (onlineMinutes / 60))
            : null,
      },
      today: todayStats,
      last_7_days: last7Stats,
      last_30_days: last30Stats,
      averages: {
        daily: periodAverages(
          vendorBookings,
          vendorPresence,
          vendorAvailability,
          acceptingOrders,
          rangeStartMs,
          nowMs,
          "day"
        ),
        weekly: periodAverages(
          vendorBookings,
          vendorPresence,
          vendorAvailability,
          acceptingOrders,
          rangeStartMs,
          nowMs,
          "week"
        ),
        monthly: periodAverages(
          vendorBookings,
          vendorPresence,
          vendorAvailability,
          acceptingOrders,
          rangeStartMs,
          nowMs,
          "month"
        ),
      },
      survey: {
        responses: vendorRatings.length,
        average: vendorRatings.length ? safeAverage(vendorRatings) : null,
      },
      recent_missed_orders: recentMissed,
    };
  });

  const testAccountOutput = testAccounts.map((row: any) => {
    const subjectId = clean(row?.subject_id);
    const profile = testProfileById.get(subjectId);
    return {
      ...row,
      full_name: clean(profile?.full_name) || null,
      phone: clean(profile?.phone) || null,
      email: clean(profile?.email) || null,
    };
  });

  const bookingExclusionOutput = bookingExclusions.map((row: any) => {
    const bookingId = clean(row?.booking_id);
    const booking = excludedBookingById.get(bookingId);
    return {
      ...row,
      booking_code: clean(booking?.booking_code) || null,
      passenger_name: clean(booking?.passenger_name) || null,
      vendor_id: clean(booking?.vendor_id) || null,
      booking_created_at: booking?.created_at || null,
    };
  });

  return json(200, {
    ok: true,
    days,
    generated_at: new Date(nowMs).toISOString(),
    online_fresh_seconds: ONLINE_FRESH_MS / 1000,
    vendors: behaviorRows,
    exclusions: {
      test_accounts: testAccountOutput,
      bookings: bookingExclusionOutput,
    },
  });
}

export async function POST(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const body = await req.json().catch(() => ({} as any));
  const action = clean(body?.action).toLowerCase();
  const reason = clean(body?.reason) || "Admin analytics exclusion";
  const markedBy = clean(body?.marked_by || body?.markedBy) || "JRide admin";

  if (action === "exclude_passenger" || action === "include_passenger") {
    const subjectId = clean(body?.subject_id || body?.passenger_user_id);
    if (!isUuid(subjectId)) {
      return json(400, {
        ok: false,
        error: "INVALID_PASSENGER_USER_ID",
        message: "A valid passenger user UUID is required.",
      });
    }

    const result = await admin.from("analytics_test_accounts").upsert(
      {
        subject_type: "passenger_user",
        subject_id: subjectId,
        reason,
        active: action === "exclude_passenger",
        marked_by: markedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "subject_type,subject_id" }
    );

    if (result.error) {
      return json(500, {
        ok: false,
        error: "TEST_ACCOUNT_WRITE_FAILED",
        message: result.error.message,
      });
    }

    return json(200, {
      ok: true,
      action,
      subject_id: subjectId,
      active: action === "exclude_passenger",
    });
  }

  if (action === "exclude_booking" || action === "include_booking") {
    const bookingId = clean(body?.booking_id);
    if (!isUuid(bookingId)) {
      return json(400, {
        ok: false,
        error: "INVALID_BOOKING_ID",
        message: "A valid booking UUID is required.",
      });
    }

    const result = await admin.from("analytics_booking_exclusions").upsert(
      {
        booking_id: bookingId,
        reason,
        active: action === "exclude_booking",
        marked_by: markedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "booking_id" }
    );

    if (result.error) {
      return json(500, {
        ok: false,
        error: "BOOKING_EXCLUSION_WRITE_FAILED",
        message: result.error.message,
      });
    }

    return json(200, {
      ok: true,
      action,
      booking_id: bookingId,
      active: action === "exclude_booking",
    });
  }

  return json(400, {
    ok: false,
    error: "INVALID_ACTION",
    message:
      "Supported actions: exclude_passenger, include_passenger, exclude_booking, include_booking.",
  });
}
