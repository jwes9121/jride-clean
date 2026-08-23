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

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function stats(rows: any[]) {
  const accepted = rows.filter((row) => vendorDecision(row) === "accepted");
  const unaccepted = rows.filter((row) => vendorDecision(row) === "unaccepted");
  const pending = rows.filter((row) => vendorDecision(row) === "pending");
  const completed = rows.filter(isCompletedTakeoutOrder);
  const responses = rows
    .map(vendorResponseSeconds)
    .filter((value): value is number => value !== null && value >= 0);
  const decisions = accepted.length + unaccepted.length;

  return {
    offered: rows.length,
    accepted: accepted.length,
    completed: completed.length,
    accepted_not_completed: accepted.filter((row) => !isCompletedTakeoutOrder(row)).length,
    unaccepted: unaccepted.length,
    timed_out: unaccepted.filter(isVendorTimeoutDecision).length,
    rejected: unaccepted.filter((row) => !isVendorTimeoutDecision(row)).length,
    pending: pending.length,
    acceptance_rate: decisions ? round1((accepted.length / decisions) * 100) : null,
    average_response_seconds: responses.length
      ? Math.round(responses.reduce((sum, value) => sum + value, 0) / responses.length)
      : null,
  };
}

function missedOrder(row: any) {
  const exactAt = clean(row?.vendor_timeout_at) || clean(row?.vendor_rejected_at) || "";
  const missedAt = exactAt || clean(row?.vendor_responded_at) || clean(row?.updated_at) || clean(row?.created_at) || null;

  return {
    id: clean(row?.id),
    booking_code: clean(row?.booking_code) || clean(row?.id),
    customer_name: clean(row?.passenger_name) || "Customer",
    amount: numberValue(row?.takeout_items_subtotal),
    outcome: isVendorTimeoutDecision(row) ? "Vendor timeout" : "Vendor rejected",
    reason: vendorCancellationReason(row) || "No reason recorded",
    order_placed_at: row?.created_at || null,
    missed_at: missedAt,
    date_is_exact: Boolean(exactAt),
  };
}

export async function GET(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const vendorId = clean(req.nextUrl.searchParams.get("vendor_id"));
  const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get("days") || 30)));
  if (!vendorId) {
    return json(400, { ok: false, error: "VENDOR_ID_REQUIRED", message: "vendor_id is required." });
  }

  const vendorRes = await admin
    .from("vendor_accounts")
    .select("id,display_name,email,town,accepting_orders,performance_metrics_started_at")
    .eq("id", vendorId)
    .limit(1)
    .maybeSingle();

  if (vendorRes.error) {
    return json(500, { ok: false, error: "VENDOR_READ_FAILED", message: vendorRes.error.message });
  }
  if (!vendorRes.data) return json(404, { ok: false, error: "VENDOR_NOT_FOUND" });

  const nowMs = Date.now();
  const cutoffMs = timestamp(vendorRes.data.performance_metrics_started_at) || nowMs;
  const rangeStartMs = Math.max(cutoffMs, nowMs - days * DAY_MS);
  const rangeStartIso = new Date(rangeStartMs).toISOString();

  const [bookingsRes, testAccountsRes, bookingExclusionsRes, ratingsRes, presenceRes] = await Promise.all([
    admin
      .from("bookings")
      .select("id,booking_code,vendor_id,created_by_user_id,passenger_name,service_type,status,vendor_status,customer_status,created_at,updated_at,completed_at,vendor_responded_at,vendor_accepted_at,vendor_rejected_at,vendor_timeout_at,vendor_cancel_reason,cancel_reason,takeout_items_subtotal")
      .eq("service_type", "takeout")
      .eq("vendor_id", vendorId)
      .gte("created_at", rangeStartIso)
      .order("created_at", { ascending: false })
      .limit(5000),
    admin.from("analytics_test_accounts").select("subject_type,subject_id").eq("active", true),
    admin.from("analytics_booking_exclusions").select("booking_id").eq("active", true),
    admin
      .from("takeout_ratings")
      .select("id,booking_id,passenger_id,vendor_id,vendor_rating,created_at")
      .eq("vendor_id", vendorId)
      .gte("created_at", rangeStartIso)
      .order("created_at", { ascending: false })
      .limit(5000),
    admin
      .from("vendor_presence_minutes")
      .select("minute_started_at,last_seen_at,accepting_orders,client")
      .eq("vendor_id", vendorId)
      .gte("minute_started_at", rangeStartIso)
      .order("minute_started_at", { ascending: false })
      .limit(50000),
  ]);

  for (const result of [bookingsRes, testAccountsRes, bookingExclusionsRes, ratingsRes, presenceRes]) {
    if (result.error) {
      return json(500, { ok: false, error: "VENDOR_SUMMARY_READ_FAILED", message: result.error.message });
    }
  }

  const testPassengerIds = new Set(
    (Array.isArray(testAccountsRes.data) ? testAccountsRes.data : [])
      .filter((row: any) => clean(row?.subject_type) === "passenger_user")
      .map((row: any) => clean(row?.subject_id))
      .filter(Boolean)
  );
  const excludedBookingIds = new Set(
    (Array.isArray(bookingExclusionsRes.data) ? bookingExclusionsRes.data : [])
      .map((row: any) => clean(row?.booking_id))
      .filter(Boolean)
  );

  const bookings = (Array.isArray(bookingsRes.data) ? bookingsRes.data : []).filter(
    (row: any) =>
      !testPassengerIds.has(clean(row?.created_by_user_id)) &&
      !excludedBookingIds.has(clean(row?.id))
  );
  const bookingById = new Map(bookings.map((row: any) => [clean(row?.id), row] as const));

  const ratingValues = (Array.isArray(ratingsRes.data) ? ratingsRes.data : [])
    .filter((row: any) => {
      if (testPassengerIds.has(clean(row?.passenger_id))) return false;
      const bookingId = clean(row?.booking_id);
      if (!bookingId || excludedBookingIds.has(bookingId)) return false;
      const booking = bookingById.get(bookingId);
      return booking ? isCompletedTakeoutOrder(booking) : false;
    })
    .map((row: any) => numberValue(row?.vendor_rating))
    .filter((value: number) => value >= 1 && value <= 5);

  const presence = Array.isArray(presenceRes.data) ? presenceRes.data : [];
  const latestPresence = presence[0] || null;
  const lastSeenMs = timestamp(latestPresence?.last_seen_at);
  const heartbeatFresh = lastSeenMs >= nowMs - ONLINE_FRESH_MS;
  const acceptingOrders = vendorRes.data.accepting_orders === true;
  const currentState = !acceptingOrders ? "closed" : heartbeatFresh ? "online" : "open_but_offline";

  const orderStats = stats(bookings);
  const missed = bookings
    .filter((row: any) => vendorDecision(row) === "unaccepted")
    .sort((a: any, b: any) => vendorDecisionTimestamp(b) - vendorDecisionTimestamp(a))
    .slice(0, 50)
    .map(missedOrder);

  return json(200, {
    ok: true,
    vendor: {
      vendor_id: vendorId,
      display_name: clean(vendorRes.data.display_name) || clean(vendorRes.data.email) || vendorId,
      town: clean(vendorRes.data.town) || null,
      metrics_started_at: vendorRes.data.performance_metrics_started_at,
      days,
      current_state: currentState,
      last_seen_at: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
      presence_client: clean(latestPresence?.client) || null,
      online_hours: round1(presence.length / 60),
      ...orderStats,
      survey_responses: ratingValues.length,
      survey_average: ratingValues.length
        ? round1(ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length)
        : null,
      missed_orders: missed,
    },
  });
}
