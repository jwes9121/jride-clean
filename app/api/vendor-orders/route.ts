import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getServiceRoleAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;

  return createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function isAuthedWithEither(supabase: any) {
  // NextAuth session OR Supabase auth user
  const session = await auth().catch(() => null as any);
  if (session?.user) return true;

  const { data } = await supabase.auth.getUser();
  return !!data?.user;
}

// GET /api/vendor-orders?vendor_id=UUID
export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  // Accept both vendor_id and vendorId (for safety)
  const vendor_id =
    String(req.nextUrl.searchParams.get("vendor_id") || req.nextUrl.searchParams.get("vendorId") || "").trim();

  // PILOT MODE RULE:
  // - If authed: allow.
  // - If NOT authed: still allow, BUT vendor_id must be present (private link acts as the "key").
  const authed = await isAuthedWithEither(supabase);
  if (!vendor_id) {
    return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required (pilot mode)" });
  }

  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  // Always read using service role to avoid RLS surprises in pilot mode.
  const { data, error } = await admin
    .from("bookings")
    .select("*")
    .eq("vendor_id", vendor_id)
    .order("created_at", { ascending: false });

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  const rows = (Array.isArray(data) ? data : []) as any[];

  // Keep mapping very forgiving (no column assumptions beyond those read)
  const orders = rows.map((r) => ({
    id: r.id ?? null,
    booking_code: r.booking_code ?? null,
    vendor_id: r.vendor_id ?? vendor_id,
    vendor_status: r.vendor_status ?? r.vendorStatus ?? null,
    status: r.status ?? null,
    service_type: r.service_type ?? null,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    // optional display fields if present
    customer_name: r.customer_name ?? r.passenger_name ?? r.rider_name ?? null,
    customer_phone: r.customer_phone ?? r.passenger_phone ?? r.rider_phone ?? null,
    delivery_address: r.delivery_address ?? r.dropoff_label ?? null,
    items: r.items ?? null,
    note: r.note ?? null,
    total_bill: r.total_bill ?? r.totalBill ?? r.fare ?? null,
  }));

  return json(200, { ok: true, vendor_id, orders });
}

// POST /api/vendor-orders
// - Create when no order_id/orderId
// - Update vendor_status when order_id present
export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  const body = await req.json().catch(() => ({} as any));

  const order_id = String(body.order_id ?? body.orderId ?? "").trim();
  const vendor_id = String(body.vendor_id ?? body.vendorId ?? "").trim();
  const vendor_status = String(body.vendor_status ?? body.vendorStatus ?? body.status ?? "").trim() || "preparing";

  // PILOT MODE RULE:
  // - If authed: allow.
  // - If NOT authed: still allow, BUT vendor_id must be present (private link acts as the "key").
  const authed = await isAuthedWithEither(supabase);
  if (!authed && !vendor_id) {
    return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required (pilot mode)" });
  }

  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  if (!vendor_id) {
    return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });
  }

  // CREATE (kept for completeness; you can ignore/disable from UI)
  if (!order_id) {
    const insertRow: any = {
      vendor_id,
      vendor_status,
      service_type: "takeout",
      status: "requested",
    };

    const { data, error } = await admin.from("bookings").insert(insertRow).select("*").single();

    if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

    return json(200, {
      ok: true,
      action: "created",
      order_id: data?.id ?? null,
      id: data?.id ?? null,
      booking_code: data?.booking_code ?? null,
      vendor_id: data?.vendor_id ?? vendor_id,
      vendor_status: data?.vendor_status ?? vendor_status,
    });
  }

  // UPDATE (vendor_status only)
  const patch: any = { vendor_status };

  const { data, error } = await admin
    .from("bookings")
    .update(patch)
    .eq("id", order_id)
    .eq("vendor_id", vendor_id)
    .select("*")
    .single();

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, {
    ok: true,
    action: "updated",
    order_id: data?.id ?? order_id,
    vendor_id,
    vendor_status: data?.vendor_status ?? vendor_status,
  });
}