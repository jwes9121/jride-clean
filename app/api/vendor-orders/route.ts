import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { auth } from "@/auth";


/* PHASE2D_VENDOR_ORDERS_SNAPSHOT_BEGIN */
function phase2dNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function phase2dPickItemsArray(body: any): any[] {
  const cands = [body?.items, body?.cart, body?.order_items, body?.takeout_items, body?.menu_snapshot];
  for (const x of cands) if (Array.isArray(x) && x.length) return x;
  return [];
}
function phase2dPickId(it: any): string {
  return String(it?.menu_item_id || it?.menuItemId || it?.id || it?.item_id || it?.itemId || "").trim();
}
function phase2dPickQty(it: any): number {
  const q = parseInt(String(it?.quantity ?? it?.qty ?? it?.count ?? 1), 10);
  return Number.isFinite(q) && q > 0 ? q : 1;
}
function phase2dPickName(it: any): string {
  return String(it?.name || it?.title || it?.label || "").trim();
}
function phase2dPickPrice(it: any): number {
  return phase2dNum(it?.price ?? it?.unit_price ?? it?.unitPrice ?? it?.amount ?? 0);
}
async function phase2dFetchMenuRowsForVendor(admin: any, vendorId: string): Promise<any[]> {
  const tables = ["vendor_menu_items", "takeout_menu_items", "menu_items", "vendor_menu"];
  for (const t of tables) {
    try {
      let r = await admin.from(t).select("*").eq("vendor_id", vendorId).limit(2000);
      if (r?.error) r = await admin.from(t).select("*").limit(2000);
      if (!r?.error && Array.isArray(r.data)) return r.data;
    } catch {}
  }
  return [];
}
function phase2dMenuById(menuRows: any[]): Record<string, any> {
  const m: Record<string, any> = {};
  for (const r of (menuRows || [])) {
    const id = String(r?.menu_item_id || r?.id || r?.item_id || r?.menuItemId || "").trim();
    if (id) m[id] = r;
  }
  return m;
}

async function phase2dSnapshotTakeout(admin: any, bookingId: string, vendorId: string, body: any) {
  const itemsIn = phase2dPickItemsArray(body);
  if (!vendorId || !itemsIn.length) return { ok: false, inserted: 0, subtotal: 0, note: "Missing vendor_id or items[]" };

  const menuRows = await phase2dFetchMenuRowsForVendor(admin, vendorId);
  const byId = phase2dMenuById(menuRows);

  const rows: any[] = [];
  let subtotal = 0;

  for (const it of itemsIn) {
    const mid = phase2dPickId(it);
    const qty = phase2dPickQty(it);

    const mr = mid ? byId[mid] : null;
    const name = String((mr?.name ?? mr?.item_name ?? mr?.title) ?? phase2dPickName(it) ?? "").trim();
    const price = phase2dNum((mr?.price ?? mr?.unit_price ?? mr?.amount) ?? phase2dPickPrice(it) ?? 0);

    if (!name) continue;

    rows.push({
      booking_id: bookingId,
      menu_item_id: mid || null,
      name,
      price,
      quantity: qty,
      snapshot_at: new Date().toISOString(),
    });

    subtotal += price * qty;
  }

  if (!rows.length) return { ok: false, inserted: 0, subtotal: 0, note: "No valid items to snapshot" };

  const ins = await admin.from("takeout_order_items").insert(rows);
  if (ins?.error) return { ok: false, inserted: 0, subtotal: 0, note: "Snapshot insert failed: " + ins.error.message };

  const up = await admin.from("bookings").update({ takeout_items_subtotal: subtotal, service_type: "takeout" }).eq("id", bookingId);
  if (up?.error) return { ok: true, inserted: rows.length, subtotal, note: "Subtotal update failed: " + up.error.message };

  return { ok: true, inserted: rows.length, subtotal };
}
/* PHASE2D_VENDOR_ORDERS_SNAPSHOT_END */
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
  const session = await auth().catch(() => null as any);
  if (session?.user) return true;
  const { data } = await supabase.auth.getUser();
  return !!data?.user;
}

type SnapshotItem = {
  menu_item_id: string | null;
  name: string;
  price: number;
  quantity: number;
  snapshot_at: string;
};

function num(n: any) {
  const v = Number(n ?? 0);
  return isFinite(v) ? v : 0;
}

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  const vendor_id =
    String(req.nextUrl.searchParams.get("vendor_id") || req.nextUrl.searchParams.get("vendorId") || "").trim();

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

  const { data, error } = await admin
    .from("bookings")
    .select("*")
    .eq("vendor_id", vendor_id)
    .order("created_at", { ascending: false });

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  const rows = (Array.isArray(data) ? data : []) as any[];

  const ids = rows.map((r) => r?.id).filter(Boolean);
  const itemsByBooking: Record<string, SnapshotItem[]> = {};
  const subtotalByBooking: Record<string, number> = {};

  if (ids.length > 0) {
    const it = await admin
      .from("takeout_order_items")
      .select("booking_id,menu_item_id,name,price,quantity,snapshot_at")
      .in("booking_id", ids);

    if (!it.error) {
      const list = (Array.isArray(it.data) ? it.data : []) as any[];
      for (const r of list) {
        const bid = String(r.booking_id || "");
        if (!bid) continue;

        const item: SnapshotItem = {
          menu_item_id: r.menu_item_id ? String(r.menu_item_id) : null,
          name: String(r.name || ""),
          price: num(r.price),
          quantity: Math.max(1, parseInt(String(r.quantity ?? 1), 10) || 1),
          snapshot_at: r.snapshot_at ? String(r.snapshot_at) : "",
        };

        if (!itemsByBooking[bid]) itemsByBooking[bid] = [];
        itemsByBooking[bid].push(item);
        subtotalByBooking[bid] = (subtotalByBooking[bid] || 0) + item.price * item.quantity;
      }

      for (const k of Object.keys(itemsByBooking)) {
        itemsByBooking[k].sort((a, b) => String(a.snapshot_at).localeCompare(String(b.snapshot_at)));
      }
    }
  }

  const orders = rows.map((r) => {
    const bid = String(r.id ?? "");
    const snapItems = itemsByBooking[bid] || null;

    const stored =
      r.takeout_items_subtotal ?? r.items_subtotal ?? r.subtotal ?? r.total_bill ?? r.totalBill ?? r.fare ?? null;

    const computed = subtotalByBooking[bid] ?? null;
    const total_bill = (stored != null && isFinite(Number(stored))) ? Number(stored) : (computed != null ? computed : 0);

    return {
      id: r.id ?? null,
      booking_code: r.booking_code ?? null,
      vendor_id: r.vendor_id ?? vendor_id,
      vendor_status: r.vendor_status ?? r.vendorStatus ?? null,
      status: r.status ?? null,
      service_type: r.service_type ?? null,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,

      customer_name: r.customer_name ?? r.passenger_name ?? r.rider_name ?? null,

      items: snapItems,
      items_subtotal: computed ?? null,

      total_bill,
    };
  });

  return json(200, { ok: true, vendor_id, orders });
}

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const body = await req.json().catch(() => ({} as any));

  const order_id = String(body.order_id ?? body.orderId ?? "").trim();
  const vendor_id = String(body.vendor_id ?? body.vendorId ?? "").trim();
  const vendor_status = String(body.vendor_status ?? body.vendorStatus ?? body.status ?? "").trim() || "preparing";

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

  if (!order_id) {
    const insertRow: any = { vendor_id, vendor_status, service_type: "takeout", status: "requested" };
    const { data, error } = await admin.from("bookings").insert(insertRow).select("*").single();
    if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

    const bookingId = String(data?.id ?? "").trim();

    // PHASE2D: snapshot lock (items frozen per order + subtotal stored on booking)
    let takeoutSnapshot: any = null;
    try {
      if (bookingId) {
        takeoutSnapshot = await phase2dSnapshotTakeout(admin, bookingId, vendor_id, body as any);
      } else {
        takeoutSnapshot = { ok: false, note: "Missing bookingId after insert" };
      }
    } catch (e: any) {
      takeoutSnapshot = { ok: false, note: "Snapshot threw: " + String(e?.message || e) };
    }

    return json(200, { ok: true, action: "created", order_id: data?.id ?? null, takeoutSnapshot });
  }

  const { data, error } = await admin
    .from("bookings")
    .update({ vendor_status })
    .eq("id", order_id)
    .eq("vendor_id", vendor_id)
    .select("*")
    .single();

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, { ok: true, action: "updated", order_id: data?.id ?? order_id, vendor_status: data?.vendor_status ?? vendor_status });
}