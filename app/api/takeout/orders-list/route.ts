import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

function num(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function computeTotals(row: any) {
  const base = num(row.base_fee);
  const dist = num(row.distance_fare);
  const wait = num(row.waiting_fee);
  const extra = num(row.extra_stop_fee);
  const platform = num(row.company_cut);

  const items_total = base + dist + wait + extra;
  const total_bill = items_total + platform; // matches receipt "Total paid"

  return {
    items_total,
    platform_fee: platform,
    total_bill,
  };
}

export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from("bookings")
      .select(
        `
        id,
        booking_code,
        service_type,
        status,
        customer_status,
        vendor_status,
        created_at,
        updated_at,
        base_fee,
        distance_fare,
        waiting_fee,
        extra_stop_fee,
        company_cut,
        driver_payout
      `
      )
      .eq("service_type", "takeout")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("❌ orders-list error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const orders = (data ?? []).map((row) => {
      const totals = computeTotals(row);
      return {
        ...row,
        ...totals,
      };
    });

    return NextResponse.json({ orders });
  } catch (err: any) {
    console.error("❌ orders-list server error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}


//
// PHASE 2D: ORDER SNAPSHOT LOCK - submit handler
//
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const vendor_id = String(body.vendor_id || body.vendorId || "").trim();
    const itemsIn = Array.isArray(body.items) ? body.items : [];

    if (!vendor_id) {
      return NextResponse.json({ ok: false, code: "VENDOR_ID_REQUIRED", message: "vendor_id is required" }, { status: 400 });
    }
    if (!itemsIn.length) {
      return NextResponse.json({ ok: false, code: "ITEMS_REQUIRED", message: "items[] is required" }, { status: 400 });
    }

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!url || !serviceKey) {
      return NextResponse.json(
        { ok: false, code: "SERVER_MISCONFIG", message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const admin = createAdminClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const insertBooking: any = {
      vendor_id,
      service_type: "takeout",
      status: "requested",
      vendor_status: "preparing",
      customer_name: body.customer_name ?? body.customerName ?? null,
      customer_phone: body.customer_phone ?? body.customerPhone ?? null,
      delivery_address: body.delivery_address ?? body.deliveryAddress ?? null,
      note: body.note ?? null,
    };

    const b = await admin.from("bookings").insert(insertBooking).select("*").single();
    if (b.error) return NextResponse.json({ ok: false, code: "DB_ERROR", message: b.error.message }, { status: 500 });

    const booking = b.data as any;
    const booking_id = String(booking?.id || "");

    const menuIds = itemsIn.map((x: any) => String(x?.menu_item_id || x?.menuItemId || "")).filter(Boolean);

    const menuRes = await admin
      .from("vendor_menu_items")
      .select("menu_item_id,name,price,vendor_id")
      .in("menu_item_id", menuIds)
      .eq("vendor_id", vendor_id);

    if (menuRes.error) {
      return NextResponse.json({ ok: false, code: "MENU_LOOKUP_FAILED", message: menuRes.error.message }, { status: 500 });
    }

    const byId: Record<string, any> = {};
    for (const r of (Array.isArray(menuRes.data) ? menuRes.data : []) as any[]) byId[String(r.menu_item_id)] = r;

    const snapshotRows: any[] = [];
    let subtotal = 0;

    for (const raw of itemsIn) {
      const mid = String(raw?.menu_item_id || raw?.menuItemId || "");
      const qty = Math.max(1, parseInt(String(raw?.quantity ?? 1), 10) || 1);
      const m = byId[mid];
      if (!m) continue;

      const name = String(m.name || "");
      const price = Number(m.price || 0) || 0;

      snapshotRows.push({ booking_id, menu_item_id: mid, name, price, quantity: qty, snapshot_at: new Date().toISOString() });
      subtotal += price * qty;
    }

    if (!snapshotRows.length) {
      return NextResponse.json({ ok: false, code: "NO_VALID_ITEMS", message: "No valid menu items matched." }, { status: 400 });
    }

    const ins = await admin.from("takeout_order_items").insert(snapshotRows).select("id");
    if (ins.error) return NextResponse.json({ ok: false, code: "SNAPSHOT_INSERT_FAILED", message: ins.error.message }, { status: 500 });

    const up = await admin.from("bookings").update({ takeout_items_subtotal: subtotal }).eq("id", booking_id).select("id").single();
    if (up.error) {
      return NextResponse.json({ ok: true, booking_id, booking_code: booking?.booking_code ?? null, warning: "Subtotal update failed: " + up.error.message, subtotal }, { status: 200 });
    }

    return NextResponse.json({ ok: true, booking_id, booking_code: booking?.booking_code ?? null, subtotal, items: snapshotRows }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "UNEXPECTED", message: e?.message || "Unexpected error" }, { status: 500 });
  }
}
