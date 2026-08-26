import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { vendorTimeoutDisplay } from "@/lib/vendorTimeoutDisplay";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_VENDOR_ID = "11111111-1111-1111-1111-111111111111";

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
  const shifted = new Date(dayStart + PHT_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return dayStart - daysSinceMonday * DAY_MS;
}

function manilaMonthStart(ms: number): number {
  const shifted = new Date(ms + PHT_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - PHT_OFFSET_MS;
}

function rangeStart(range: string, days: number): number {
  const now = Date.now();
  if (range === "today") return manilaDayStart(now);
  if (range === "week") return manilaWeekStart(now);
  if (range === "month") return manilaMonthStart(now);
  return now - Math.max(1, Math.min(365, days)) * DAY_MS;
}

function normalizedService(row: any): "ride" | "takeout" | "other" {
  const service = clean(row?.service_type).toLowerCase();
  if (service === "takeout") return "takeout";
  if (["ride", "motorcycle", "tricycle"].includes(service)) return "ride";
  return "other";
}

function isTerminalFailure(row: any): boolean {
  const status = clean(row?.status).toLowerCase();
  const vendorStatus = clean(row?.vendor_status).toLowerCase();
  return (
    ["cancelled", "canceled", "expired"].includes(status) ||
    ["cancelled", "canceled", "vendor_timeout"].includes(vendorStatus)
  );
}

function isVendorTimeout(row: any): boolean {
  const vendorStatus = clean(row?.vendor_status).toLowerCase();
  const reason = clean(row?.vendor_cancel_reason || row?.cancel_reason).toLowerCase();
  return (
    vendorStatus === "vendor_timeout" ||
    reason.includes("did not respond within") ||
    reason.includes("vendor timeout")
  );
}

function failureTiming(row: any) {
  if (normalizedService(row) === "takeout" && isVendorTimeout(row)) {
    const timing = vendorTimeoutDisplay(row);
    return {
      event_at: timing.displayed_at,
      event_time_label: timing.time_label,
      event_time_quality: timing.date_is_exact ? "exact" : "derived",
      event_time_note: timing.timestamp_note,
      expected_deadline_at: timing.expected_deadline_at,
      exact_event_at: timing.exact_event_at,
    };
  }

  const recorded = clean(row?.updated_at) || clean(row?.created_at) || null;
  return {
    event_at: recorded,
    event_time_label: "Recorded closed at",
    event_time_quality: "recorded",
    event_time_note:
      "The booking has no dedicated exact failure timestamp. JRide is showing the row's recorded update time.",
    expected_deadline_at: null,
    exact_event_at: null,
  };
}

function failureOutcome(row: any): string {
  const service = normalizedService(row);
  if (service === "takeout" && isVendorTimeout(row)) return "Vendor timeout";
  if (service === "takeout") {
    const vendorStatus = clean(row?.vendor_status).toLowerCase();
    if (["cancelled", "canceled"].includes(vendorStatus)) {
      return "Vendor rejected or cancelled";
    }
    return "Takeout cancelled";
  }

  const status = clean(row?.status).toLowerCase();
  return status === "expired" ? "Ride expired" : "Ride cancelled";
}

function failureReason(row: any): string {
  return (
    clean(row?.vendor_cancel_reason) ||
    clean(row?.cancel_reason) ||
    "No cancellation reason recorded"
  );
}

export async function GET(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const range = clean(req.nextUrl.searchParams.get("range") || "month").toLowerCase();
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const serviceFilter = clean(req.nextUrl.searchParams.get("service") || "all").toLowerCase();
  const town = clean(req.nextUrl.searchParams.get("town"));
  const query = clean(req.nextUrl.searchParams.get("q")).toLowerCase();
  const startMs = rangeStart(range, days);
  const querySince = new Date(startMs - 30 * DAY_MS).toISOString();

  const [bookingsRes, testAccountsRes, bookingExclusionsRes] = await Promise.all([
    admin
      .from("bookings")
      .select(
        "id,booking_code,service_type,status,vendor_status,customer_status,driver_status,takeout_pricing_status,town,created_at,updated_at,completed_at,assigned_driver_id,driver_id,passenger_name,from_label,to_label,verified_fare,proposed_fare,takeout_items_subtotal,takeout_delivery_fee,takeout_total_payable,company_cut,driver_payout,vendor_id,created_by_user_id,vendor_responded_at,vendor_accepted_at,vendor_rejected_at,vendor_timeout_at,vendor_cancel_reason,cancel_reason"
      )
      .gte("created_at", querySince)
      .order("created_at", { ascending: false })
      .limit(20000),
    admin
      .from("analytics_test_accounts")
      .select("subject_type,subject_id")
      .eq("active", true),
    admin
      .from("analytics_booking_exclusions")
      .select("booking_id")
      .eq("active", true),
  ]);

  if (bookingsRes.error) {
    return json(500, {
      ok: false,
      error: "BOOKINGS_READ_FAILED",
      message: bookingsRes.error.message,
    });
  }

  const testPassengerIds = new Set(
    !testAccountsRes.error && Array.isArray(testAccountsRes.data)
      ? testAccountsRes.data
          .filter((row: any) => clean(row?.subject_type) === "passenger_user")
          .map((row: any) => clean(row?.subject_id))
          .filter(Boolean)
      : []
  );

  const excludedBookingIds = new Set(
    !bookingExclusionsRes.error && Array.isArray(bookingExclusionsRes.data)
      ? bookingExclusionsRes.data
          .map((row: any) => clean(row?.booking_id))
          .filter(Boolean)
      : []
  );

  const eligible = (Array.isArray(bookingsRes.data) ? bookingsRes.data : []).filter(
    (row: any) => {
      const service = normalizedService(row);
      if (service === "other") return false;
      if (!isTerminalFailure(row)) return false;
      if (serviceFilter !== "all" && service !== serviceFilter) return false;
      if (town && clean(row?.town).toLowerCase() !== town.toLowerCase()) return false;
      if (excludedBookingIds.has(clean(row?.id))) return false;
      if (testPassengerIds.has(clean(row?.created_by_user_id))) return false;
      if (clean(row?.vendor_id) === TEST_VENDOR_ID) return false;

      const timing = failureTiming(row);
      const eventMs = timestamp(timing.event_at);
      return eventMs >= startMs;
    }
  );

  const driverIds = Array.from(
    new Set(
      eligible
        .map((row: any) => clean(row?.assigned_driver_id || row?.driver_id))
        .filter(Boolean)
    )
  );
  const vendorIds = Array.from(
    new Set(
      eligible.map((row: any) => clean(row?.vendor_id)).filter(Boolean)
    )
  );

  const [driverRes, vendorRes] = await Promise.all([
    driverIds.length
      ? admin
          .from("driver_profiles")
          .select("driver_id,full_name,callsign")
          .in("driver_id", driverIds)
      : Promise.resolve({ data: [], error: null } as any),
    vendorIds.length
      ? admin
          .from("vendor_accounts")
          .select("id,display_name,email")
          .in("id", vendorIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const driverById = new Map<string, any>();
  for (const row of !driverRes.error && Array.isArray(driverRes.data)
    ? driverRes.data
    : []) {
    driverById.set(clean(row?.driver_id), row);
  }

  const vendorById = new Map<string, any>();
  for (const row of !vendorRes.error && Array.isArray(vendorRes.data)
    ? vendorRes.data
    : []) {
    vendorById.set(clean(row?.id), row);
  }

  let tickets = eligible.map((row: any) => {
    const service = normalizedService(row);
    const timing = failureTiming(row);
    const driverId = clean(row?.assigned_driver_id || row?.driver_id);
    const driver = driverById.get(driverId);
    const vendor = vendorById.get(clean(row?.vendor_id));

    return {
      id: clean(row?.id),
      booking_code: clean(row?.booking_code) || clean(row?.id),
      service_type: service,
      vehicle_type:
        service === "ride" ? clean(row?.service_type).toLowerCase() : null,
      town: clean(row?.town) || null,
      passenger_name: clean(row?.passenger_name) || "Passenger",
      driver_id: driverId || null,
      driver_name: clean(driver?.full_name || driver?.callsign) || null,
      vendor_id: clean(row?.vendor_id) || null,
      vendor_name: clean(vendor?.display_name || vendor?.email) || null,
      pickup: clean(row?.from_label) || null,
      dropoff: clean(row?.to_label) || null,
      placed_at: row?.created_at || null,
      ...timing,
      outcome: failureOutcome(row),
      reason: failureReason(row),
      status: clean(row?.status) || null,
      vendor_status: clean(row?.vendor_status) || null,
      customer_status: clean(row?.customer_status) || null,
      driver_status: clean(row?.driver_status) || null,
      takeout_pricing_status: clean(row?.takeout_pricing_status) || null,
      amount:
        service === "takeout"
          ? numberValue(row?.takeout_items_subtotal)
          : numberValue(row?.verified_fare || row?.proposed_fare),
      assigned_driver: Boolean(driverId),
    };
  });

  if (query) {
    tickets = tickets.filter((row: any) =>
      [
        row.booking_code,
        row.passenger_name,
        row.driver_name,
        row.vendor_name,
        row.town,
        row.outcome,
        row.reason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }

  tickets.sort(
    (a: any, b: any) => timestamp(b?.event_at) - timestamp(a?.event_at)
  );

  const summary = tickets.reduce(
    (acc: any, row: any) => {
      acc.total += 1;
      if (row.service_type === "takeout") acc.takeout += 1;
      else acc.ride += 1;
      if (row.outcome === "Vendor timeout") acc.vendor_timeouts += 1;
      if (row.reason === "No cancellation reason recorded") acc.no_reason += 1;
      if (row.event_time_quality === "exact") acc.exact_times += 1;
      if (row.event_time_quality === "derived") acc.derived_deadlines += 1;
      return acc;
    },
    {
      total: 0,
      ride: 0,
      takeout: 0,
      vendor_timeouts: 0,
      no_reason: 0,
      exact_times: 0,
      derived_deadlines: 0,
    }
  );

  return json(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    range,
    starts_at: new Date(startMs).toISOString(),
    service: serviceFilter,
    town: town || null,
    summary,
    tickets,
  });
}
