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

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function ts(value: unknown): number {
  const n = new Date(String(value || "")).getTime();
  return Number.isFinite(n) ? n : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
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
  const weekday = new Date(dayStart + PHT_OFFSET_MS).getUTCDay();
  return dayStart - (weekday === 0 ? 6 : weekday - 1) * DAY_MS;
}

function manilaMonthStart(ms: number): number {
  const shifted = new Date(ms + PHT_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - PHT_OFFSET_MS;
}

function nextManilaMonthStart(ms: number): number {
  const shifted = new Date(ms + PHT_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) - PHT_OFFSET_MS;
}

function periodWindows(unit: "day" | "week" | "month", startMs: number, nowMs: number): Array<[number, number]> {
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

function rowsInWindow(rows: any[], startMs: number, endMs: number) {
  return rows.filter((row) => {
    const created = ts(row?.created_at);
    return created >= startMs && created < endMs;
  });
}

function orderStats(rows: any[]) {
  const accepted = rows.filter((r) => vendorDecision(r) === "accepted");
  const unaccepted = rows.filter((r) => vendorDecision(r) === "unaccepted");
  const pending = rows.filter((r) => vendorDecision(r) === "pending");
  const completed = rows.filter(isCompletedTakeoutOrder);
  const responses = rows
    .map(vendorResponseSeconds)
    .filter((v): v is number => v !== null && v >= 0);
  const decisions = accepted.length + unaccepted.length;

  return {
    offered: rows.length,
    accepted: accepted.length,
    completed: completed.length,
    accepted_not_completed: accepted.filter((r) => !isCompletedTakeoutOrder(r)).length,
    unaccepted: unaccepted.length,
    timed_out: unaccepted.filter(isVendorTimeoutDecision).length,
    rejected: unaccepted.filter((r) => !isVendorTimeoutDecision(r)).length,
    pending: pending.length,
    acceptance_rate: decisions ? round1((accepted.length / decisions) * 100) : null,
    average_response_seconds: responses.length
      ? Math.round(responses.reduce((a, b) => a + b, 0) / responses.length)
      : null,
  };
}

function averagePeriod(
  rows: any[],
  presenceRows: any[],
  startMs: number,
  nowMs: number,
  unit: "day" | "week" | "month"
) {
  const windows = periodWindows(unit, startMs, nowMs);
  if (!windows.length) {
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
  const online: number[] = [];
  const open: number[] = [];

  for (const [start, end] of windows) {
    const stats = orderStats(rowsInWindow(rows, start, end));
    const p = presenceRows.filter((row) => {
      const at = ts(row?.minute_started_at);
      return at >= start && at < end;
    });
    completed.push(stats.completed);
    unaccepted.push(stats.unaccepted);
    online.push(p.length / 60);
    open.push(p.filter((row) => row?.accepting_orders === true).length / 60);
  }

  const avg = (values: number[]) => round1(values.reduce((a, b) => a + b, 0) / values.length);
  return {
    complete_periods: windows.length,
    completed_orders: avg(completed),
    unaccepted_orders: avg(unaccepted),
    online_hours: avg(online),
    open_hours: avg(open),
  };
}

function missedOrder(row: any) {
  const exactAt = clean(row?.vendor_timeout_at) || clean(row?.vendor_rejected_at) || "";
  const recordedAt = exactAt || clean(row?.vendor_responded_at) || clean(row?.updated_at) || clean(row?.created_at) || null;
  return {
    id: clean(row?.id),
    booking_code: clean(row?.booking_code) || clean(row?.id),
    passenger_name: clean(row?.passenger_name) || "Customer",
    amount: num(row?.takeout_items_subtotal),
    outcome: isVendorTimeoutDecision(row) ? "Vendor timeout" : "Vendor rejected",
    reason: vendorCancellationReason(row) || "No reason recorded",
    order_placed_at: row?.created_at || null,
    missed_at: recordedAt,
    date_is_exact: Boolean(exactAt),
  };
}

export async function GET(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get("days") || 30)));
  const requestedVendorId = clean(req.nextUrl.searchParams.get("vendor_id"));
  const nowMs = Date.now();
  const requestedStartMs = nowMs - days * DAY_MS;

  let vendorsQuery = admin
    .from("vendor_accounts")
    .select("id,email,display_name,town,accepting_orders,created_at,performance_metrics_started_at")
    .order("display_name", { ascending: true });
  if (requestedVendorId) vendorsQuery = vendorsQuery.eq("id", requestedVendorId);
  const vendorsRes = await vendorsQuery;
  if (vendorsRes.error) return json(500, { ok: false, error: "VENDORS_READ_FAILED", message: vendorsRes.error.message });

  const vendors = Array.isArray(vendorsRes.data) ? vendorsRes.data : [];
  const vendorIds = vendors.map((v: any) => clean(v?.id)).filter(Boolean);
  if (!vendorIds.length) {
    return json(200, {
      ok: true,
      days,
      generated_at: new Date(nowMs).toISOString(),
      online_fresh_seconds: ONLINE_FRESH_MS / 1000,
      vendors: [],
      exclusions: { test_accounts: [], bookings: [] },
    });
  }

  const earliestCutoff = Math.min(
    ...vendors.map((v: any) => ts(v?.performance_metrics_started_at) || nowMs)
  );
  const queryStartMs = Math.min(requestedStartMs, earliestCutoff);

  const [bookingsRes, presenceRes, ratingsRes, testAccountsRes, bookingExclusionsRes] = await Promise.all([
    admin
      .from("bookings")
      .select("id,booking_code,vendor_id,created_by_user_id,passenger_name,service_type,status,vendor_status,customer_status,created_at,updated_at,completed_at,vendor_responded_at,vendor_accepted_at,vendor_rejected_at,vendor_timeout_at,vendor_cancel_reason,cancel_reason,takeout_items_subtotal")
      .eq("service_type", "takeout")
      .in("vendor_id", vendorIds)
      .gte("created_at", new Date(queryStartMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(20000),
    admin
      .from("vendor_presence_minutes")
      .select("vendor_id,minute_started_at,last_seen_at,accepting_orders,client")
      .in("vendor_id", vendorIds)
      .gte("minute_started_at", new Date(queryStartMs).toISOString())
      .order("minute_started_at", { ascending: false })
      .limit(50000),
    admin
      .from("takeout_ratings")
      .select("id,booking_id,passenger_id,vendor_id,vendor_rating,created_at")
      .in("vendor_id", vendorIds)
      .gte("created_at", new Date(queryStartMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(20000),
    admin
      .from("analytics_test_accounts")
      .select("id,subject_type,subject_id,reason,active,marked_by,created_at,updated_at")
      .eq("active", true)
      .order("created_at", { ascending: false }),
    admin
      .from("analytics_booking_exclusions")
      .select("id,booking_id,reason,active,marked_by,created_at,updated_at")
      .eq("active", true)
      .order("created_at", { ascending: false }),
  ]);

  for (const result of [bookingsRes, presenceRes, ratingsRes, testAccountsRes, bookingExclusionsRes]) {
    if (result.error) {
      return json(500, { ok: false, error: "VENDOR_BEHAVIOR_READ_FAILED", message: result.error.message });
    }
  }

  const bookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];
  const presence = Array.isArray(presenceRes.data) ? presenceRes.data : [];
  const ratings = Array.isArray(ratingsRes.data) ? ratingsRes.data : [];
  const testAccounts = Array.isArray(testAccountsRes.data) ? testAccountsRes.data : [];
  const bookingExclusions = Array.isArray(bookingExclusionsRes.data) ? bookingExclusionsRes.data : [];

  const testPassengerIds = new Set(
    testAccounts
      .filter((r: any) => clean(r?.subject_type) === "passenger_user")
      .map((r: any) => clean(r?.subject_id))
      .filter(Boolean)
  );
  const excludedBookingIds = new Set(
    bookingExclusions.map((r: any) => clean(r?.booking_id)).filter(Boolean)
  );

  const testProfilesRes = testPassengerIds.size
    ? await admin.from("passenger_profiles").select("user_id,full_name,phone,email").in("user_id", Array.from(testPassengerIds))
    : ({ data: [], error: null } as any);
  const profileById = new Map<string, any>();
  if (!testProfilesRes.error && Array.isArray(testProfilesRes.data)) {
    for (const row of testProfilesRes.data) profileById.set(clean(row?.user_id), row);
  }

  const excludedBookingDetailsRes = excludedBookingIds.size
    ? await admin.from("bookings").select("id,booking_code,passenger_name,vendor_id,created_at").in("id", Array.from(excludedBookingIds))
    : ({ data: [], error: null } as any);
  const excludedBookingById = new Map<string, any>();
  if (!excludedBookingDetailsRes.error && Array.isArray(excludedBookingDetailsRes.data)) {
    for (const row of excludedBookingDetailsRes.data) excludedBookingById.set(clean(row?.id), row);
  }

  const behaviorRows = vendors.map((vendor: any) => {
    const vendorId = clean(vendor?.id);
    const cutoffMs = ts(vendor?.performance_metrics_started_at) || nowMs;
    const rangeStartMs = Math.max(cutoffMs, requestedStartMs);

    const vendorBookings = bookings.filter((row: any) => {
      if (clean(row?.vendor_id) !== vendorId) return false;
      if (ts(row?.created_at) < rangeStartMs) return false;
      if (excludedBookingIds.has(clean(row?.id))) return false;
      if (testPassengerIds.has(clean(row?.created_by_user_id))) return false;
      return true;
    });

    const vendorPresence = presence.filter((row: any) => {
      return clean(row?.vendor_id) === vendorId && ts(row?.minute_started_at) >= rangeStartMs;
    });

    const latestPresence = [...vendorPresence].sort((a, b) => ts(b?.last_seen_at) - ts(a?.last_seen_at))[0] || null;
    const lastSeenMs = ts(latestPresence?.last_seen_at);
    const acceptingOrders = vendor?.accepting_orders === true;
    const currentState = !acceptingOrders
      ? "closed"
      : lastSeenMs >= nowMs - ONLINE_FRESH_MS
        ? "online"
        : "open_but_offline";

    const range = orderStats(vendorBookings);
    const today = orderStats(rowsInWindow(vendorBookings, manilaDayStart(nowMs), nowMs + 1));
    const last7 = orderStats(rowsInWindow(vendorBookings, nowMs - 7 * DAY_MS, nowMs + 1));
    const last30 = orderStats(rowsInWindow(vendorBookings, nowMs - 30 * DAY_MS, nowMs + 1));

    const onlineMinutes = vendorPresence.length;
    const openMinutes = vendorPresence.filter((row: any) => row?.accepting_orders === true).length;
    const openButOfflineMinutes = 0;

    const bookingIds = new Set(vendorBookings.map((row: any) => clean(row?.id)));
    const vendorRatings = ratings
      .filter((row: any) => {
        if (clean(row?.vendor_id) !== vendorId) return false;
        if (ts(row?.created_at) < rangeStartMs) return false;
        if (testPassengerIds.has(clean(row?.passenger_id))) return false;
        const bookingId = clean(row?.booking_id);
        return bookingId && bookingIds.has(bookingId) && !excludedBookingIds.has(bookingId);
      })
      .map((row: any) => num(row?.vendor_rating))
      .filter((value: number) => value >= 1 && value <= 5);

    const missed = vendorBookings
      .filter((row: any) => vendorDecision(row) === "unaccepted")
      .sort((a: any, b: any) => vendorDecisionTimestamp(b) - vendorDecisionTimestamp(a))
      .slice(0, 20)
      .map(missedOrder);

    return {
      vendor_id: vendorId,
      display_name: clean(vendor?.display_name) || clean(vendor?.email) || vendorId,
      email: clean(vendor?.email) || null,
      town: clean(vendor?.town) || null,
      accepting_orders: acceptingOrders,
      metrics_started_at: vendor?.performance_metrics_started_at,
      current_state: currentState,
      last_seen_at: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
      last_seen_age_seconds: lastSeenMs ? Math.max(0, Math.round((nowMs - lastSeenMs) / 1000)) : null,
      presence_client: clean(latestPresence?.client) || null,
      range: {
        days,
        starts_at: new Date(rangeStartMs).toISOString(),
        ...range,
        online_minutes: onlineMinutes,
        online_hours: round1(onlineMinutes / 60),
        open_minutes: openMinutes,
        open_hours: round1(openMinutes / 60),
        open_but_offline_minutes: openButOfflineMinutes,
        open_but_offline_hours: 0,
        orders_per_online_hour: onlineMinutes > 0 ? round1(range.offered / (onlineMinutes / 60)) : null,
      },
      today,
      last_7_days: last7,
      last_30_days: last30,
      averages: {
        daily: averagePeriod(vendorBookings, vendorPresence, rangeStartMs, nowMs, "day"),
        weekly: averagePeriod(vendorBookings, vendorPresence, rangeStartMs, nowMs, "week"),
        monthly: averagePeriod(vendorBookings, vendorPresence, rangeStartMs, nowMs, "month"),
      },
      survey: {
        responses: vendorRatings.length,
        average: vendorRatings.length ? round1(vendorRatings.reduce((a: number, b: number) => a + b, 0) / vendorRatings.length) : null,
      },
      recent_missed_orders: missed,
    };
  });

  return json(200, {
    ok: true,
    days,
    generated_at: new Date(nowMs).toISOString(),
    online_fresh_seconds: ONLINE_FRESH_MS / 1000,
    vendors: behaviorRows,
    exclusions: {
      test_accounts: testAccounts.map((row: any) => {
        const profile = profileById.get(clean(row?.subject_id));
        return {
          ...row,
          full_name: clean(profile?.full_name) || null,
          phone: clean(profile?.phone) || null,
          email: clean(profile?.email) || null,
        };
      }),
      bookings: bookingExclusions.map((row: any) => {
        const detail = excludedBookingById.get(clean(row?.booking_id));
        return {
          ...row,
          booking_code: clean(detail?.booking_code) || null,
          passenger_name: clean(detail?.passenger_name) || null,
          vendor_id: clean(detail?.vendor_id) || null,
          booking_created_at: detail?.created_at || null,
        };
      }),
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
      return json(400, { ok: false, error: "INVALID_PASSENGER_USER_ID", message: "A valid passenger user UUID is required." });
    }
    const result = await admin.from("analytics_test_accounts").upsert({
      subject_type: "passenger_user",
      subject_id: subjectId,
      reason,
      active: action === "exclude_passenger",
      marked_by: markedBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: "subject_type,subject_id" });
    if (result.error) return json(500, { ok: false, error: "TEST_ACCOUNT_WRITE_FAILED", message: result.error.message });
    return json(200, { ok: true, action, subject_id: subjectId, active: action === "exclude_passenger" });
  }

  if (action === "exclude_booking" || action === "include_booking") {
    const bookingId = clean(body?.booking_id);
    if (!isUuid(bookingId)) {
      return json(400, { ok: false, error: "INVALID_BOOKING_ID", message: "A valid booking UUID is required." });
    }
    const result = await admin.from("analytics_booking_exclusions").upsert({
      booking_id: bookingId,
      reason,
      active: action === "exclude_booking",
      marked_by: markedBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: "booking_id" });
    if (result.error) return json(500, { ok: false, error: "BOOKING_EXCLUSION_WRITE_FAILED", message: result.error.message });
    return json(200, { ok: true, action, booking_id: bookingId, active: action === "exclude_booking" });
  }

  return json(400, {
    ok: false,
    error: "INVALID_ACTION",
    message: "Supported actions: exclude_passenger, include_passenger, exclude_booking, include_booking.",
  });
}
