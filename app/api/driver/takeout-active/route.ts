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
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const configured = String(process.env.DRIVER_PING_SECRET || process.env.NEXT_PUBLIC_DRIVER_PING_SECRET || "").trim();
  if (!configured) return true;
  const got = String(req.headers.get("x-jride-driver-secret") || "").trim();
  return got.length > 0 && got === configured;
}

function normStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (!s || s === "pending") return "requested";
  if (s === "canceled") return "cancelled";
  return s;
}

function normWorkflowStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "assigned") return "driver_assigned";
  if (s === "arrived_vendor" || s === "rider_at_vendor") return "rider_arrived_vendor";
  if (s === "pickedup") return "picked_up";
  if (s === "canceled") return "cancelled";
  return s || "requested";
}

function pickLabel(...values: any[]) {
  for (const v of values) {
    const s = String(v || "").trim();
    if (s && s !== "null" && s !== "undefined") return s;
  }
  return "";
}

export async function GET(req: NextRequest) {
  if (!isDriverSecretAuthorized(req)) {
    return json(401, { ok: false, error: "UNAUTHORIZED" });
  }

  const admin = getAdmin();
  if (!admin) {
    return json(500, { ok: false, error: "SERVER_MISCONFIG" });
  }

  const driverId = String(req.nextUrl.searchParams.get("driver_id") || req.nextUrl.searchParams.get("driverId") || "").trim();
  if (!driverId) {
    return json(400, { ok: false, error: "driver_id_required" });
  }

  const activeCanonicalStatuses = [
    "requested",
    "searching",
    "assigned",
    "accepted",
    "fare_proposed",
    "ready",
    "on_the_way",
    "arrived",
    "on_trip",
  ];

  const res = await admin
    .from("bookings")
    .select("id,booking_code,service_type,vendor_id,status,vendor_status,customer_status,driver_status,takeout_pricing_status,passenger_name,from_label,to_label,takeout_items_subtotal,assigned_driver_id,driver_id,created_at,updated_at,town,driver_accept_expires_at,takeout_driver_accept_expires_at,takeout_fee_expires_at,takeout_fee_proposal_expires_at,driver_fee_proposal_expires_at,takeout_delivery_fee,takeout_total_payable,takeout_cash_collection_required,takeout_route_plan")
    .eq("service_type", "takeout")
    .or(`assigned_driver_id.eq.${driverId},driver_id.eq.${driverId}`)
    .in("status", activeCanonicalStatuses)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: res.error.message });
  }

  if (!res.data) {
    return json(200, { ok: true, note: "NO_ACTIVE_TAKEOUT", trip: null });
  }

  const row: any = res.data;
  const canonicalStatus = normStatus(row.status);
  const workflowStatus = normWorkflowStatus(
    row.driver_status ||
      row.takeout_pricing_status ||
      row.vendor_status ||
      row.customer_status ||
      row.status
  );

  let vendorName = "Vendor";
  if (row.vendor_id) {
    const v = await admin
      .from("vendor_profiles")
      .select("id,display_name,vendor_name,name,email")
      .eq("id", row.vendor_id)
      .limit(1)
      .maybeSingle();

    if (!v.error && v.data) {
      const vr: any = v.data;
      vendorName = pickLabel(vr.display_name, vr.vendor_name, vr.name, vr.email, vr.id) || "Vendor";
    }
  }

  const trip = {
    id: row.id,
    booking_id: row.id,
    booking_code: row.booking_code,
    code: row.booking_code,
    service_type: "takeout",
    trip_type: "takeout",

    status: canonicalStatus,
    workflow_status: workflowStatus,
    vendor_status: normWorkflowStatus(row.vendor_status || workflowStatus),
    customer_status: normWorkflowStatus(row.customer_status || workflowStatus),
    driver_status: normWorkflowStatus(row.driver_status || workflowStatus),
    takeout_pricing_status: normWorkflowStatus(row.takeout_pricing_status || ""),

    vendor_id: row.vendor_id,
    vendor_name: vendorName,
    passenger_name: pickLabel(row.passenger_name, "Takeout Customer"),
    pickup_label: pickLabel(row.from_label, vendorName),
    from_label: pickLabel(row.from_label, vendorName),
    dropoff_label: pickLabel(row.to_label),
    to_label: pickLabel(row.to_label),
    takeout_items_subtotal: Number(row.takeout_items_subtotal || 0),
    takeout_delivery_fee: row.takeout_delivery_fee,
    takeout_total_payable: row.takeout_total_payable,
    takeout_cash_collection_required: row.takeout_cash_collection_required,
    takeout_route_plan: row.takeout_route_plan,

    assigned_driver_id: row.assigned_driver_id || row.driver_id,
    driver_id: row.driver_id || row.assigned_driver_id,
    town: row.town,
    created_at: row.created_at,
    updated_at: row.updated_at,

    driver_accept_expires_at: row.driver_accept_expires_at,
    takeout_driver_accept_expires_at: row.takeout_driver_accept_expires_at,
    takeout_fee_expires_at: row.takeout_fee_expires_at,
    takeout_fee_proposal_expires_at: row.takeout_fee_proposal_expires_at,
    driver_fee_proposal_expires_at: row.driver_fee_proposal_expires_at,
  };

  return json(200, { ok: true, note: "ACTIVE_TAKEOUT", trip });
}