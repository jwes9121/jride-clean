import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SnapshotItem = {
  booking_id: string;
  menu_item_id: string | null;
  name: string;
  price: number;
  quantity: number;
  snapshot_at: string | null;
};

function takeoutEnabled(): boolean {
  const raw = String(process.env.TAKEOUT_ENABLED || "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function disabledResponse() {
  return NextResponse.json(
    {
      ok: false,
      enabled: false,
      error: "TAKEOUT_DISABLED",
      message: "Takeout is prepared but not enabled yet.",
    },
    { status: 503 }
  );
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function n(value: any): number {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function text(value: any): string | null {
  const out = String(value ?? "").trim();
  return out ? out : null;
}

function buildLegacyUrl(req: NextRequest): URL {
  const url = new URL(req.url);
  url.pathname = "/api/vendor-orders";
  return url;
}

async function forwardToLegacyVendorOrders(req: NextRequest, body: any) {
  const url = buildLegacyUrl(req);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;

  const forwarded = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });

  const payload = await forwarded.text();
  return new NextResponse(payload, {
    status: forwarded.status,
    headers: {
      "content-type": forwarded.headers.get("content-type") || "application/json",
    },
  });
}

function shapeOrder(row: any, items: SnapshotItem[] | null, computedSubtotal: number | null) {
  const storedSubtotal = row?.takeout_items_subtotal;
  const fallbackBill = row?.items_subtotal ?? row?.subtotal ?? row?.total_bill ?? row?.totalBill ?? row?.fare;
  const totalBill =
    storedSubtotal != null && Number.isFinite(Number(storedSubtotal))
      ? Number(storedSubtotal)
      : computedSubtotal != null && Number.isFinite(Number(computedSubtotal))
        ? Number(computedSubtotal)
        : fallbackBill != null && Number.isFinite(Number(fallbackBill))
          ? Number(fallbackBill)
          : 0;

  return {
    id: row?.id ?? null,
    booking_code: row?.booking_code ?? null,
    service_type: row?.service_type ?? null,
    status: row?.status ?? null,
    customer_status: row?.customer_status ?? null,
    vendor_status: row?.vendor_status ?? row?.vendorStatus ?? null,
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
    vendor_id: row?.vendor_id ?? null,
    vendor_name: row?.vendor_name ?? row?.merchant_name ?? null,
    customer_name: row?.customer_name ?? row?.passenger_name ?? row?.rider_name ?? null,
    customer_phone: row?.customer_phone ?? row?.rider_phone ?? null,
    from_label: row?.from_label ?? row?.pickup_label ?? null,
    to_label: row?.to_label ?? row?.dropoff_label ?? null,
    pickup_lat: row?.pickup_lat ?? null,
    pickup_lng: row?.pickup_lng ?? null,
    dropoff_lat: row?.dropoff_lat ?? null,
    dropoff_lng: row?.dropoff_lng ?? null,
    base_fee: row?.base_fee ?? row?.takeout_items_subtotal ?? totalBill,
    distance_fare: row?.distance_fare ?? null,
    waiting_fee: row?.waiting_fee ?? null,
    extra_stop_fee: row?.extra_stop_fee ?? null,
    company_cut: row?.company_cut ?? null,
    driver_payout: row?.driver_payout ?? null,
    items,
    items_subtotal: storedSubtotal != null ? Number(storedSubtotal) : computedSubtotal,
    total_bill: totalBill,
  };
}

export async function GET(req: NextRequest) {
  if (!takeoutEnabled()) return disabledResponse();

  try {
    const admin = adminClient();
    if (!admin) {
      return NextResponse.json(
        {
          ok: false,
          error: "SERVER_MISCONFIG",
          message: "Missing Supabase service role environment variables.",
        },
        { status: 500 }
      );
    }

    const sp = req.nextUrl.searchParams;
    const vendorId = text(sp.get("vendor_id") || sp.get("vendorId"));
    const deviceKey = text(sp.get("device_key") || sp.get("deviceKey"));
    const limitRaw = Number(sp.get("limit") || 100);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 200);

    let q = admin
      .from("bookings")
      .select("*")
      .eq("service_type", "takeout")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (vendorId) q = q.eq("vendor_id", vendorId);
    if (deviceKey) q = q.eq("device_key", deviceKey);

    const bookings = await q;
    if (bookings.error) {
      return NextResponse.json(
        { ok: false, error: "TAKEOUT_ORDERS_QUERY_FAILED", message: bookings.error.message },
        { status: 500 }
      );
    }

    const rows = Array.isArray(bookings.data) ? bookings.data : [];
    const ids = rows.map((r: any) => r?.id).filter(Boolean);

    const itemsByBooking: Record<string, SnapshotItem[]> = {};
    const subtotalByBooking: Record<string, number> = {};

    if (ids.length) {
      const itemRows = await admin
        .from("takeout_order_items")
        .select("booking_id,menu_item_id,name,price,quantity,snapshot_at")
        .in("booking_id", ids);

      if (!itemRows.error && Array.isArray(itemRows.data)) {
        for (const r of itemRows.data as any[]) {
          const bookingId = String(r?.booking_id || "");
          if (!bookingId) continue;
          const item: SnapshotItem = {
            booking_id: bookingId,
            menu_item_id: r?.menu_item_id ? String(r.menu_item_id) : null,
            name: String(r?.name || ""),
            price: n(r?.price),
            quantity: Math.max(1, parseInt(String(r?.quantity ?? 1), 10) || 1),
            snapshot_at: r?.snapshot_at ? String(r.snapshot_at) : null,
          };
          if (!itemsByBooking[bookingId]) itemsByBooking[bookingId] = [];
          itemsByBooking[bookingId].push(item);
          subtotalByBooking[bookingId] = (subtotalByBooking[bookingId] || 0) + item.price * item.quantity;
        }
      }
    }

    const orders = rows.map((row: any) => {
      const bookingId = String(row?.id || "");
      return shapeOrder(row, itemsByBooking[bookingId] || null, subtotalByBooking[bookingId] ?? null);
    });

    return NextResponse.json({ ok: true, enabled: true, orders });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TAKEOUT_ORDERS_GET_FAILED",
        message: error?.message || "Failed to load takeout orders.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!takeoutEnabled()) return disabledResponse();

  try {
    const body = await req.json().catch(() => ({}));
    return await forwardToLegacyVendorOrders(req, body);
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TAKEOUT_ORDER_CREATE_FORWARD_FAILED",
        message: error?.message || "Failed to create takeout order through the canonical route.",
      },
      { status: 500 }
    );
  }
}
