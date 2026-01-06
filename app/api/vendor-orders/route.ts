import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";



/* VENDOR_CORE_V2_TRANSITIONS
   Enforce allowed vendor status transitions
   Idempotent + safe (repeat same status OK)
*/
const VENDOR_FLOW = ["preparing","ready","driver_arrived","picked_up","completed"] as const;
type VendorStatus = typeof VENDOR_FLOW[number];

function isValidVendorStatus(s: any): s is VendorStatus {
  return VENDOR_FLOW.includes(s);
}

function normVendorStatus(s: any): VendorStatus {
  const v = String(s || "").trim();
  return (isValidVendorStatus(v) ? v : "preparing");
}

function canTransition(prev: VendorStatus, next: VendorStatus): boolean {
  if (prev === next) return true; // idempotent
  const pi = VENDOR_FLOW.indexOf(prev);
  const ni = VENDOR_FLOW.indexOf(next);
  return ni === pi + 1;
}

export async function GET(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  
      // VENDOR_ORDERS_ADMIN_CLIENT
  // Use route-handler client for auth (RLS), but service-role client for DB writes (bypass RLS) in this trusted API route.
  const { data: authData } = await supabase.auth.getUser();
  const authedUser = authData?.user ?? null;
  if (!authedUser) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED", message: "Login required" }, { status: 401 });
  }

  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 500 }
    );
  }

  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
// VENDOR_ORDERS_POST_CREATE_OR_UPDATE
    // Accept both snake_case and camelCase from UI
    const body = await req.json().catch(() => ({} as any));

    const order_id = String(body.order_id ?? body.orderId ?? "").trim();
    const vendor_id = String(body.vendor_id ?? body.vendorId ?? "").trim();

    const vendor_status_in = String(body.vendor_status ?? body.vendorStatus ?? "").trim();
    const vendor_status = vendor_status_in || "preparing";

    const customer_name = String(body.customer_name ?? body.customerName ?? "").trim();
    const customer_phone = String(body.customer_phone ?? body.customerPhone ?? "").trim();
    const delivery_address = String(body.delivery_address ?? body.deliveryAddress ?? "").trim();
    const items = String(body.items ?? "").trim();
    const note = String(body.note ?? "").trim();

    if (!vendor_id) {
      return NextResponse.json(
        { ok: false, error: "vendor_id required", message: "vendor_id required" },
        { status: 400 }
      );
    }

    // CREATE (no order_id): insert a vendor-backed booking row
    if (!order_id) {
      const insertRow: any = {
        vendor_id,
        vendor_status,
        service_type: "takeout",
        status: "requested",
      };

      // NOTE: We intentionally do NOT insert optional fields here (delivery address / phone / items / note).
      // We must not assume bookings table columns exist.

const { data, error } = await admin
        .from("bookings")
        .insert(insertRow)
        .select("*")
        .single();

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message, message: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        action: "created",
        order_id: data?.id ?? null,
        id: data?.id ?? null,
        booking_code: data?.booking_code ?? null,
        vendor_id: data?.vendor_id ?? vendor_id,
        vendor_status: data?.vendor_status ?? vendor_status,
      });
    }

    // If order_id exists, we fall through to the existing UPDATE logic below.
try {
    const url = new URL(req.url);
    const vendorId = url.searchParams.get("vendorId");

    if (!vendorId) {
      return NextResponse.json({ error: "Missing vendorId" }, { status: 400 });
    }

    // --- KEEP YOUR EXISTING QUERY SHAPE ---
    // NOTE: We intentionally keep this broad select; runtime behavior unchanged.

const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("id", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ✅ Type-narrow once (TS fix only)
    const rows = (Array.isArray(data) ? data : []) as any[];

    const orders = rows.map((r) => {
      const order = {
        id: r.id,
        booking_code: r.booking_code,
        customer_name: r.passenger_name,
        vendor_status: r.vendor_status,

        // keep extra fields if your UI relies on them (safe defaults)
        service_type: r.service_type,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };

      return order;
    });

    return NextResponse.json({ orders });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
export async function POST(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  
      // VENDOR_ORDERS_ADMIN_CLIENT
  // Use route-handler client for auth (RLS), but service-role client for DB writes (bypass RLS) in this trusted API route.
  const { data: authData } = await supabase.auth.getUser();
  const authedUser = authData?.user ?? null;
  if (!authedUser) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED", message: "Login required" }, { status: 401 });
  }

  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 500 }
    );
  }

  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
// VENDOR_ORDERS_POST_CREATE_OR_UPDATE
    // Accept both snake_case and camelCase from UI
    const body = await req.json().catch(() => ({} as any));

    const order_id = String(body.order_id ?? body.orderId ?? "").trim();
    const vendor_id = String(body.vendor_id ?? body.vendorId ?? "").trim();

    const vendor_status_in = String(body.vendor_status ?? body.vendorStatus ?? "").trim();
    const vendor_status = vendor_status_in || "preparing";

    const customer_name = String(body.customer_name ?? body.customerName ?? "").trim();
    const customer_phone = String(body.customer_phone ?? body.customerPhone ?? "").trim();
    const delivery_address = String(body.delivery_address ?? body.deliveryAddress ?? "").trim();
    const items = String(body.items ?? "").trim();
    const note = String(body.note ?? "").trim();

    if (!vendor_id) {
      return NextResponse.json(
        { ok: false, error: "vendor_id required", message: "vendor_id required" },
        { status: 400 }
      );
    }

    // CREATE (no order_id): insert a vendor-backed booking row
    if (!order_id) {
      const insertRow: any = {
        vendor_id,
        vendor_status,
        service_type: "takeout",
        status: "requested",
      };

      // NOTE: We intentionally do NOT insert optional fields here (delivery address / phone / items / note).
      // We must not assume bookings table columns exist.

const { data, error } = await admin
        .from("bookings")
        .insert(insertRow)
        .select("*")
        .single();

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message, message: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        action: "created",
        order_id: data?.id ?? null,
        id: data?.id ?? null,
        booking_code: data?.booking_code ?? null,
        vendor_id: data?.vendor_id ?? vendor_id,
        vendor_status: data?.vendor_status ?? vendor_status,
      });
    }

    // If order_id exists, we fall through to the existing UPDATE logic below.
try {
    const body = (await req.json().catch(() => ({}))) as any;

    const order_id = String(body?.order_id || body?.id || "").trim();
    const vendor_id = String(body?.vendor_id || body?.vendorId || "").trim();
    const vendor_status_raw = String(body?.vendor_status || body?.status || "").trim();

    if (!order_id || !vendor_id || !vendor_status_raw) {
      return NextResponse.json(
        { ok: false, code: "INVALID_INPUT", message: "order_id, vendor_id, vendor_status required" },
        { status: 400 }
      );
    }

    if (!isValidVendorStatus(vendor_status_raw)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_STATUS", message: "Invalid vendor_status" },
        { status: 400 }
      );
    }

    // Load current status (no assumptions beyond columns already used by GET)
    const { data: row, error: selErr } = await supabase
      .from("bookings")
      .select("id,vendor_id,vendor_status,booking_code,passenger_name,service_type,status,created_at,updated_at")
      .eq("id", order_id)
      .eq("vendor_id", vendor_id)
      .maybeSingle();

    if (selErr) {
      return NextResponse.json({ ok: false, code: "DB_ERROR", message: selErr.message }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, code: "NOT_FOUND", message: "Order not found for vendor" },
        { status: 404 }
      );
    }

    const current = normVendorStatus((row as any).vendor_status);
    const next = vendor_status_raw as VendorStatus;

    if (!canTransition(current, next)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_TRANSITION", message: "Cannot transition vendor_status", current, next },
        { status: 409 }
      );
    }

    // Idempotent: if same, just return the row as-is
    if (current === next) {
      return NextResponse.json({
        ok: true,
        order: {
          id: row.id,
          booking_code: (row as any).booking_code,
          customer_name: (row as any).passenger_name,
          vendor_status: (row as any).vendor_status,
          service_type: (row as any).service_type,
          status: (row as any).status,
          created_at: (row as any).created_at,
          updated_at: (row as any).updated_at,
        },
      });
    }

    const { data: updated, error: updErr } = await admin
      .from("bookings")
      .update({ vendor_status: next })
      .eq("id", order_id)
      .eq("vendor_id", vendor_id)
      .select("id,vendor_id,vendor_status,booking_code,passenger_name,service_type,status,created_at,updated_at")
      .maybeSingle();

    if (updErr) {
      return NextResponse.json({ ok: false, code: "DB_ERROR", message: updErr.message }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json(
        { ok: false, code: "UPDATE_FAILED", message: "Update failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      order: {
        id: updated.id,
        booking_code: (updated as any).booking_code,
        customer_name: (updated as any).passenger_name,
        vendor_status: (updated as any).vendor_status,
        service_type: (updated as any).service_type,
        status: (updated as any).status,
        created_at: (updated as any).created_at,
        updated_at: (updated as any).updated_at,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}







