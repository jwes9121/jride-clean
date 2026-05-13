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

function normStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "ready" || s === "prepared" || s === "ready_for_pickup") return "pickup_ready";
  if (s === "canceled") return "cancelled";
  if (s === "preparing_order") return "preparing";
  if (s === "driver_assigned" || s === "assigned") return "driver_assigned";
  if (s === "arrived_vendor" || s === "rider_at_vendor") return "rider_arrived_vendor";
  if (s === "pickedup") return "picked_up";
  return s || "requested";
}

function minutesSince(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return 999999;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function pickVendorName(row: any) {
  return String(row?.display_name || row?.vendor_name || row?.name || row?.email || row?.id || "").trim();
}

function pickDriverName(row: any) {
  return String(row?.driver_name || row?.full_name || row?.name || row?.phone || row?.id || "").trim();
}

function isAssignableDriver(row: any) {
  const effective = String(row?.status || "").trim().toLowerCase();
      const ageMinutes = minutesSince(row?.updated_at || row?.created_at);

  const onlineLike = new Set(["online", "available", "idle", "waiting"]);

    
  // hard freshness cutoff for takeout dispatch pool
  if (ageMinutes > 10) return false;

  
  
  return onlineLike.has(effective);
}

function orderPriority(status: string, ageMinutes: number, updateAgeMinutes: number) {
  const stuck =
    (status === "requested" && ageMinutes >= 10) ||
    (status === "preparing" && ageMinutes >= 30) ||
    (status === "pickup_ready" && updateAgeMinutes >= 20) ||
    (status === "driver_assigned" && updateAgeMinutes >= 20) ||
    (status === "rider_arrived_vendor" && updateAgeMinutes >= 15) ||
    (status === "picked_up" && updateAgeMinutes >= 30) ||
    (status === "delivering" && updateAgeMinutes >= 30);

  let priority = 70;
  if (status === "pickup_ready") priority = stuck ? 1 : 10;
  else if (status === "requested") priority = stuck ? 2 : 15;
  else if (status === "driver_assigned") priority = stuck ? 3 : 18;
  else if (status === "rider_arrived_vendor") priority = stuck ? 4 : 20;
  else if (status === "preparing") priority = stuck ? 5 : 25;
  else if (status === "picked_up" || status === "delivering") priority = stuck ? 6 : 30;
  else if (status === "cancelled") priority = 90;
  else if (status === "completed") priority = 95;

  return { stuck, priority };
}

export async function GET(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const filter = String(req.nextUrl.searchParams.get("filter") || "active").trim().toLowerCase();

  const ordersRes = await admin
    .from("bookings")
    .select("id,booking_code,vendor_id,vendor_status,customer_status,status,service_type,passenger_name,to_label,takeout_items_subtotal,assigned_driver_id,created_at,updated_at,town")
    .eq("service_type", "takeout")
    .order("created_at", { ascending: false })
    .limit(500);

  if (ordersRes.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: ordersRes.error.message });
  }

  const rawOrders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
  const vendorIds = Array.from(new Set(rawOrders.map((r: any) => String(r?.vendor_id || "").trim()).filter(Boolean)));
  const driverIdsFromOrders = Array.from(new Set(rawOrders.map((r: any) => String(r?.assigned_driver_id || "").trim()).filter(Boolean)));

  const vendorNameById: Record<string, string> = {};
  if (vendorIds.length) {
    try {
      const vr = await admin.from("vendor_accounts").select("*").in("id", vendorIds);
      if (!vr.error && Array.isArray(vr.data)) {
        for (const row of vr.data as any[]) {
          const id = String(row?.id || "").trim();
          if (id) vendorNameById[id] = pickVendorName(row) || id;
        }
      }
    } catch {}
  }

  let latestDriverRows: any[] = [];
  try {
    const dl = await admin
      .from("driver_locations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (!dl.error && Array.isArray(dl.data)) {
      const byDriver: Record<string, any> = {};
      for (const row of dl.data as any[]) {
        const id = String(row?.driver_id || "").trim();
        if (!id || byDriver[id]) continue;
        byDriver[id] = row;
      }
      latestDriverRows = Object.values(byDriver);
    }
  } catch {}

  const driverIds = Array.from(new Set([...latestDriverRows.map((r: any) => String(r?.driver_id || "").trim()).filter(Boolean), ...driverIdsFromOrders]));
  const driverNameById: Record<string, string> = {};
  const driverPhoneById: Record<string, string> = {};
  if (driverIds.length) {
    try {
      const d = await admin.from("drivers").select("id,driver_name,driver_status,zone_id,toda_name").in("id", driverIds);
      if (!d.error && Array.isArray(d.data)) {
        for (const row of d.data as any[]) {
          const id = String(row?.id || "").trim();
          if (id) driverNameById[id] = pickDriverName(row) || id;
        }
      }
    } catch {}

    try {
      const p = await admin.from("driver_profiles").select("driver_id,phone,full_name").in("driver_id", driverIds);
      if (!p.error && Array.isArray(p.data)) {
        for (const row of p.data as any[]) {
          const id = String(row?.driver_id || "").trim();
          if (!id) continue;
          if (!driverNameById[id]) driverNameById[id] = pickDriverName(row) || id;
          if (row?.phone) driverPhoneById[id] = String(row.phone);
        }
      }
    } catch {}
  }

  const drivers = latestDriverRows.map((row: any) => {
    const id = String(row?.driver_id || "").trim();
    const ageMinutes = minutesSince(row?.updated_at || row?.created_at);
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
      assign_eligible: isAssignableDriver(row),
    };
  });

  // JRIDE_TAKEOUT_DISPATCH_ACTIVE_POOL_V2
  // Only active takeout jobs should reserve a driver in the manual dispatch pool.
  // Completed/cancelled takeout rows must not keep drivers hidden after delivery.
  const terminalTakeoutStatuses = new Set(["completed", "cancelled", "canceled"]);
  const isActiveTakeoutAssignment = (r: any) => {
    const assignedDriverId = String(r?.assigned_driver_id || "").trim();
    if (!assignedDriverId) return false;

    const vendorStatus = normStatus(r?.vendor_status || r?.customer_status || r?.status || "requested");
    const customerStatus = normStatus(r?.customer_status || "");
    const bookingStatus = normStatus(r?.status || "");

    if (terminalTakeoutStatuses.has(vendorStatus)) return false;
    if (terminalTakeoutStatuses.has(customerStatus)) return false;
    if (terminalTakeoutStatuses.has(bookingStatus)) return false;

    return activeStatuses.has(vendorStatus) || activeStatuses.has(customerStatus) || activeStatuses.has(bookingStatus);
  };

  const assignedDriverSet = new Set(
    rawOrders
      .filter((r: any) => isActiveTakeoutAssignment(r))
      .map((r: any) => String(r?.assigned_driver_id || "").trim())
      .filter(Boolean)
  );
  const availableDrivers = drivers.filter((d: any) => d.assign_eligible && !assignedDriverSet.has(String(d.driver_id || "")));

  const orders = rawOrders.map((r: any) => {
    const vendorStatus = normStatus(r.vendor_status || r.customer_status || r.status || "requested");
    const ageMinutes = minutesSince(r.created_at);
    const updateAgeMinutes = minutesSince(r.updated_at || r.created_at);
    const op = orderPriority(vendorStatus, ageMinutes, updateAgeMinutes);
    const subtotal = Number(r.takeout_items_subtotal || 0);
    const assignedDriverId = String(r.assigned_driver_id || "").trim() || null;
    return {
      id: r.id || null,
      booking_code: r.booking_code || null,
      vendor_id: r.vendor_id || null,
      vendor_name: vendorNameById[String(r.vendor_id || "").trim()] || r.vendor_id || null,
      vendor_status: vendorStatus,
      customer_status: r.customer_status || null,
      status: r.status || null,
      customer_name: r.passenger_name || "Takeout Customer",
      to_label: r.to_label || null,
      takeout_items_subtotal: subtotal,
      cash_required: subtotal >= 500,
      assigned_driver_id: assignedDriverId,
      assigned_driver_name: assignedDriverId ? driverNameById[assignedDriverId] || assignedDriverId : null,
      assigned_driver_phone: assignedDriverId ? driverPhoneById[assignedDriverId] || null : null,
      created_at: r.created_at || null,
      updated_at: r.updated_at || null,
      town: r.town || null,
      age_minutes: ageMinutes,
      update_age_minutes: updateAgeMinutes,
      is_stuck: op.stuck,
      priority: op.priority,
    };
  });

  const activeStatuses = new Set(["requested", "preparing", "pickup_ready", "driver_assigned", "rider_arrived_vendor", "picked_up", "delivering"]);
  const filtered = orders.filter((o: any) => {
    if (filter === "all") return true;
    if (filter === "active") return activeStatuses.has(o.vendor_status);
    if (filter === "stuck") return !!o.is_stuck;
    if (filter === "cash") return !!o.cash_required;
    if (filter === "unassigned") return activeStatuses.has(o.vendor_status) && !o.assigned_driver_id;
    if (filter === "completed") return o.vendor_status === "completed";
    if (filter === "cancelled" || filter === "canceled") return o.vendor_status === "cancelled";
    return o.vendor_status === filter;
  });

  filtered.sort((a: any, b: any) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return Number(b.age_minutes || 0) - Number(a.age_minutes || 0);
  });

  const counts = {
    all: orders.length,
    active: orders.filter((o: any) => activeStatuses.has(o.vendor_status)).length,
    requested: orders.filter((o: any) => o.vendor_status === "requested").length,
    preparing: orders.filter((o: any) => o.vendor_status === "preparing").length,
    pickup_ready: orders.filter((o: any) => o.vendor_status === "pickup_ready").length,
    driver_assigned: orders.filter((o: any) => o.vendor_status === "driver_assigned").length,
    picked_up: orders.filter((o: any) => o.vendor_status === "picked_up" || o.vendor_status === "delivering").length,
    completed: orders.filter((o: any) => o.vendor_status === "completed").length,
    cancelled: orders.filter((o: any) => o.vendor_status === "cancelled").length,
    stuck: orders.filter((o: any) => !!o.is_stuck).length,
    cash: orders.filter((o: any) => !!o.cash_required).length,
    unassigned: orders.filter((o: any) => activeStatuses.has(o.vendor_status) && !o.assigned_driver_id).length,
  };

  return json(200, {
    ok: true,
    source: "app/api/admin/takeout-dispatch/route.ts",
    filter,
    counts,
    orders: filtered,
    drivers: availableDrivers,
  });
}





