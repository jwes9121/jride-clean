import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function ts(value: unknown): number {
  const n = new Date(String(value || "")).getTime();
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

function completionTime(row: any): number {
  return ts(row?.completed_at) || ts(row?.updated_at) || ts(row?.created_at);
}

function fareValue(row: any): number {
  const service = clean(row?.service_type).toLowerCase();
  if (service === "takeout") {
    return num(row?.takeout_total_payable) || num(row?.takeout_delivery_fee) || num(row?.verified_fare) || num(row?.proposed_fare);
  }
  return num(row?.verified_fare) || num(row?.proposed_fare);
}

export async function GET(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const range = clean(req.nextUrl.searchParams.get("range") || "month").toLowerCase();
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const service = clean(req.nextUrl.searchParams.get("service") || "all").toLowerCase();
  const town = clean(req.nextUrl.searchParams.get("town"));
  const query = clean(req.nextUrl.searchParams.get("q")).toLowerCase();
  const startMs = rangeStart(range, days);
  const querySince = new Date(startMs - 2 * DAY_MS).toISOString();

  const [bookingsRes, testAccountsRes, bookingExclusionsRes] = await Promise.all([
    admin
      .from("bookings")
      .select(
        "id,booking_code,service_type,status,town,created_at,updated_at,completed_at,assigned_driver_id,driver_id,passenger_name,from_label,to_label,verified_fare,proposed_fare,takeout_items_subtotal,takeout_delivery_fee,takeout_total_payable,company_cut,driver_payout,vendor_id,created_by_user_id"
      )
      .eq("status", "completed")
      .gte("created_at", querySince)
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(10000),
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
    return json(500, { ok: false, error: "BOOKINGS_READ_FAILED", message: bookingsRes.error.message });
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
      ? bookingExclusionsRes.data.map((row: any) => clean(row?.booking_id)).filter(Boolean)
      : []
  );

  let rows = (Array.isArray(bookingsRes.data) ? bookingsRes.data : []).filter((row: any) => {
    const completedMs = completionTime(row);
    if (!completedMs || completedMs < startMs) return false;
    if (service !== "all" && clean(row?.service_type).toLowerCase() !== service) return false;
    if (town && clean(row?.town).toLowerCase() !== town.toLowerCase()) return false;
    if (excludedBookingIds.has(clean(row?.id))) return false;
    if (testPassengerIds.has(clean(row?.created_by_user_id))) return false;
    if (clean(row?.vendor_id) === TEST_VENDOR_ID) return false;
    return true;
  });

  const driverIds = Array.from(new Set(rows.map((row: any) => clean(row?.assigned_driver_id || row?.driver_id)).filter(Boolean)));
  const vendorIds = Array.from(new Set(rows.map((row: any) => clean(row?.vendor_id)).filter(Boolean)));

  const [driverRes, vendorRes] = await Promise.all([
    driverIds.length
      ? admin.from("driver_profiles").select("driver_id,full_name,callsign").in("driver_id", driverIds)
      : Promise.resolve({ data: [], error: null } as any),
    vendorIds.length
      ? admin.from("vendor_accounts").select("id,display_name,email").in("id", vendorIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const driverById = new Map<string, any>();
  for (const row of !driverRes.error && Array.isArray(driverRes.data) ? driverRes.data : []) {
    driverById.set(clean(row?.driver_id), row);
  }
  const vendorById = new Map<string, any>();
  for (const row of !vendorRes.error && Array.isArray(vendorRes.data) ? vendorRes.data : []) {
    vendorById.set(clean(row?.id), row);
  }

  const output = rows.map((row: any) => {
    const driverId = clean(row?.assigned_driver_id || row?.driver_id);
    const driver = driverById.get(driverId);
    const vendor = vendorById.get(clean(row?.vendor_id));
    return {
      id: clean(row?.id),
      booking_code: clean(row?.booking_code) || clean(row?.id),
      service_type: clean(row?.service_type).toLowerCase() === "takeout" ? "takeout" : "ride",
      town: clean(row?.town) || null,
      passenger_name: clean(row?.passenger_name) || "Passenger",
      driver_id: driverId || null,
      driver_name: clean(driver?.full_name || driver?.callsign) || null,
      vendor_id: clean(row?.vendor_id) || null,
      vendor_name: clean(vendor?.display_name || vendor?.email) || null,
      pickup: clean(row?.from_label) || null,
      dropoff: clean(row?.to_label) || null,
      created_at: row?.created_at || null,
      completed_at: row?.completed_at || row?.updated_at || null,
      fare: fareValue(row),
      company_cut: num(row?.company_cut),
      driver_payout: num(row?.driver_payout),
      takeout_items_subtotal: num(row?.takeout_items_subtotal),
      takeout_delivery_fee: num(row?.takeout_delivery_fee),
    };
  });

  if (query) {
    rows = [];
  }

  const filtered = query
    ? output.filter((row: any) =>
        [row.booking_code, row.passenger_name, row.driver_name, row.vendor_name, row.town]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
    : output;

  const summary = filtered.reduce(
    (acc: any, row: any) => {
      acc.total += 1;
      if (row.service_type === "takeout") acc.takeout += 1;
      else acc.ride += 1;
      acc.gross += num(row.fare);
      acc.company_cut += num(row.company_cut);
      acc.driver_payout += num(row.driver_payout);
      return acc;
    },
    { total: 0, ride: 0, takeout: 0, gross: 0, company_cut: 0, driver_payout: 0 }
  );

  return json(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    range,
    starts_at: new Date(startMs).toISOString(),
    service,
    town: town || null,
    summary,
    tickets: filtered,
  });
}
