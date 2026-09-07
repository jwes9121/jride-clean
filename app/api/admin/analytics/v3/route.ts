import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MANILA_TZ = "Asia/Manila";
const DRIVER_LOCATION_STALE_AFTER_SECONDS = 120;
const ONLINE_LIKE_DRIVER_STATUSES = new Set(["online", "available", "idle", "waiting"]);

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

function normStatus(value: any) {
  const x = s(value).toLowerCase();
  if (!x || x === "pending") return "requested";
  if (x === "canceled") return "cancelled";
  return x;
}

function serviceType(row: any): "ride" | "takeout" | "errand" {
  const raw = s(row?.service_type).toLowerCase();
  if (raw === "takeout") return "takeout";
  if (raw === "errand") return "errand";
  return "ride";
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

function grossValue(row: any) {
  return (
    n(row?.verified_fare) ||
    n(row?.takeout_total_payable) ||
    n(row?.total_errand_fare) ||
    n(row?.proposed_fare)
  );
}

function manilaDateKey(value: any) {
  const d = new Date(String(value || ""));
  if (!Number.isFinite(d.getTime())) return "unknown";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return year && month && day ? `${year}-${month}-${day}` : "unknown";
}

function shiftDateKey(dateKey: string, deltaDays: number) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function weekKeyFromDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "unknown";
  const d = new Date(`${dateKey}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function monthKeyFromDateKey(dateKey: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey.slice(0, 7) : "unknown";
}

function manilaWindow(days: number) {
  const today = manilaDateKey(new Date().toISOString());
  const startDate = shiftDateKey(today, -(days - 1));
  const startAt = new Date(`${startDate}T00:00:00+08:00`).toISOString();
  return { today, startDate, startAt };
}

function effectiveLocationState(location: any) {
  const rawStatus = s(location?.status).toLowerCase();
  const updatedAt = s(location?.updated_at);
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const ageSeconds = Number.isFinite(updatedMs)
    ? Math.max(0, Math.floor((Date.now() - updatedMs) / 1000))
    : null;
  const isFresh = ageSeconds !== null && ageSeconds <= DRIVER_LOCATION_STALE_AFTER_SECONDS;
  const isOnline = isFresh && ONLINE_LIKE_DRIVER_STATUSES.has(rawStatus);
  return {
    raw_status: rawStatus || null,
    effective_status: isOnline ? "online" : isFresh ? rawStatus || "offline" : "offline",
    is_online: isOnline,
    is_fresh: isFresh,
    age_seconds: ageSeconds,
  };
}

async function fetchPaged(makeQuery: () => any, pageSize = 1000) {
  const rows: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const res = await makeQuery().range(from, from + pageSize - 1);
    if (res.error) return { data: rows, error: res.error };
    const page = Array.isArray(res.data) ? res.data : [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

function addBucket(map: Record<string, any>, key: string) {
  if (!map[key]) {
    map[key] = {
      key,
      total: 0,
      total_bookings: 0,
      ride_total: 0,
      takeout_total: 0,
      errand_total: 0,
      completed: 0,
      cancelled: 0,
      active: 0,
      active_uncompleted: 0,
      ride_completed: 0,
      ride_active: 0,
      takeout_completed: 0,
      takeout_active: 0,
      errand_completed: 0,
      errand_active: 0,
      completed_gross: 0,
      revenue: 0,
      driver_payout: 0,
      company_cut: 0,
      settled_company_cut: 0,
    };
  }
  return map[key];
}

function addBookingStats(bucket: any, row: any) {
  const svc = serviceType(row);
  bucket.total += 1;
  bucket.total_bookings += 1;
  bucket[`${svc}_total`] += 1;

  if (isCompleted(row)) {
    bucket.completed += 1;
    bucket[`${svc}_completed`] += 1;
    const gross = grossValue(row);
    bucket.completed_gross += gross;
    bucket.revenue += gross;
    bucket.driver_payout += n(row?.driver_payout);
    bucket.company_cut += n(row?.company_cut);
    if (s(row?.wallet_settlement_status).toLowerCase() === "settled") {
      bucket.settled_company_cut += n(row?.company_cut);
    }
  } else if (isCancelled(row)) {
    bucket.cancelled += 1;
  } else {
    bucket.active += 1;
    bucket.active_uncompleted += 1;
    bucket[`${svc}_active`] += 1;
  }
}

function emptyDriver(driverId: string) {
  return {
    driver_id: driverId,
    driver_name: null,
    town: null,
    completed_trips: 0,
    active_trips: 0,
    cancelled_trips: 0,
    ride_completed: 0,
    takeout_completed: 0,
    errand_completed: 0,
    gross_revenue: 0,
    driver_payout: 0,
    company_cut: 0,
    login_sessions: 0,
    login_minutes: 0,
    raw_online_hours: 0,
    security_excluded_hours: 0,
    online_hours: 0,
    current_status: "offline",
    raw_location_status: null,
    location_is_fresh: false,
    location_age_seconds: null,
    last_seen_at: null,
  };
}

function addPresence(target: any, row: any) {
  target.raw_online_seconds = n(target.raw_online_seconds) + n(row?.raw_online_seconds);
  target.net_online_seconds = n(target.net_online_seconds) + n(row?.net_online_seconds);
  target.security_excluded_seconds =
    n(target.security_excluded_seconds) + n(row?.security_excluded_seconds);
}

function finalizePresence(target: any) {
  const rawSeconds = n(target.raw_online_seconds);
  const netSeconds = n(target.net_online_seconds);
  const excludedSeconds = n(target.security_excluded_seconds);
  target.raw_online_hours = rawSeconds / 3600;
  target.security_excluded_hours = excludedSeconds / 3600;
  target.online_hours = netSeconds / 3600;
  target.login_minutes = Math.round(netSeconds / 60);
}

export async function GET(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) return json(500, { ok: false, error: "SERVER_MISCONFIG" });

  const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get("days") || 90)));
  const driverIdFilter = s(req.nextUrl.searchParams.get("driver_id"));
  const window = manilaWindow(days);

  const testIdentityRes = await admin
    .from("analytics_test_identities")
    .select("entity_type,entity_id")
    .eq("active", true);

  if (testIdentityRes.error) {
    return json(500, {
      ok: false,
      error: "TEST_IDENTITY_READ_FAILED",
      message: testIdentityRes.error.message,
    });
  }

  const dummyDriverIds = new Set<string>();
  const dummyPassengerIds = new Set<string>();
  for (const row of testIdentityRes.data || []) {
    if (row.entity_type === "driver") dummyDriverIds.add(s(row.entity_id));
    if (row.entity_type === "passenger") dummyPassengerIds.add(s(row.entity_id));
  }

  const bookingsRes = await fetchPaged(() =>
    admin
      .from("analytics_v3_bookings_v1")
      .select(
        "id,booking_code,service_type,status,vendor_status,customer_status,driver_status,takeout_pricing_status,town,created_at,updated_at,completed_at,assigned_driver_id,driver_id,created_by_user_id,passenger_name,from_label,to_label,verified_fare,proposed_fare,takeout_total_payable,total_errand_fare,takeout_delivery_fee,company_cut,driver_payout,wallet_settlement_status,wallet_settled_at"
      )
      .gte("created_at", window.startAt)
      .order("created_at", { ascending: false })
  );

  if (bookingsRes.error) {
    return json(500, {
      ok: false,
      error: "BOOKINGS_READ_FAILED",
      message: bookingsRes.error.message,
    });
  }

  const presenceRes = await fetchPaged(() =>
    admin
      .from("driver_presence_daily_net_v1")
      .select(
        "driver_id,manila_date,raw_online_seconds,raw_online_hours,net_online_seconds,net_online_hours,security_excluded_seconds,security_excluded_hours,first_seen_at,last_seen_at"
      )
      .gte("manila_date", window.startDate)
      .order("manila_date", { ascending: false })
  );

  if (presenceRes.error) {
    return json(500, {
      ok: false,
      error: "PRESENCE_READ_FAILED",
      message: presenceRes.error.message,
    });
  }

  const sessionStartsRes = await fetchPaged(() =>
    admin
      .from("driver_presence_session_starts_daily_v1")
      .select("driver_id,manila_date,session_count")
      .gte("manila_date", window.startDate)
      .order("manila_date", { ascending: false })
  );

  if (sessionStartsRes.error) {
    return json(500, {
      ok: false,
      error: "SESSION_SUMMARY_READ_FAILED",
      message: sessionStartsRes.error.message,
    });
  }

  const locationsRes = await admin
    .from("driver_locations")
    .select("driver_id,lat,lng,status,town,home_town,updated_at,vehicle_type")
    .order("updated_at", { ascending: false })
    .limit(5000);

  const bookings = bookingsRes.data || [];
  const presenceRows = (presenceRes.data || []).filter(
    (row: any) => !dummyDriverIds.has(s(row?.driver_id))
  );
  const sessionStartRows = (sessionStartsRes.data || []).filter(
    (row: any) => !dummyDriverIds.has(s(row?.driver_id))
  );
  const locations = !locationsRes.error && Array.isArray(locationsRes.data)
    ? locationsRes.data.filter((row: any) => !dummyDriverIds.has(s(row?.driver_id)))
    : [];

  const allDriverIds = Array.from(
    new Set(
      [
        ...bookings.map((row: any) => s(row?.assigned_driver_id || row?.driver_id)),
        ...presenceRows.map((row: any) => s(row?.driver_id)),
        ...locations.map((row: any) => s(row?.driver_id)),
      ].filter((id) => id && !dummyDriverIds.has(id))
    )
  );

  const driverIdentityById: Record<string, any> = {};
  if (allDriverIds.length > 0) {
    const [driverIdentityRes, driverProfileRes] = await Promise.all([
      admin
        .from("drivers")
        .select(
          "id,driver_name,driver_status,zone_id,toda_name,wallet_balance,min_wallet_required,wallet_locked,is_toda_member"
        )
        .in("id", allDriverIds),
      admin
        .from("driver_profiles")
        .select(
          "driver_id,full_name,callsign,municipality,vehicle_type,plate_number,phone,photo_url,toda_org,is_toda_member"
        )
        .in("driver_id", allDriverIds),
    ]);

    if (!driverIdentityRes.error && Array.isArray(driverIdentityRes.data)) {
      for (const row of driverIdentityRes.data as any[]) {
        const did = s(row?.id);
        if (!did) continue;
        driverIdentityById[did] = {
          ...(driverIdentityById[did] || {}),
          driver_name: s(row?.driver_name) || null,
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

    if (!driverProfileRes.error && Array.isArray(driverProfileRes.data)) {
      for (const row of driverProfileRes.data as any[]) {
        const did = s(row?.driver_id);
        if (!did) continue;
        driverIdentityById[did] = {
          ...(driverIdentityById[did] || {}),
          profile_full_name: s(row?.full_name) || null,
          callsign: s(row?.callsign) || null,
          municipality: s(row?.municipality) || null,
          vehicle_type: s(row?.vehicle_type) || null,
          plate_number: s(row?.plate_number) || null,
          phone: s(row?.phone) || null,
          photo_url: s(row?.photo_url) || null,
          toda_org: s(row?.toda_org) || null,
          profile_is_toda_member: row?.is_toda_member ?? null,
        };
      }
    }
  }

  function driverDisplayName(driverId: string, fallback?: any) {
    const identity = driverIdentityById[driverId] || {};
    return (
      s(identity.driver_name) ||
      s(identity.profile_full_name) ||
      s(fallback) ||
      "Unknown Driver"
    );
  }

  const reliabilityById: Record<string, any> = {};
  if (allDriverIds.length > 0) {
    const reliabilityRes = await admin
      .from("driver_reliability_summary_v1")
      .select(
        "driver_id,is_placeholder_driver,is_production_driver,session_count,last_seen_at,duty_check_total_pings,duty_check_responded_pings,duty_check_expired_pings,duty_check_cancelled_pings,duty_check_response_rate_pct,duty_check_latest_ping,duty_check_latest_response,unique_assigned_bookings,raw_assignment_events,repeated_assignment_pairs,progressed_assignments,completed_assignments,assignment_progression_pct,completion_pct,has_repeat_assignments"
      )
      .in("driver_id", allDriverIds);
    if (!reliabilityRes.error && Array.isArray(reliabilityRes.data)) {
      for (const row of reliabilityRes.data as any[]) {
        const did = s(row?.driver_id);
        if (did) reliabilityById[did] = row;
      }
    }
  }

  const activePeriodRes = await admin
    .from("driver_incentive_periods")
    .select("id,name,start_at,end_at")
    .eq("is_active", true)
    .order("start_at", { ascending: false })
    .limit(1);
  const activePeriod =
    !activePeriodRes.error && Array.isArray(activePeriodRes.data) && activePeriodRes.data[0]
      ? activePeriodRes.data[0]
      : null;
  const incentiveStartDate = activePeriod?.start_at
    ? manilaDateKey(activePeriod.start_at)
    : window.startDate;

  const incentivePresenceRes = await fetchPaged(() =>
    admin
      .from("driver_presence_daily_net_v1")
      .select(
        "driver_id,manila_date,raw_online_seconds,net_online_seconds,security_excluded_seconds"
      )
      .gte("manila_date", incentiveStartDate)
      .order("manila_date", { ascending: false })
  );

  const incentivePresenceById: Record<string, any> = {};
  if (!incentivePresenceRes.error) {
    for (const row of incentivePresenceRes.data || []) {
      const did = s(row?.driver_id);
      if (!did || dummyDriverIds.has(did)) continue;
      if (!incentivePresenceById[did]) {
        incentivePresenceById[did] = {
          raw_online_seconds: 0,
          net_online_seconds: 0,
          security_excluded_seconds: 0,
        };
      }
      addPresence(incentivePresenceById[did], row);
    }
    for (const value of Object.values(incentivePresenceById)) finalizePresence(value);
  }

  const incentiveById: Record<string, any> = {};
  if (allDriverIds.length > 0) {
    const incentiveRes = await admin
      .from("driver_incentive_summary_v1")
      .select(
        "driver_id,incentive_period_id,incentive_period_name,incentive_period_start,incentive_period_end,last_seen_at,duty_check_total_pings,duty_check_responded_pings,duty_check_expired_pings,duty_check_cancelled_pings,duty_check_response_rate_pct,unique_assigned_bookings,raw_assignment_events,repeated_assignment_pairs,progressed_assignments,completed_assignments,assignment_progression_pct,completion_pct,has_repeat_assignments"
      )
      .in("driver_id", allDriverIds);
    if (!incentiveRes.error && Array.isArray(incentiveRes.data)) {
      for (const row of incentiveRes.data as any[]) {
        const did = s(row?.driver_id);
        if (did) incentiveById[did] = row;
      }
    }
  }

  const incentiveQualificationById: Record<string, Record<string, any>> = {};
  if (allDriverIds.length > 0) {
    const incentiveQualificationRes = await admin
      .from("driver_incentive_claimability_v1")
      .select(
        "driver_id,policy_code,display_name,cycle_number,cycle_weeks,cycle_start,cycle_end,achieved_presence_days,required_presence_days,achieved_total_hours,required_total_hours,achieved_booking_count,required_booking_count,cycle_missed_checks,calendar_cumulative_missed_checks,allowed_missed_checks,miss_check_scope,presence_requirement_met,hours_requirement_met,booking_requirement_met,duty_check_requirement_met,qualified,already_awarded,claimable"
      )
      .in("driver_id", allDriverIds);

    if (!incentiveQualificationRes.error && Array.isArray(incentiveQualificationRes.data)) {
      for (const row of incentiveQualificationRes.data as any[]) {
        const did = s(row?.driver_id);
        const policyCode = s(row?.policy_code);
        if (!did || !policyCode) continue;
        if (!incentiveQualificationById[did]) incentiveQualificationById[did] = {};
        const existing = incentiveQualificationById[did][policyCode];
        const existingCycle = existing ? Number(existing.cycle_number || 0) : -1;
        const rowCycle = Number(row?.cycle_number || 0);
        if (!existing || rowCycle > existingCycle) {
          incentiveQualificationById[did][policyCode] = row;
        }
      }
    }
  }

  const summary = {
    total_bookings: bookings.length,
    completed: 0,
    cancelled: 0,
    active_uncompleted: 0,
    ride_completed: 0,
    takeout_completed: 0,
    errand_completed: 0,
    ride_active: 0,
    takeout_active: 0,
    errand_active: 0,
    revenue: 0,
    completed_gross: 0,
    driver_payout: 0,
    company_cut: 0,
    settled_company_cut: 0,
    drivers_with_sessions: 0,
    total_login_sessions: 0,
    total_login_minutes: 0,
    total_raw_online_hours: 0,
    total_security_excluded_hours: 0,
    online_now: 0,
    dummy_driver_identities_excluded: dummyDriverIds.size,
    dummy_passenger_identities_excluded: dummyPassengerIds.size,
  };

  const daily: Record<string, any> = {};
  const weekly: Record<string, any> = {};
  const monthly: Record<string, any> = {};
  const towns: Record<string, any> = {};
  const drivers: Record<string, any> = {};

  const operatingTowns = ["Banaue", "Hingyon", "Lagawe", "Lamut"];
  for (const town of operatingTowns) addBucket(towns, town);

  for (const row of bookings as any[]) {
    const svc = serviceType(row);
    if (isCompleted(row)) {
      summary.completed += 1;
      summary[`${svc}_completed` as "ride_completed"] += 1;
      const gross = grossValue(row);
      summary.revenue += gross;
      summary.completed_gross += gross;
      summary.driver_payout += n(row?.driver_payout);
      summary.company_cut += n(row?.company_cut);
      if (s(row?.wallet_settlement_status).toLowerCase() === "settled") {
        summary.settled_company_cut += n(row?.company_cut);
      }
    } else if (isCancelled(row)) {
      summary.cancelled += 1;
    } else {
      summary.active_uncompleted += 1;
      summary[`${svc}_active` as "ride_active"] += 1;
    }

    const dateKey = manilaDateKey(row?.created_at);
    addBookingStats(addBucket(daily, dateKey), row);
    addBookingStats(addBucket(weekly, weekKeyFromDateKey(dateKey)), row);
    addBookingStats(addBucket(monthly, monthKeyFromDateKey(dateKey)), row);
    addBookingStats(addBucket(towns, s(row?.town) || "Unknown"), row);

    const did = s(row?.assigned_driver_id || row?.driver_id);
    if (!did || dummyDriverIds.has(did)) continue;
    if (!drivers[did]) drivers[did] = emptyDriver(did);
    const d = drivers[did];
    d.town = d.town || s(row?.town) || null;
    if (isCompleted(row)) {
      d.completed_trips += 1;
      d[`${svc}_completed`] += 1;
      d.gross_revenue += grossValue(row);
      d.driver_payout += n(row?.driver_payout);
      d.company_cut += n(row?.company_cut);
    } else if (isCancelled(row)) {
      d.cancelled_trips += 1;
    } else {
      d.active_trips += 1;
    }
  }

  const periodPresenceById: Record<string, any> = {};
  for (const row of presenceRows as any[]) {
    const did = s(row?.driver_id);
    if (!did) continue;
    if (!drivers[did]) drivers[did] = emptyDriver(did);
    if (!periodPresenceById[did]) {
      periodPresenceById[did] = {
        raw_online_seconds: 0,
        net_online_seconds: 0,
        security_excluded_seconds: 0,
      };
    }
    addPresence(periodPresenceById[did], row);
  }

  for (const row of sessionStartRows as any[]) {
    const did = s(row?.driver_id);
    if (!did) continue;
    if (!drivers[did]) drivers[did] = emptyDriver(did);
    drivers[did].login_sessions += n(row?.session_count);
    summary.total_login_sessions += n(row?.session_count);
  }

  for (const [did, p] of Object.entries(periodPresenceById)) {
    finalizePresence(p);
    if (!drivers[did]) drivers[did] = emptyDriver(did);
    drivers[did].raw_online_hours = p.raw_online_hours;
    drivers[did].security_excluded_hours = p.security_excluded_hours;
    drivers[did].online_hours = p.online_hours;
    drivers[did].login_minutes = p.login_minutes;
    summary.total_login_minutes += p.login_minutes;
    summary.total_raw_online_hours += p.raw_online_hours;
    summary.total_security_excluded_hours += p.security_excluded_hours;
  }

  const latestLocationByDriver: Record<string, any> = {};
  for (const row of locations as any[]) {
    const did = s(row?.driver_id);
    if (!did || latestLocationByDriver[did]) continue;
    latestLocationByDriver[did] = row;
  }

  for (const [did, loc] of Object.entries(latestLocationByDriver)) {
    if (!drivers[did]) drivers[did] = emptyDriver(did);
    const state = effectiveLocationState(loc);
    drivers[did].current_status = state.effective_status;
    drivers[did].raw_location_status = state.raw_status;
    drivers[did].location_is_fresh = state.is_fresh;
    drivers[did].location_age_seconds = state.age_seconds;
    drivers[did].last_seen_at = (loc as any)?.updated_at || null;
    drivers[did].town =
      drivers[did].town || s((loc as any)?.home_town || (loc as any)?.town) || null;
    if (state.is_online) summary.online_now += 1;
  }

  for (const did of Object.keys(drivers)) {
    const identity = driverIdentityById[did] || {};
    const rel = reliabilityById[did] || {};
    const inc = incentiveById[did] || {};
    const incPresence = incentivePresenceById[did] || {};

    drivers[did].driver_name = driverDisplayName(did, drivers[did].driver_name);
    drivers[did].town = s(identity.municipality) || drivers[did].town || null;
    drivers[did].is_placeholder_driver = false;
    drivers[did].is_production_driver = true;
    drivers[did].duty_check_response_rate_pct = rel?.duty_check_response_rate_pct ?? null;
    drivers[did].assignment_progression_pct = rel?.assignment_progression_pct ?? null;
    drivers[did].completion_pct = rel?.completion_pct ?? null;
    drivers[did].unique_assigned_bookings = rel?.unique_assigned_bookings ?? null;
    drivers[did].repeated_assignment_pairs = rel?.repeated_assignment_pairs ?? null;
    drivers[did].has_repeat_assignments = rel?.has_repeat_assignments ?? null;
    drivers[did].incentive_period_name = inc?.incentive_period_name || activePeriod?.name || null;
    drivers[did].incentive_raw_online_hours = incPresence.raw_online_hours ?? 0;
    drivers[did].incentive_eligible_online_hours = incPresence.online_hours ?? 0;
    drivers[did].incentive_security_excluded_hours = incPresence.security_excluded_hours ?? 0;
    drivers[did].incentive_unique_assigned_bookings = inc?.unique_assigned_bookings ?? null;
    drivers[did].incentive_completed_assignments = inc?.completed_assignments ?? null;
    drivers[did].incentive_assignment_progression_pct = inc?.assignment_progression_pct ?? null;
    drivers[did].incentive_completion_pct = inc?.completion_pct ?? null;
    drivers[did].incentive_qualification = incentiveQualificationById[did] || {};
  }

  summary.drivers_with_sessions = Object.values(drivers).filter(
    (d: any) => n(d.login_sessions) > 0
  ).length;

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
  if (driverIdFilter && !dummyDriverIds.has(driverIdFilter)) {
    const d = drivers[driverIdFilter] || emptyDriver(driverIdFilter);
    const identity = driverIdentityById[driverIdFilter] || {};

    const [rideRatingsRes, takeoutRatingsRes, allPresenceRes, allSessionStartsRes, sessionsRes] =
      await Promise.all([
        admin
          .from("trip_ratings")
          .select("id,booking_code,driver_id,rating,feedback,created_at")
          .eq("driver_id", driverIdFilter)
          .order("created_at", { ascending: false })
          .limit(100),
        admin
          .from("takeout_ratings")
          .select("id,booking_code,driver_id,driver_rating,driver_comment,created_at")
          .eq("driver_id", driverIdFilter)
          .order("created_at", { ascending: false })
          .limit(100),
        admin
          .from("driver_presence_daily_net_v1")
          .select(
            "driver_id,manila_date,raw_online_seconds,net_online_seconds,security_excluded_seconds,first_seen_at,last_seen_at"
          )
          .eq("driver_id", driverIdFilter)
          .order("manila_date", { ascending: false })
          .limit(5000),
        admin
          .from("driver_presence_session_starts_daily_v1")
          .select("driver_id,manila_date,session_count")
          .eq("driver_id", driverIdFilter)
          .order("manila_date", { ascending: false })
          .limit(5000),
        admin
          .from("driver_presence_sessions")
          .select(
            "id,driver_id,driver_name,town,status,login_at,logout_at,last_seen_at,source,device_id,created_at,updated_at,close_reason"
          )
          .eq("driver_id", driverIdFilter)
          .order("login_at", { ascending: false })
          .limit(100),
      ]);

    const rideRatings =
      !rideRatingsRes.error && Array.isArray(rideRatingsRes.data) ? rideRatingsRes.data : [];
    const takeoutRatings =
      !takeoutRatingsRes.error && Array.isArray(takeoutRatingsRes.data)
        ? takeoutRatingsRes.data
        : [];
    const allPresence =
      !allPresenceRes.error && Array.isArray(allPresenceRes.data) ? allPresenceRes.data : [];
    const allSessionStarts =
      !allSessionStartsRes.error && Array.isArray(allSessionStartsRes.data)
        ? allSessionStartsRes.data
        : [];
    const driverSessions =
      !sessionsRes.error && Array.isArray(sessionsRes.data) ? sessionsRes.data : [];

    const sessionCountByDate: Record<string, number> = {};
    for (const row of allSessionStarts as any[]) {
      sessionCountByDate[s(row?.manila_date)] = n(row?.session_count);
    }

    const todayKey = window.today;
    const weekStartKey = weekKeyFromDateKey(todayKey);
    const monthKey = monthKeyFromDateKey(todayKey);
    const loginSummary = {
      today_minutes: 0,
      week_minutes: 0,
      month_minutes: 0,
      overall_minutes: 0,
      today_raw_minutes: 0,
      week_raw_minutes: 0,
      month_raw_minutes: 0,
      overall_raw_minutes: 0,
      today_security_excluded_minutes: 0,
      week_security_excluded_minutes: 0,
      month_security_excluded_minutes: 0,
      overall_security_excluded_minutes: 0,
      today_sessions: 0,
      week_sessions: 0,
      month_sessions: 0,
      overall_sessions: 0,
    };

    for (const row of allPresence as any[]) {
      const key = s(row?.manila_date);
      const netMinutes = Math.round(n(row?.net_online_seconds) / 60);
      const rawMinutes = Math.round(n(row?.raw_online_seconds) / 60);
      const excludedMinutes = Math.round(n(row?.security_excluded_seconds) / 60);
      loginSummary.overall_minutes += netMinutes;
      loginSummary.overall_raw_minutes += rawMinutes;
      loginSummary.overall_security_excluded_minutes += excludedMinutes;
      if (key === todayKey) {
        loginSummary.today_minutes += netMinutes;
        loginSummary.today_raw_minutes += rawMinutes;
        loginSummary.today_security_excluded_minutes += excludedMinutes;
      }
      if (key >= weekStartKey && key <= todayKey) {
        loginSummary.week_minutes += netMinutes;
        loginSummary.week_raw_minutes += rawMinutes;
        loginSummary.week_security_excluded_minutes += excludedMinutes;
      }
      if (monthKeyFromDateKey(key) === monthKey) {
        loginSummary.month_minutes += netMinutes;
        loginSummary.month_raw_minutes += rawMinutes;
        loginSummary.month_security_excluded_minutes += excludedMinutes;
      }
    }

    for (const row of allSessionStarts as any[]) {
      const key = s(row?.manila_date);
      const count = n(row?.session_count);
      loginSummary.overall_sessions += count;
      if (key === todayKey) loginSummary.today_sessions += count;
      if (key >= weekStartKey && key <= todayKey) loginSummary.week_sessions += count;
      if (monthKeyFromDateKey(key) === monthKey) loginSummary.month_sessions += count;
    }

    const dailyLoginSummary = (allPresence as any[]).slice(0, 31).map((row: any) => ({
      date: row.manila_date,
      minutes: Math.round(n(row?.net_online_seconds) / 60),
      raw_minutes: Math.round(n(row?.raw_online_seconds) / 60),
      security_excluded_minutes: Math.round(n(row?.security_excluded_seconds) / 60),
      sessions: sessionCountByDate[s(row?.manila_date)] || 0,
      first_login_at: row?.first_seen_at || null,
      last_seen_at: row?.last_seen_at || null,
    }));

    const driverBookings = bookings
      .filter((row: any) => s(row.assigned_driver_id || row.driver_id) === driverIdFilter)
      .slice(0, 100);

    const driverKpis = {
      total_bookings: driverBookings.length,
      completed_bookings: driverBookings.filter((row: any) => isCompleted(row)).length,
      cancelled_bookings: driverBookings.filter((row: any) => isCancelled(row)).length,
      active_bookings: driverBookings.filter((row: any) => isActive(row)).length,
      ride_bookings: driverBookings.filter((row: any) => serviceType(row) === "ride").length,
      takeout_bookings: driverBookings.filter((row: any) => serviceType(row) === "takeout").length,
      errand_bookings: driverBookings.filter((row: any) => serviceType(row) === "errand").length,
      gross_total: driverBookings
        .filter((row: any) => isCompleted(row))
        .reduce((sum: number, row: any) => sum + grossValue(row), 0),
      driver_payout_total: driverBookings
        .filter((row: any) => isCompleted(row))
        .reduce((sum: number, row: any) => sum + n(row?.driver_payout), 0),
      company_cut_total: driverBookings
        .filter((row: any) => isCompleted(row))
        .reduce((sum: number, row: any) => sum + n(row?.company_cut), 0),
    };

    const driverKpiDenominator = driverKpis.completed_bookings + driverKpis.cancelled_bookings;
    const driverPerformance = {
      ...driverKpis,
      completion_rate:
        driverKpiDenominator > 0
          ? Math.round((driverKpis.completed_bookings / driverKpiDenominator) * 100)
          : null,
      cancellation_rate:
        driverKpiDenominator > 0
          ? Math.round((driverKpis.cancelled_bookings / driverKpiDenominator) * 100)
          : null,
    };

    const currentActiveBooking = driverBookings.find((row: any) => isActive(row)) || null;
    const rideRatingCount = rideRatings.length;
    const takeoutRatingCount = takeoutRatings.length;
    const rideRatingAverage =
      rideRatingCount > 0
        ? rideRatings.reduce((sum: number, row: any) => sum + n(row?.rating), 0) / rideRatingCount
        : null;
    const takeoutRatingAverage =
      takeoutRatingCount > 0
        ? takeoutRatings.reduce((sum: number, row: any) => sum + n(row?.driver_rating), 0) /
          takeoutRatingCount
        : null;

    const overallPresence: any = {
      raw_online_seconds: 0,
      net_online_seconds: 0,
      security_excluded_seconds: 0,
    };
    for (const row of allPresence as any[]) addPresence(overallPresence, row);
    finalizePresence(overallPresence);

    const rel = reliabilityById[driverIdFilter] || null;
    const inc = incentiveById[driverIdFilter] || null;
    const incPresence = incentivePresenceById[driverIdFilter] || {};

    const timeline = [
      ...driverSessions.map((row: any) => ({
        type: "session",
        at: row.login_at || row.created_at,
        label: "Driver login",
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
        gross_booking: isCompleted(row) ? grossValue(row) : 0,
        driver_payout: isCompleted(row) ? n(row?.driver_payout) : 0,
        company_cut: isCompleted(row) ? n(row?.company_cut) : 0,
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
        ...d,
        driver_id: driverIdFilter,
        driver_name: driverDisplayName(driverIdFilter, d?.driver_name),
        callsign: s(identity.callsign) || null,
        phone: s(identity.phone) || null,
        photo_url: s(identity.photo_url) || null,
        municipality: s(identity.municipality) || null,
        vehicle_type: s(identity.vehicle_type) || null,
        plate_number: s(identity.plate_number) || null,
        driver_status_master: s(identity.driver_status_master) || null,
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
      reliability: rel
        ? {
            ...rel,
            raw_online_hours: overallPresence.raw_online_hours,
            security_excluded_hours: overallPresence.security_excluded_hours,
            online_hours: overallPresence.online_hours,
          }
        : {
            raw_online_hours: overallPresence.raw_online_hours,
            security_excluded_hours: overallPresence.security_excluded_hours,
            online_hours: overallPresence.online_hours,
          },
      incentive: {
        ...(inc || {}),
        incentive_period_name: inc?.incentive_period_name || activePeriod?.name || null,
        raw_online_hours: incPresence.raw_online_hours ?? 0,
        eligible_online_hours: incPresence.online_hours ?? 0,
        online_hours: incPresence.online_hours ?? 0,
        security_excluded_hours: incPresence.security_excluded_hours ?? 0,
      },
      incentive_qualification: incentiveQualificationById[driverIdFilter] || {},
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
    source: "analytics_v3_canonical_v1",
    days,
    window: {
      manila_start_date: window.startDate,
      manila_today: window.today,
      start_at_utc: window.startAt,
    },
    generated_at: new Date().toISOString(),
    summary,
    periods: {
      daily: Object.values(daily).sort((a: any, b: any) => String(b.key).localeCompare(String(a.key))),
      weekly: Object.values(weekly).sort((a: any, b: any) => String(b.key).localeCompare(String(a.key))),
      monthly: Object.values(monthly).sort((a: any, b: any) => String(b.key).localeCompare(String(a.key))),
    },
    towns: Object.values(towns).sort((a: any, b: any) => String(a.key).localeCompare(String(b.key))),
    drivers: Object.values(drivers).sort(
      (a: any, b: any) => Number(b.completed_trips || 0) - Number(a.completed_trips || 0)
    ),
    active_uncompleted_trips,
    driver_detail,
    data_quality: {
      booking_source: "analytics_v3_bookings_v1",
      presence_source: "driver_presence_daily_net_v1",
      login_hours_definition: "raw presence minus Duty Check frozen intervals",
      timezone: MANILA_TZ,
      location_freshness_seconds: DRIVER_LOCATION_STALE_AFTER_SECONDS,
      dummy_driver_identities_excluded: dummyDriverIds.size,
      dummy_passenger_identities_excluded: dummyPassengerIds.size,
    },
  });
}
