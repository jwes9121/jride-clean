import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIVE_TAKEOUT_STATUSES = new Set([
  "requested",
  "preparing",
  "pickup_ready",
  "driver_assigned",
  "rider_arrived_vendor",
  "picked_up",
  "delivering",
]);

const ACTIVE_RIDE_STATUSES = new Set([
  "pending",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
]);

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

function normStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "ready" || s === "prepared" || s === "ready_for_pickup") return "pickup_ready";
  if (s === "assigned") return "driver_assigned";
  if (s === "arrived_vendor" || s === "rider_at_vendor") return "rider_arrived_vendor";
  if (s === "pickedup") return "picked_up";
  if (s === "canceled") return "cancelled";
  return s;
}

function isOnlineLike(value: any) {
  const s = String(value || "").trim().toLowerCase();
  return s === "online" || s === "available" || s === "idle" || s === "waiting";
}

function minutesSince(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return 999999;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function isLocationAssignable(row: any) {
  if (!row) return false;
  if (row?.assign_eligible === true) return true;
  if (row?.is_stale === true) return false;
  if (row?.assign_fresh === false) return false;
  const age = minutesSince(row?.updated_at || row?.created_at);
  if (age > 15) return false;
  return isOnlineLike(row?.status);
}

async function getLatestDriverLocation(admin: any, driverId: string) {
  try {
    const res = await admin
      .from("driver_locations")
      .select("driver_id,status,assign_eligible,assign_fresh,is_stale,updated_at,created_at")
      .eq("driver_id", driverId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) return { ok: false, row: null, message: res.error.message };
    return { ok: true, row: res.data || null, message: null };
  } catch (err: any) {
    return { ok: false, row: null, message: err?.message || "driver location check failed" };
  }
}

function findDriverConflict(rows: any[], driverId: string, currentOrderId: string) {
  for (const row of rows) {
    const id = String(row?.id || "").trim();
    if (id && id === currentOrderId) continue;

    const serviceType = String(row?.service_type || "").trim().toLowerCase();
    const rideStatus = normStatus(row?.status);
    const takeoutStatus = normStatus(row?.vendor_status || row?.customer_status || row?.status);

    if (serviceType === "takeout" && ACTIVE_TAKEOUT_STATUSES.has(takeoutStatus)) {
      return {
        type: "takeout",
        booking_code: row?.booking_code || id,
        status: takeoutStatus,
      };
    }

    if (serviceType !== "takeout" && ACTIVE_RIDE_STATUSES.has(rideStatus)) {
      return {
        type: "ride",
        booking_code: row?.booking_code || id,
        status: rideStatus,
      };
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const body = await req.json().catch(() => ({} as any));
  const orderId = String(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id || "").trim();
  const driverId = String(body?.driver_id || body?.driverId || "").trim();

  if (!orderId) return json(400, { ok: false, error: "order_id_required", message: "order_id required" });
  if (!driverId) return json(400, { ok: false, error: "driver_id_required", message: "driver_id required" });

  const existing = await admin
    .from("bookings")
    .select("id,booking_code,service_type,vendor_status,customer_status,status,assigned_driver_id")
    .eq("id", orderId)
    .eq("service_type", "takeout")
    .single();

  if (existing.error || !existing.data) {
    return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND", message: existing.error?.message || "Takeout order not found" });
  }

  const currentStatus = normStatus((existing.data as any).vendor_status || (existing.data as any).customer_status || (existing.data as any).status || "requested");
  if (currentStatus === "completed" || currentStatus === "cancelled") {
    return json(409, { ok: false, error: "TAKEOUT_ORDER_CLOSED", message: "Closed takeout orders cannot be assigned" });
  }

  const locationCheck = await getLatestDriverLocation(admin, driverId);
  if (!locationCheck.ok) {
    return json(409, {
      ok: false,
      error: "DRIVER_LOCATION_CHECK_FAILED",
      message: locationCheck.message || "Unable to verify driver availability",
    });
  }
  if (!isLocationAssignable(locationCheck.row)) {
    return json(409, {
      ok: false,
      error: "DRIVER_NOT_ASSIGNABLE",
      message: "Driver must be online, fresh, and assign eligible before manual takeout assignment",
    });
  }

  const assigned = await admin
    .from("bookings")
    .select("id,booking_code,service_type,status,vendor_status,customer_status,assigned_driver_id")
    .eq("assigned_driver_id", driverId)
    .limit(100);

  if (assigned.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: assigned.error.message });
  }

  const conflict = findDriverConflict(Array.isArray(assigned.data) ? assigned.data : [], driverId, orderId);
  if (conflict) {
    return json(409, {
      ok: false,
      error: "DRIVER_ALREADY_ACTIVE",
      message: `Driver already has an active ${conflict.type} (${conflict.booking_code}) with status ${conflict.status}`,
      conflict,
    });
  }

  const patch = {
    assigned_driver_id: driverId,
    vendor_status: "driver_assigned",
    customer_status: "driver_assigned",
  };

  const up = await admin
    .from("bookings")
    .update(patch)
    .eq("id", orderId)
    .eq("service_type", "takeout")
    .select("id,booking_code,service_type,vendor_status,customer_status,assigned_driver_id,updated_at")
    .single();

  if (up.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
  }

  return json(200, { ok: true, order: up.data, guard: "manual_takeout_assignment_guard_v1" });
}

