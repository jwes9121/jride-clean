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
      .select("id,driver_name,driver_status,zone_id,toda_name,wallet_balance,min_wallet_required,wallet_locked,is_toda_member")
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
	 wallet_balance: row?.wallet_balance ?? null,
	min_wallet_required: row?.min_wallet_required ?? null,
	wallet_locked: row?.wallet_locked ?? null,
	is_toda_member: row?.is_toda_member ?? null,
        };
      }
    }

    const driverProfileRes = await admin
      .from("driver_profiles")
      .select("driver_id,full_name,callsign,municipality,vehicle_type,plate_number,phone,photo_url,toda_org,is_toda_member")
      .in("driver_id", allDriverIds);

    if (!driverProfileRes.error && Array.isArray(driverProfileRes.data)) {
      for (const row of driverProfileRes.data as any[]) {
        const did = s(row?.driver_id);
        if (!did) continue;
        driverIdentityById[did] = {
          ...(driverIdentityById[did] || {}),
          profile_full_name: s(row?.full_name) || null,
          phone: s(row?.phone) || null,
	callsign: s(row?.callsign) || null,
	municipality: s(row?.municipality) || null,
	vehicle_type: s(row?.vehicle_type) || null,
	plate_number: s(row?.plate_number) || null,
	photo_url: s(row?.photo_url) || null,
	toda_org: s(row?.toda_org) || null,
	profile_is_toda_member: row?.is_toda_member ?? null,
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

  const operatingTowns = ["Banaue", "Hingyon", "Lagawe", "Lamut"];
  for (const town of operatingTowns) {
    addBucket(towns, town);
  }

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
    const identity = driverIdentityById[driverIdFilter] || {};

    const rideRatingsRes = await admin
      .from("trip_ratings")
      .select("id,booking_code,driver_id,rating,feedback,created_at")
      .eq("driver_id", driverIdFilter)
      .order("created_at", { ascending: false })
      .limit(100);

    const takeoutRatingsRes = await admin
      .from("takeout_ratings")
      .select("id,booking_code,driver_id,driver_rating,driver_comment,created_at")
      .eq("driver_id", driverIdFilter)
      .order("created_at", { ascending: false })
      .limit(100);

    const rideRatings = !rideRatingsRes.error && Array.isArray(rideRatingsRes.data) ? rideRatingsRes.data : [];
    const takeoutRatings = !takeoutRatingsRes.error && Array.isArray(takeoutRatingsRes.data) ? takeoutRatingsRes.data : [];

    const rideRatingCount = rideRatings.length;
    const takeoutRatingCount = takeoutRatings.length;
    const rideRatingAverage =
      rideRatingCount > 0
        ? rideRatings.reduce((sum: number, row: any) => sum + n(row?.rating), 0) / rideRatingCount
        : null;
    const takeoutRatingAverage =
      takeoutRatingCount > 0
        ? takeoutRatings.reduce((sum: number, row: any) => sum + n(row?.driver_rating), 0) / takeoutRatingCount
        : null;

        const allDriverSessionsRes = await admin
      .from("driver_presence_sessions")
      .select("id,driver_id,driver_name,town,status,login_at,logout_at,last_seen_at,source,device_id,created_at,updated_at")
      .eq("driver_id", driverIdFilter)
      .order("login_at", { ascending: false })
      .limit(5000);

    const allDriverSessions =
      !allDriverSessionsRes.error && Array.isArray(allDriverSessionsRes.data)
        ? allDriverSessionsRes.data
        : sessions.filter((row: any) => s(row.driver_id) === driverIdFilter);

    function sessionMinutesLocal(row: any) {
      const start = new Date(String(row?.login_at || row?.created_at || "")).getTime();
      const endRaw = row?.logout_at || row?.last_seen_at || row?.updated_at || new Date().toISOString();
      const end = new Date(String(endRaw)).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
      return Math.floor((end - start) / 60000);
    }

    const phNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const todayKey = phNow.toISOString().slice(0, 10);
    const monthKey = todayKey.slice(0, 7);
    const weekStart = new Date(phNow);
    weekStart.setDate(phNow.getDate() - phNow.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const loginSummary = {
      today_minutes: 0,
      week_minutes: 0,
      month_minutes: 0,
      overall_minutes: 0,
      today_sessions: 0,
      week_sessions: 0,
      month_sessions: 0,
      overall_sessions: 0,
    };

    for (const row of allDriverSessions as any[]) {
      const start = new Date(String(row?.login_at || row?.created_at || ""));
      if (!Number.isFinite(start.getTime())) continue;

      const phStart = new Date(start.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
      const key = phStart.toISOString().slice(0, 10);
      const mins = sessionMinutesLocal(row);

      loginSummary.overall_minutes += mins;
      loginSummary.overall_sessions += 1;

      if (key === todayKey) {
        loginSummary.today_minutes += mins;
        loginSummary.today_sessions += 1;
      }

      if (phStart >= weekStart) {
        loginSummary.week_minutes += mins;
        loginSummary.week_sessions += 1;
      }

      if (key.slice(0, 7) === monthKey) {
        loginSummary.month_minutes += mins;
        loginSummary.month_sessions += 1;
      }
    }

    const dailyLoginMap: Record<string, any> = {};

    for (const row of allDriverSessions as any[]) {
      const start = new Date(String(row?.login_at || row?.created_at || ""));
      if (!Number.isFinite(start.getTime())) continue;

      const phStart = new Date(start.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
      const key = phStart.toISOString().slice(0, 10);
      const mins = sessionMinutesLocal(row);

      if (!dailyLoginMap[key]) {
        dailyLoginMap[key] = {
          date: key,
          minutes: 0,
          sessions: 0,
          first_login_at: row?.login_at || row?.created_at || null,
          last_seen_at: row?.logout_at || row?.last_seen_at || row?.updated_at || null,
        };
      }

      dailyLoginMap[key].minutes += mins;
      dailyLoginMap[key].sessions += 1;

      const existingFirst = new Date(String(dailyLoginMap[key].first_login_at || "")).getTime();
      const currentFirst = new Date(String(row?.login_at || row?.created_at || "")).getTime();
      if (Number.isFinite(currentFirst) && (!Number.isFinite(existingFirst) || currentFirst < existingFirst)) {
        dailyLoginMap[key].first_login_at = row?.login_at || row?.created_at || null;
      }

      const existingLast = new Date(String(dailyLoginMap[key].last_seen_at || "")).getTime();
      const currentLast = new Date(String(row?.logout_at || row?.last_seen_at || row?.updated_at || "")).getTime();
      if (Number.isFinite(currentLast) && (!Number.isFinite(existingLast) || currentLast > existingLast)) {
        dailyLoginMap[key].last_seen_at = row?.logout_at || row?.last_seen_at || row?.updated_at || null;
      }
    }

    const dailyLoginSummary = Object.values(dailyLoginMap)
      .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 31);

    const driverSessions = allDriverSessions.slice(0, 100);

    const driverBookings = bookings
      .filter((row: any) => s(row.assigned_driver_id || row.driver_id) === driverIdFilter)
      .slice(0, 100);


    const driverKpis = {
      total_bookings: driverBookings.length,
      completed_bookings: driverBookings.filter((row: any) => normStatus(row.status) === "completed").length,
      cancelled_bookings: driverBookings.filter((row: any) => normStatus(row.status) === "cancelled").length,
      active_bookings: driverBookings.filter((row: any) => isActive(row)).length,
      ride_bookings: driverBookings.filter((row: any) => serviceType(row) !== "takeout").length,
      takeout_bookings: driverBookings.filter((row: any) => serviceType(row) === "takeout").length,
      gross_total: driverBookings.reduce((sum: number, row: any) => sum + (n(row?.verified_fare) || n(row?.takeout_total_payable) || n(row?.proposed_fare)), 0),
      driver_payout_total: driverBookings.reduce((sum: number, row: any) => sum + n(row?.driver_payout), 0),
      company_cut_total: driverBookings.reduce((sum: number, row: any) => sum + n(row?.company_cut), 0),
    };

    const driverKpiDenominator = driverKpis.completed_bookings + driverKpis.cancelled_bookings;
    const driverPerformance = {
      ...driverKpis,
      completion_rate: driverKpiDenominator > 0 ? Math.round((driverKpis.completed_bookings / driverKpiDenominator) * 100) : null,
      cancellation_rate: driverKpiDenominator > 0 ? Math.round((driverKpis.cancelled_bookings / driverKpiDenominator) * 100) : null,
    };
    const currentActiveBooking = driverBookings.find((row: any) => isActive(row)) || null;

    const timeline = [
      ...driverSessions.map((row: any) => ({
        type: "session",
        at: row.login_at || row.created_at,
        label: "Driver login",
        status: row.status,
        source: row.source,
        device_id: row.device_id,
      })),
      ...driverSessions
        .filter((row: any) => row.logout_at)
        .map((row: any) => ({
          type: "session",
          at: row.logout_at,
          label: "Driver logout",
          status: row.status,
          source: row.source,
          device_id: row.device_id,
        })),
      ...driverBookings.map((row: any) => ({
        type: "booking",
        at: row.created_at,
        label: "Booking created",
        booking_code: row.booking_code,
        service_type: serviceType(row),
        status: normStatus(row.status),
        gross_booking:
          n(row?.verified_fare) || n(row?.takeout_total_payable) || n(row?.proposed_fare),
        driver_payout: n(row?.driver_payout),
        company_cut: n(row?.company_cut),
      })),
    ]
      .sort((a: any, b: any) => {
        const aa = new Date(String(a.at || "")).getTime();
        const bb = new Date(String(b.at || "")).getTime();
        return (Number.isFinite(bb) ? bb : 0) - (Number.isFinite(aa) ? aa : 0);
      })
      .slice(0, 200);

    driver_detail = {
      driver: {
        ...(d || {}),
        driver_id: driverIdFilter,
        driver_name: driverDisplayName(driverIdFilter, d?.driver_name),
        callsign: s(identity.callsign) || null,
        phone: s(identity.phone) || null,
        photo_url: s(identity.photo_url) || null,
        municipality: s(identity.municipality) || null,
        vehicle_type: s(identity.vehicle_type) || null,
        plate_number: s(identity.plate_number) || null,
        driver_status_master: s(identity.driver_status_master) || d?.driver_status_master || null,
        wallet_balance: identity.wallet_balance ?? null,
        min_wallet_required: identity.min_wallet_required ?? null,
        wallet_locked: identity.wallet_locked ?? null,
        is_toda_member: identity.is_toda_member ?? identity.profile_is_toda_member ?? null,
        toda_name: s(identity.toda_name || identity.toda_org) || null,
      },
      current_booking: currentActiveBooking,
      current_location: latestLocationByDriver[driverIdFilter] || null,
      sessions: driverSessions,
      bookings: driverBookings,
      login_summary: loginSummary,
      daily_login_summary: dailyLoginSummary,
      performance: driverPerformance,
            ratings: {
        ride_average: rideRatingAverage,
        ride_count: rideRatingCount,
        takeout_average: takeoutRatingAverage,
        takeout_count: takeoutRatingCount,
        ride: rideRatings,
        takeout: takeoutRatings,
      },
      timeline,
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





