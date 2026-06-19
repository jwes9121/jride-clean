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

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function normStatus(value: any) {
  const s = text(value).toLowerCase();
  if (!s || s === "requested" || s === "pending") return "searching";
  if (s === "driver_assigned") return "assigned";
  if (s === "accepted_by_driver") return "accepted";
  if (s === "en_route") return "on_the_way";
  if (s === "in_progress") return "on_trip";
  if (s === "canceled") return "cancelled";
  return s;
}

function minutesSince(value: any) {
  const raw = text(value);
  if (!raw) return 999999;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function pickDriverName(row: any) {
  return text(row?.driver_name || row?.full_name || row?.callsign || row?.name || row?.phone || row?.id);
}

function isOnlineDriver(row: any) {
  const s = text(row?.status).toLowerCase();
  const age = minutesSince(row?.updated_at || row?.created_at);
  return ["online", "available", "idle", "waiting"].includes(s) && age <= 10;
}

function isExpiredIso(value: any) {
  const raw = text(value);
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

function ridePriority(status: string, ageMinutes: number, updateAgeMinutes: number, row?: any) {
  const assignedExpired = status === "assigned" && isExpiredIso(row?.driver_accept_expires_at);
  const acceptedExpired = status === "accepted" && updateAgeMinutes >= 5;

  const stuck =
    assignedExpired ||
    acceptedExpired ||
    (status === "searching" && ageMinutes >= 5) ||
    (status === "assigned" && updateAgeMinutes >= 5) ||
    (status === "accepted" && updateAgeMinutes >= 5) ||
    (status === "fare_proposed" && updateAgeMinutes >= 5) ||
    (status === "ready" && updateAgeMinutes >= 10) ||
    (status === "on_the_way" && updateAgeMinutes >= 15) ||
    (status === "arrived" && updateAgeMinutes >= 10) ||
    (status === "on_trip" && updateAgeMinutes >= 25);

  let priority = 70;
  if (status === "searching") priority = stuck ? 1 : 10;
  else if (status === "assigned") priority = stuck ? 2 : 12;
  else if (status === "accepted") priority = stuck ? 3 : 14;
  else if (status === "fare_proposed") priority = stuck ? 4 : 16;
  else if (status === "ready") priority = stuck ? 5 : 18;
  else if (status === "on_the_way") priority = stuck ? 6 : 20;
  else if (status === "arrived") priority = stuck ? 7 : 22;
  else if (status === "on_trip") priority = stuck ? 8 : 24;
  else if (status === "completed") priority = 95;
  else if (status === "cancelled") priority = 96;

  return { stuck, priority };
}

const ACTIVE_RIDE_STATUSES = new Set([
  "searching",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
]);

export async function GET(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing Supabase service role config.",
    });
  }

  const filter = text(req.nextUrl.searchParams.get("filter") || "active").toLowerCase();

  const bookingsRes = await admin
    .from("bookings")
    .select("*")
    .or("service_type.is.null,service_type.neq.takeout")
    .order("created_at", { ascending: false })
    .limit(500);

  if (bookingsRes.error) {
    return json(500, { ok: false, error: "BOOKINGS_READ_FAILED", message: bookingsRes.error.message });
  }

  const rawBookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];

  const assignedDriverIds = Array.from(
    new Set(rawBookings.map((r: any) => text(r?.assigned_driver_id || r?.driver_id)).filter(Boolean))
  );

  let latestDriverRows: any[] = [];
  try {
    const locRes = await admin
      .from("driver_locations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);

    if (!locRes.error && Array.isArray(locRes.data)) {
      const byDriver: Record<string, any> = {};
      for (const row of locRes.data as any[]) {
        const id = text(row?.driver_id);
        if (!id || byDriver[id]) continue;
        byDriver[id] = row;
      }
      latestDriverRows = Object.values(byDriver);
    }
  } catch {}

  const allDriverIds = Array.from(
    new Set([
      ...assignedDriverIds,
      ...latestDriverRows.map((r: any) => text(r?.driver_id)).filter(Boolean),
    ])
  );

  const driverNameById: Record<string, string> = {};
  const driverPhoneById: Record<string, string> = {};

  if (allDriverIds.length) {
    try {
      const d = await admin.from("drivers").select("id,driver_name").in("id", allDriverIds);
      if (!d.error && Array.isArray(d.data)) {
        for (const row of d.data as any[]) {
          const id = text(row?.id);
          if (id) driverNameById[id] = pickDriverName(row) || id;
        }
      }
    } catch {}

    try {
      const p = await admin.from("driver_profiles").select("driver_id,full_name,callsign,phone").in("driver_id", allDriverIds);
      if (!p.error && Array.isArray(p.data)) {
        for (const row of p.data as any[]) {
          const id = text(row?.driver_id);
          if (!id) continue;
          if (!driverNameById[id]) driverNameById[id] = pickDriverName(row) || id;
          if (row?.phone) driverPhoneById[id] = text(row.phone);
        }
      }
    } catch {}
  }

  const activeAssignedDrivers = new Set(
    rawBookings
      .filter((r: any) => ACTIVE_RIDE_STATUSES.has(normStatus(r?.status)))
      .map((r: any) => text(r?.assigned_driver_id || r?.driver_id))
      .filter(Boolean)
  );

  const drivers = latestDriverRows.map((row: any) => {
    const id = text(row?.driver_id);
    const ageMinutes = minutesSince(row?.updated_at || row?.created_at);
    const assignEligible = isOnlineDriver(row) && !activeAssignedDrivers.has(id);

    return {
      driver_id: id,
      name: driverNameById[id] || row?.name || id,
      phone: driverPhoneById[id] || row?.phone || null,
      town: row?.town || row?.home_town || null,
      lat: row?.lat ?? null,
      lng: row?.lng ?? null,
      status: row?.status || null,
      updated_at: row?.updated_at || null,
      age_minutes: ageMinutes,
      assign_eligible: assignEligible,
    };
  });

  const rides = rawBookings.map((r: any) => {
    const status = normStatus(r?.status);
    const ageMinutes = minutesSince(r?.created_at);
    const updateAgeMinutes = minutesSince(r?.updated_at || r?.created_at);
    const op = ridePriority(status, ageMinutes, updateAgeMinutes, r);
    const assignedDriverId = text(r?.assigned_driver_id || r?.driver_id) || null;

    return {
      id: r.id || null,
      booking_code: r.booking_code || null,
      status,
      passenger_name: r.passenger_name || r.customer_name || "Passenger",
      from_label: r.from_label || r.pickup_label || null,
      to_label: r.to_label || r.dropoff_label || null,
      town: r.town || r.zone || null,
      assigned_driver_id: assignedDriverId,
      assigned_driver_name: assignedDriverId ? driverNameById[assignedDriverId] || assignedDriverId : null,
      assigned_driver_phone: assignedDriverId ? driverPhoneById[assignedDriverId] || null : null,
      proposed_fare: r.proposed_fare ?? null,
      verified_fare: r.verified_fare ?? null,
      pickup_distance_fee: r.pickup_distance_fee ?? null,
      created_at: r.created_at || null,
      updated_at: r.updated_at || null,
      age_minutes: ageMinutes,
      update_age_minutes: updateAgeMinutes,
      driver_accept_expires_at: r.driver_accept_expires_at || null,
      is_stuck: op.stuck,
      priority: op.priority,
    };
  });

  const filtered = rides.filter((ride: any) => {
    if (filter === "all") return true;
    if (filter === "active") return ACTIVE_RIDE_STATUSES.has(ride.status);
    if (filter === "unassigned") return ACTIVE_RIDE_STATUSES.has(ride.status) && !ride.assigned_driver_id;
    if (filter === "stuck") return !!ride.is_stuck;
    if (filter === "cancelled") return ride.status === "cancelled" || ride.status === "canceled";
    return ride.status === filter;
  });

  filtered.sort((a: any, b: any) => {
    if ((a.priority || 0) !== (b.priority || 0)) return (a.priority || 0) - (b.priority || 0);
    return Number(b.age_minutes || 0) - Number(a.age_minutes || 0);
  });

  const counts = {
    all: rides.length,
    active: rides.filter((r: any) => ACTIVE_RIDE_STATUSES.has(r.status)).length,
    unassigned: rides.filter((r: any) => ACTIVE_RIDE_STATUSES.has(r.status) && !r.assigned_driver_id).length,
    searching: rides.filter((r: any) => r.status === "searching").length,
    assigned: rides.filter((r: any) => r.status === "assigned").length,
    accepted: rides.filter((r: any) => r.status === "accepted").length,
    fare_proposed: rides.filter((r: any) => r.status === "fare_proposed").length,
    ready: rides.filter((r: any) => r.status === "ready").length,
    on_the_way: rides.filter((r: any) => r.status === "on_the_way").length,
    arrived: rides.filter((r: any) => r.status === "arrived").length,
    on_trip: rides.filter((r: any) => r.status === "on_trip").length,
    completed: rides.filter((r: any) => r.status === "completed").length,
    cancelled: rides.filter((r: any) => r.status === "cancelled" || r.status === "canceled").length,
    stuck: rides.filter((r: any) => !!r.is_stuck).length,
  };

  return json(200, {
    ok: true,
    source: "app/api/admin/ride-dispatch/route.ts",
    filter,
    counts,
    rides: filtered,
    drivers: drivers.filter((d: any) => d.assign_eligible),
  });
}
