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
        // PHASE 2D: ORDER SNAPSHOT LOCK (TAKEOUT) â€” freeze menu items per order
    let takeoutSnapshot: any = null;
    try {
      const bookingId = String(data?.id ?? "");
      const vid = String(vendor_id || "").trim();
      const itemsIn = (Array.isArray((body as any)?.items) ? (body as any).items : []) as any[];

      if (!vid || !itemsIn.length) {
        takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "Missing vendor_id or items[]" };
      } else {
        const rows: any[] = [];
        let subtotal = 0;

        for (const it of itemsIn) {
          const mid = String(it?.menu_item_id || it?.menuItemId || it?.id || it?.item_id || "").trim() || null;
          const name = String(it?.name || "").trim();
          const price = Number(it?.price ?? 0);
          const qty = Math.max(1, parseInt(String(it?.quantity ?? it?.qty ?? 1), 10) || 1);

          if (!name) continue;

          rows.push({
            booking_id: bookingId,
            menu_item_id: mid,
            name,
            price: Number.isFinite(price) ? price : 0,
            quantity: qty,
            snapshot_at: new Date().toISOString(),
          });

          subtotal += (Number.isFinite(price) ? price : 0) * qty;
        }

        if (!rows.length) {
          takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "No valid items to snapshot" };
        } else {
          const insItems = await admin.from("takeout_order_items").insert(rows);
          if (insItems?.error) {
            takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "Insert failed: " + insItems.error.message };
          } else {
            // lock totals onto booking
            const up = await admin
              .from("bookings")
              .update({ service_type: "takeout", takeout_items_subtotal: subtotal })
              .eq("id", bookingId);

            takeoutSnapshot = {
              ok: !up?.error,
              inserted: rows.length,
              subtotal,
              note: up?.error ? ("Subtotal update failed: " + up.error.message) : "OK",
            };
          }
        }
      }
    } catch (e: any) {
      takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "Snapshot exception: " + String(e?.message || e) };
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