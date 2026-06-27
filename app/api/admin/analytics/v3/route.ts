import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function s(v: any) {
  return String(v ?? "").trim();
}

function n(v: any) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function dateKey(value: any) {
  const d = new Date(String(value || ""));
  if (!Number.isFinite(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

function weekKey(value: any) {
  const d = new Date(String(value || ""));
  if (!Number.isFinite(d.getTime())) return "unknown";
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function monthKey(value: any) {
  const d = new Date(String(value || ""));
  if (!Number.isFinite(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 7);
}

function normStatus(value: any) {
  const x = s(value).toLowerCase();
  if (!x || x === "pending") return "requested";
  if (x === "canceled") return "cancelled";
  return x;
}

function serviceType(row: any) {
  return s(row?.service_type).toLowerCase() === "takeout" ? "takeout" : "ride";
}

function isCompleted(row: any) {
  return normStatus(row?.status) === "completed";
}

function isCancelled(row: any) {
  return normStatus(row?.status) === "cancelled";
}

function isActive(row: any) {
  const st = normStatus(row?.status);
  return st !== "completed" && st !== "cancelled";
}

function addBucket(map: Record<string, any>, key: string) {
  if (!map[key]) {
    map[key] = {
      key,
      total: 0,
      ride_total: 0,
      takeout_total: 0,
      completed: 0,
      cancelled: 0,
      active: 0,
      revenue: 0,
      driver_payout: 0,
      company_cut: 0,
    };
  }
  return map[key];
}

function addBookingStats(bucket: any, row: any) {
  const svc = serviceType(row);
  bucket.total += 1;
  if (svc === "takeout") bucket.takeout_total += 1;
  else bucket.ride_total += 1;

  if (isCompleted(row)) bucket.completed += 1;
  else if (isCancelled(row)) bucket.cancelled += 1;
  else bucket.active += 1;

  bucket.revenue += n(row?.verified_fare) || n(row?.takeout_total_payable) || n(row?.proposed_fare);
  bucket.driver_payout += n(row?.driver_payout);
  bucket.company_cut += n(row?.company_cut);
}

function sessionMinutes(row: any) {
  const start = new Date(String(row?.login_at || row?.created_at || "")).getTime();
  const end = new Date(String(row?.logout_at || row?.last_seen_at || row?.updated_at || "")).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 60000);
}

export async function GET(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get("days") || 90)));
  const driverIdFilter = s(req.nextUrl.searchParams.get("driver_id"));
  const since = isoDaysAgo(days);

  const bookingsRes = await admin
    .from("bookings")
    .select("id,booking_code,service_type,status,vendor_status,customer_status,driver_status,takeout_pricing_status,town,created_at,updated_at,completed_at,assigned_driver_id,driver_id,passenger_name,from_label,to_label,verified_fare,proposed_fare,takeout_total_payable,takeout_delivery_fee,company_cut,driver_payout")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (bookingsRes.error) {
    return json(500, { ok: false, error: "BOOKINGS_READ_FAILED", message: bookingsRes.error.message });
  }

  const sessionsRes = await admin
    .from("driver_presence_sessions")
    .select("id,driver_id,driver_name,town,status,login_at,logout_at,last_seen_at,source,device_id,created_at,updated_at")
    .gte("login_at", since)
    .order("login_at", { ascending: false })
    .limit(5000);

  if (sessionsRes.error) {
    return json(500, { ok: false, error: "SESSIONS_READ_FAILED", message: sessionsRes.error.message });
  }

  const locationsRes = await admin
    .from("driver_locations")
    .select("driver_id,lat,lng,status,town,home_town,updated_at,vehicle_type")
    .order("updated_at", { ascending: false })
    .limit(1000);

  const bookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];
  const sessions = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
  const locations = !locationsRes.error && Array.isArray(locationsRes.data) ? locationsRes.data : [];

  const allDriverIds = Array.from(new Set([
    ...bookings.map((row: any) => s(row?.assigned_driver_id || row?.driver_id)).filter(Boolean),
    ...sessions.map((row: any) => s(row?.driver_id)).filter(Boolean),
    ...locations.map((row: any) => s(row?.driver_id)).filter(Boolean),
  ]));

  const driverIdentityById: Record<string, any> = {};

  if (allDriverIds.length > 0) {
    const driverIdentityRes = await admin
      .from("drivers")
      .select("id,driver_name,driver_status,zone_id,toda_name")
      .in("id", allDriverIds);

    if (!driverIdentityRes.error && Array.isArray(driverIdentityRes.data)) {
      for (const row of driverIdentityRes.data as any[]) {
        const did = s(row?.id);
        if (!did) continue;
        driverIdentityById[did] = {
          ...(driverIdentityById[did] || {}),
          driver_name: driverDisplayName(did, row?.driver_name),
          driver_status_master: s(row?.driver_status) || null,
          zone_id: row?.zone_id || null,
          toda_name: s(row?.toda_name) || null,
        };
      }
    }

    const driverProfileRes = await admin
      .from("driver_profiles")
      .select("driver_id,full_name,phone")
      .in("driver_id", allDriverIds);

    if (!driverProfileRes.error && Array.isArray(driverProfileRes.data)) {
      for (const row of driverProfileRes.data as any[]) {
        const did = s(row?.driver_id);
        if (!did) continue;
        driverIdentityById[did] = {
          ...(driverIdentityById[did] || {}),
          profile_full_name: s(row?.full_name) || null,
          phone: s(row?.phone) || null,
        };
      }
    }
  }

  function driverDisplayName(driverId: string, fallback?: any) {
    const identity = driverIdentityById[driverId] || {};
    return s(identity.driver_name) || s(identity.profile_full_name) || s(fallback) || "Unknown Driver";
  }

  const summary = {
    total_bookings: bookings.length,
    completed: 0,
    cancelled: 0,
    active_uncompleted: 0,
    ride_completed: 0,
    takeout_completed: 0,
    ride_active: 0,
    takeout_active: 0,
    revenue: 0,
    driver_payout: 0,
    company_cut: 0,
    drivers_with_sessions: 0,
    total_login_sessions: sessions.length,
    total_login_minutes: 0,
    online_now: 0,
  };

  const daily: Record<string, any> = {};
  const weekly: Record<string, any> = {};
  const monthly: Record<string, any> = {};
  const towns: Record<string, any> = {};
  const drivers: Record<string, any> = {};

  for (const row of bookings as any[]) {
    if (isCompleted(row)) summary.completed += 1;
    else if (isCancelled(row)) summary.cancelled += 1;
    else summary.active_uncompleted += 1;

    const svc = serviceType(row);
    if (isCompleted(row) && svc === "ride") summary.ride_completed += 1;
    if (isCompleted(row) && svc === "takeout") summary.takeout_completed += 1;
    if (isActive(row) && svc === "ride") summary.ride_active += 1;
    if (isActive(row) && svc === "takeout") summary.takeout_active += 1;

    summary.revenue += n(row?.verified_fare) || n(row?.takeout_total_payable) || n(row?.proposed_fare);
    summary.driver_payout += n(row?.driver_payout);
    summary.company_cut += n(row?.company_cut);

    addBookingStats(addBucket(daily, dateKey(row?.created_at)), row);
    addBookingStats(addBucket(weekly, weekKey(row?.created_at)), row);
    addBookingStats(addBucket(monthly, monthKey(row?.created_at)), row);
    addBookingStats(addBucket(towns, s(row?.town) || "Unknown"), row);

    const did = s(row?.assigned_driver_id || row?.driver_id);
    if (did) {
      if (!drivers[did]) {
        drivers[did] = {
          driver_id: did,
          driver_name: driverDisplayName(did),
          town: s(row?.town) || null,
          completed_trips: 0,
          active_trips: 0,
          cancelled_trips: 0,
          ride_completed: 0,
          takeout_completed: 0,
          gross_revenue: 0,
          driver_payout: 0,
          company_cut: 0,
          login_sessions: 0,
          login_minutes: 0,
          current_status: null,
          last_seen_at: null,
        };
      }

      if (isCompleted(row)) {
        drivers[did].completed_trips += 1;
        if (svc === "ride") drivers[did].ride_completed += 1;
        if (svc === "takeout") drivers[did].takeout_completed += 1;
      } else if (isCancelled(row)) {
        drivers[did].cancelled_trips += 1;
      } else {
        drivers[did].active_trips += 1;
      }

      drivers[did].gross_revenue += n(row?.verified_fare) || n(row?.takeout_total_payable) || n(row?.proposed_fare);
      drivers[did].driver_payout += n(row?.driver_payout);
      drivers[did].company_cut += n(row?.company_cut);
    }
  }

  for (const row of sessions as any[]) {
    const did = s(row?.driver_id);
    if (!did) continue;

    if (!drivers[did]) {
      drivers[did] = {
        driver_id: did,
        driver_name: driverDisplayName(did, row?.driver_name),
        town: s(row?.town) || null,
        completed_trips: 0,
        active_trips: 0,
        cancelled_trips: 0,
        ride_completed: 0,
        takeout_completed: 0,
        gross_revenue: 0,
        driver_payout: 0,
        company_cut: 0,
        login_sessions: 0,
        login_minutes: 0,
        current_status: null,
        last_seen_at: null,
      };
    }

    drivers[did].driver_name = drivers[did].driver_name || s(row?.driver_name) || null;
    drivers[did].town = drivers[did].town || s(row?.town) || null;
    drivers[did].login_sessions += 1;
    drivers[did].login_minutes += sessionMinutes(row);

    summary.total_login_minutes += sessionMinutes(row);
  }

  const latestLocationByDriver: Record<string, any> = {};
  for (const row of locations as any[]) {
    const did = s(row?.driver_id);
    if (!did || latestLocationByDriver[did]) continue;
    latestLocationByDriver[did] = row;
  }

  for (const [did, loc] of Object.entries(latestLocationByDriver)) {
    if (!drivers[did]) {
      drivers[did] = {
        driver_id: did,
        driver_name: driverDisplayName(did),
        town: s((loc as any)?.town || (loc as any)?.home_town) || null,
        completed_trips: 0,
        active_trips: 0,
        cancelled_trips: 0,
        ride_completed: 0,
        takeout_completed: 0,
        gross_revenue: 0,
        driver_payout: 0,
        company_cut: 0,
        login_sessions: 0,
        login_minutes: 0,
        current_status: null,
        last_seen_at: null,
      };
    }

    drivers[did].current_status = s((loc as any)?.status) || null;
    drivers[did].last_seen_at = (loc as any)?.updated_at || null;
    drivers[did].town = drivers[did].town || s((loc as any)?.town || (loc as any)?.home_town) || null;

    if (s((loc as any)?.status).toLowerCase() === "online") summary.online_now += 1;
  }

  summary.drivers_with_sessions = Object.values(drivers).filter((d: any) => d.login_sessions > 0).length;

  const active_uncompleted_trips = bookings
    .filter((row: any) => isActive(row))
    .slice(0, 300)
    .map((row: any) => ({
      booking_code: row.booking_code,
      service_type: serviceType(row),
      status: normStatus(row.status),
      vendor_status: row.vendor_status,
      customer_status: row.customer_status,
      driver_status: row.driver_status,
      takeout_pricing_status: row.takeout_pricing_status,
      town: row.town,
      driver_id: row.assigned_driver_id || row.driver_id,
      passenger_name: row.passenger_name,
      from_label: row.from_label,
      to_label: row.to_label,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

  let driver_detail: any = null;
  if (driverIdFilter) {
    const d = drivers[driverIdFilter] || null;
    driver_detail = {
      driver: d,
      sessions: sessions.filter((row: any) => s(row.driver_id) === driverIdFilter).slice(0, 100),
      bookings: bookings
        .filter((row: any) => s(row.assigned_driver_id || row.driver_id) === driverIdFilter)
        .slice(0, 100),
      current_location: latestLocationByDriver[driverIdFilter] || null,
    };
  }

  return json(200, {
    ok: true,
    source: "analytics_v3",
    days,
    generated_at: new Date().toISOString(),
    summary,
    periods: {
      daily: Object.values(daily).sort((a: any, b: any) => String(b.key).localeCompare(String(a.key))),
      weekly: Object.values(weekly).sort((a: any, b: any) => String(b.key).localeCompare(String(a.key))),
      monthly: Object.values(monthly).sort((a: any, b: any) => String(b.key).localeCompare(String(a.key))),
    },
    towns: Object.values(towns).sort((a: any, b: any) => String(a.key).localeCompare(String(b.key))),
    drivers: Object.values(drivers).sort((a: any, b: any) => Number(b.completed_trips || 0) - Number(a.completed_trips || 0)),
    active_uncompleted_trips,
    driver_detail,
  });
}