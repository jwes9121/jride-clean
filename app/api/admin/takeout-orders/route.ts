import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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
  return s || "preparing";
}

function isActiveStatus(status: string) {
  return status === "preparing" || status === "pickup_ready";
}

function minutesSince(value: any) {
  const s = String(value || "").trim();
  if (!s) return 999999;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function pickVendorName(row: any) {
  return String(
    row?.display_name ||
      row?.vendor_name ||
      row?.name ||
      row?.email ||
      row?.id ||
      ""
  ).trim();
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
  const vendorId = String(req.nextUrl.searchParams.get("vendor_id") || "").trim();

  let q = admin
    .from("bookings")
    .select("id,booking_code,vendor_id,vendor_status,customer_status,status,service_type,customer_name,passenger_name,rider_name,to_label,dropoff_label,takeout_items_subtotal,created_at,updated_at,town")
    .eq("service_type", "takeout")
    .order("created_at", { ascending: false })
    .limit(500);

  if (vendorId) q = q.eq("vendor_id", vendorId);

  const res = await q;

  if (res.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: res.error.message });
  }

  const rawRows = Array.isArray(res.data) ? res.data : [];

  const vendorIds = Array.from(
    new Set(rawRows.map((r: any) => String(r?.vendor_id || "").trim()).filter(Boolean))
  );

  const vendorNameById: Record<string, string> = {};

  if (vendorIds.length) {
    try {
      const vr = await admin
        .from("vendor_accounts")
        .select("*")
        .in("id", vendorIds);

      if (!vr.error && Array.isArray(vr.data)) {
        for (const row of vr.data as any[]) {
          const id = String(row?.id || "").trim();
          if (!id) continue;
          vendorNameById[id] = pickVendorName(row) || id;
        }
      }
    } catch {
      // vendor names are optional for this read-only monitor
    }
  }

  const orders = rawRows.map((r: any) => {
    const vendorStatus = normStatus(r.vendor_status || r.customer_status || r.status || "preparing");
    const ageMinutes = minutesSince(r.created_at);
    const updateAgeMinutes = minutesSince(r.updated_at || r.created_at);

    const stuck =
      (vendorStatus === "preparing" && ageMinutes >= 30) ||
      (vendorStatus === "pickup_ready" && updateAgeMinutes >= 20);

    let priority = 50;
    if (vendorStatus === "pickup_ready") priority = stuck ? 1 : 10;
    else if (vendorStatus === "preparing") priority = stuck ? 2 : 20;
    else if (vendorStatus === "cancelled") priority = 80;
    else if (vendorStatus === "completed") priority = 90;

    return {
      id: r.id || null,
      booking_code: r.booking_code || null,
      vendor_id: r.vendor_id || null,
      vendor_name: vendorNameById[String(r.vendor_id || "").trim()] || r.vendor_id || null,
      vendor_status: vendorStatus,
      customer_status: r.customer_status || null,
      status: r.status || null,
      customer_name: r.customer_name || r.passenger_name || r.rider_name || "Takeout Customer",
      to_label: r.to_label || r.dropoff_label || null,
      takeout_items_subtotal: Number(r.takeout_items_subtotal || 0),
      created_at: r.created_at || null,
      updated_at: r.updated_at || null,
      town: r.town || null,
      age_minutes: ageMinutes,
      update_age_minutes: updateAgeMinutes,
      is_stuck: stuck,
      priority,
    };
  });

  const filtered = orders.filter((o: any) => {
    if (filter === "all") return true;
    if (filter === "active") return isActiveStatus(o.vendor_status);
    if (filter === "stuck") return !!o.is_stuck;
    if (filter === "completed") return o.vendor_status === "completed";
    if (filter === "cancelled" || filter === "canceled") return o.vendor_status === "cancelled";
    if (filter === "preparing") return o.vendor_status === "preparing";
    if (filter === "pickup_ready") return o.vendor_status === "pickup_ready";
    return isActiveStatus(o.vendor_status);
  });

  filtered.sort((a: any, b: any) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return Number(b.age_minutes || 0) - Number(a.age_minutes || 0);
  });

  const counts = {
    all: orders.length,
    active: orders.filter((o: any) => isActiveStatus(o.vendor_status)).length,
    preparing: orders.filter((o: any) => o.vendor_status === "preparing").length,
    pickup_ready: orders.filter((o: any) => o.vendor_status === "pickup_ready").length,
    completed: orders.filter((o: any) => o.vendor_status === "completed").length,
    cancelled: orders.filter((o: any) => o.vendor_status === "cancelled").length,
    stuck: orders.filter((o: any) => !!o.is_stuck).length,
  };

  return json(200, {
    ok: true,
    filter,
    vendor_id: vendorId || null,
    counts,
    orders: filtered,
  });
}
