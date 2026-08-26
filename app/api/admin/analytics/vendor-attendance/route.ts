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

function dateKey(ms: number): string {
  return new Date(ms + PHT_OFFSET_MS).toISOString().slice(0, 10);
}

function periodStart(range: string, days: number): number {
  const now = Date.now();
  if (range === "today") return manilaDayStart(now);
  if (range === "week") return manilaWeekStart(now);
  if (range === "month") return manilaMonthStart(now);
  return now - Math.max(1, Math.min(365, days)) * DAY_MS;
}

function statusGroup(value: unknown): string {
  const status = clean(value).toLowerCase();
  if (status === "batch2") return "batch2";
  if (status === "removed_from_pilot") return "removed";
  return "pilot_active";
}

export async function GET(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const range = clean(req.nextUrl.searchParams.get("range") || "month").toLowerCase();
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const group = clean(req.nextUrl.searchParams.get("group") || "pilot_active").toLowerCase();
  const town = clean(req.nextUrl.searchParams.get("town"));
  const query = clean(req.nextUrl.searchParams.get("q")).toLowerCase();
  const startMs = periodStart(range, days);
  const startDate = dateKey(startMs);

  const [vendorsRes, attendanceRes, registryRes] = await Promise.all([
    admin
      .from("vendor_accounts")
      .select("id,display_name,email,town,normal_open_time,normal_close_time,hours_enforced,vendor_compliance_started_on,consecutive_offline_days,suspended_until,suspension_reason")
      .order("display_name", { ascending: true }),
    admin
      .from("vendor_daily_attendance")
      .select("vendor_id,attendance_date,opened_at,first_seen_at,last_seen_at,online_minutes,source")
      .gte("attendance_date", startDate)
      .order("attendance_date", { ascending: false })
      .limit(30000),
    admin
      .from("vendor_onboarding_credentials")
      .select("vendor_id,status"),
  ]);

  if (vendorsRes.error) {
    return json(500, { ok: false, error: "VENDORS_READ_FAILED", message: vendorsRes.error.message });
  }
  if (attendanceRes.error) {
    return json(500, { ok: false, error: "ATTENDANCE_READ_FAILED", message: attendanceRes.error.message });
  }

  const registryByVendor = new Map<string, string>();
  for (const row of !registryRes.error && Array.isArray(registryRes.data) ? registryRes.data : []) {
    registryByVendor.set(clean(row?.vendor_id), clean(row?.status).toLowerCase());
  }

  const attendanceByVendor = new Map<string, any[]>();
  for (const row of Array.isArray(attendanceRes.data) ? attendanceRes.data : []) {
    const vendorId = clean(row?.vendor_id);
    if (!vendorId) continue;
    if (!attendanceByVendor.has(vendorId)) attendanceByVendor.set(vendorId, []);
    attendanceByVendor.get(vendorId)!.push(row);
  }

  const now = Date.now();
  const todayStart = manilaDayStart(now);
  const weekStart = manilaWeekStart(now);
  const monthStart = manilaMonthStart(now);
  const todayKey = dateKey(todayStart);
  const weekKey = dateKey(weekStart);
  const monthKey = dateKey(monthStart);

  const vendors = (Array.isArray(vendorsRes.data) ? vendorsRes.data : [])
    .filter((vendor: any) => clean(vendor?.id) !== TEST_VENDOR_ID)
    .map((vendor: any) => {
      const vendorId = clean(vendor?.id);
      const onboardingStatus = registryByVendor.get(vendorId) || "";
      const vendorGroup = statusGroup(onboardingStatus);
      const rows = attendanceByVendor.get(vendorId) || [];

      const summarize = (fromDate: string) => {
        const periodRows = rows.filter((row: any) => clean(row?.attendance_date) >= fromDate);
        const onlineMinutes = periodRows.reduce((sum: number, row: any) => sum + Number(row?.online_minutes || 0), 0);
        const openedDays = periodRows.filter((row: any) => row?.opened_at || Number(row?.online_minutes || 0) > 0).length;
        return {
          attendance_days: openedDays,
          online_minutes: onlineMinutes,
          online_hours: Math.round((onlineMinutes / 60) * 100) / 100,
        };
      };

      return {
        vendor_id: vendorId,
        display_name: clean(vendor?.display_name || vendor?.email || vendorId),
        email: clean(vendor?.email) || null,
        town: clean(vendor?.town) || null,
        onboarding_status: onboardingStatus || null,
        vendor_group: vendorGroup,
        normal_open_time: vendor?.normal_open_time || null,
        normal_close_time: vendor?.normal_close_time || null,
        hours_enforced: vendor?.hours_enforced === true,
        compliance_started_on: vendor?.vendor_compliance_started_on || null,
        consecutive_offline_days: Number(vendor?.consecutive_offline_days || 0),
        suspended_until: vendor?.suspended_until || null,
        suspension_reason: clean(vendor?.suspension_reason) || null,
        selected_range: summarize(startDate),
        today: summarize(todayKey),
        this_week: summarize(weekKey),
        this_month: summarize(monthKey),
        daily: rows.map((row: any) => ({
          date: row?.attendance_date,
          opened_at: row?.opened_at || null,
          first_seen_at: row?.first_seen_at || null,
          last_seen_at: row?.last_seen_at || null,
          online_minutes: Number(row?.online_minutes || 0),
          online_hours: Math.round((Number(row?.online_minutes || 0) / 60) * 100) / 100,
          source: clean(row?.source) || null,
        })),
      };
    })
    .filter((vendor: any) => {
      if (group !== "all" && vendor.vendor_group !== group) return false;
      if (town && clean(vendor.town).toLowerCase() !== town.toLowerCase()) return false;
      if (query) {
        const haystack = [vendor.display_name, vendor.email, vendor.town, vendor.vendor_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

  const summary = vendors.reduce(
    (acc: any, vendor: any) => {
      acc.vendors += 1;
      acc.attendance_days += vendor.selected_range.attendance_days;
      acc.online_minutes += vendor.selected_range.online_minutes;
      if (vendor.today.attendance_days > 0) acc.opened_today += 1;
      return acc;
    },
    { vendors: 0, opened_today: 0, attendance_days: 0, online_minutes: 0 }
  );
  summary.online_hours = Math.round((summary.online_minutes / 60) * 100) / 100;

  return json(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    range,
    starts_on: startDate,
    group,
    summary,
    vendors,
  });
}
