import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function toNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
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
  // Do NOT change auth system; keep soft check (some environments may rely on session cookies)
  const session = await auth().catch(() => null as any);
  if (session?.user) return true;
  const { data } = await supabase.auth.getUser();
  return !!data?.user;
}

type SnapshotItem = {
  booking_id?: string;
  menu_item_id: string | null;
  name: string;
  price: number;
  quantity: number;
  snapshot_at?: string;
};

function normalizeItems(body: any): SnapshotItem[] {
  // Prefer body.items (from /takeout/page.tsx), fallback to items_json/itemsJson
  const rawA = Array.isArray(body?.items) ? body.items : null;
  const rawB = Array.isArray(body?.items_json) ? body.items_json : (Array.isArray(body?.itemsJson) ? body.itemsJson : null);
  const raw = (rawA && rawA.length ? rawA : rawB) || [];
  const out: SnapshotItem[] = [];

  for (const it of raw) {
    if (!it) continue;
    const midRaw = String(it?.menu_item_id || it?.menuItemId || it?.id || it?.item_id || "").trim();
    const menu_item_id = midRaw ? midRaw : null;

    const name = String(it?.name || "").trim();
    if (!name) continue;

    const price = toNum(it?.price ?? it?.unit_price ?? 0);
    const qty = Math.max(1, parseInt(String(it?.quantity ?? it?.qty ?? 1), 10) || 1);

    out.push({ menu_item_id, name, price, quantity: qty });
  }

  return out;
}

function computeSubtotal(items: SnapshotItem[]): number {
  let s = 0;
  for (const it of items) s += toNum(it.price) * Math.max(1, it.quantity || 1);
  return s;
}

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  // Optional: keep auth check in place (but do not hard-fail pilot flows unless you want it later)
  // await isAuthedWithEither(supabase).catch(() => false);

  const vendor_id = String(
    req.nextUrl.searchParams.get("vendor_id") ||
      req.nextUrl.searchParams.get("vendorId") ||
      ""
  ).trim();

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

  const b = await admin
    .from("bookings")
    .select("*")
    .eq("vendor_id", vendor_id)
    .order("created_at", { ascending: false });

  if (b.error) return json(500, { ok: false, error: "DB_ERROR", message: b.error.message });

  const rows = (Array.isArray(b.data) ? b.data : []) as any[];
  const ids = rows.map((r) => r?.id).filter(Boolean);

  const itemsByBooking: Record<string, SnapshotItem[]> = {};
  const subtotalByBooking: Record<string, number> = {};

  if (ids.length) {
    const it = await admin
      .from("takeout_order_items")
      .select("booking_id,menu_item_id,name,price,quantity,snapshot_at")
      .in("booking_id", ids);

    if (!it.error && Array.isArray(it.data)) {
      for (const r of it.data as any[]) {
        const bid = String(r?.booking_id || "");
        if (!bid) continue;

        const item: SnapshotItem = {
          booking_id: bid,
          menu_item_id: r?.menu_item_id ? String(r.menu_item_id) : null,
          name: String(r?.name || ""),
          price: toNum(r?.price),
          quantity: Math.max(1, parseInt(String(r?.quantity ?? 1), 10) || 1),
          snapshot_at: r?.snapshot_at ? String(r.snapshot_at) : "",
        };

        if (!itemsByBooking[bid]) itemsByBooking[bid] = [];
        itemsByBooking[bid].push(item);
        subtotalByBooking[bid] = (subtotalByBooking[bid] || 0) + item.price * item.quantity;
      }

      for (const k of Object.keys(itemsByBooking)) {
        itemsByBooking[k].sort((a, b2) => String(a.snapshot_at || "").localeCompare(String(b2.snapshot_at || "")));
      }
    }
  }

  const orders = rows.map((r) => {
    const bid = String(r?.id ?? "");
    const snapItems = itemsByBooking[bid] || null;

    // Prefer stored subtotal column per Phase 2D
    const storedSubtotal = r?.takeout_items_subtotal ?? null;
    const computed = subtotalByBooking[bid] ?? null;

    // total_bill is legacy-shaped in your UI; keep it stable
    const fallbackBill =
      r?.items_subtotal ?? r?.subtotal ?? r?.total_bill ?? r?.totalBill ?? r?.fare ?? null;

    const total_bill =
      (storedSubtotal != null && Number.isFinite(Number(storedSubtotal))) ? Number(storedSubtotal) :
      (computed != null && Number.isFinite(Number(computed))) ? Number(computed) :
      (fallbackBill != null && Number.isFinite(Number(fallbackBill))) ? Number(fallbackBill) : 0;

    return {
      id: r?.id ?? null,
      booking_code: r?.booking_code ?? null,
      vendor_id: r?.vendor_id ?? vendor_id,
      vendor_status: r?.vendor_status ?? r?.vendorStatus ?? null,
      status: r?.status ?? null,
      service_type: r?.service_type ?? null,
      created_at: r?.created_at ?? null,
      updated_at: r?.updated_at ?? null,

      customer_name: r?.customer_name ?? r?.passenger_name ?? r?.rider_name ?? null,
      customer_phone: r?.customer_phone ?? r?.rider_phone ?? null,
      to_label: r?.to_label ?? r?.dropoff_label ?? null,

      items: snapItems,
      items_subtotal: (storedSubtotal != null ? Number(storedSubtotal) : (computed != null ? Number(computed) : null)),
      total_bill,
    };
  });

  return json(200, { ok: true, vendor_id, orders });
}

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  // Keep auth system untouched; do not enforce hard fail unless you want later
  // const authed = await isAuthedWithEither(supabase).catch(() => false);

  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const body = await req.json().catch(() => ({} as any));

  const vendor_id = String(body?.vendor_id ?? body?.vendorId ?? "").trim();
  if (!vendor_id) {
    return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });
  }

  const order_id = String(body?.order_id ?? body?.orderId ?? body?.booking_id ?? body?.bookingId ?? body?.id ?? "").trim();

  const vendor_status = String(body?.vendor_status ?? body?.vendorStatus ?? "preparing").trim();

  // If order_id exists, treat as "update vendor_status" (NO SNAPSHOT HERE)
// Phase 3A bridge: when vendor marks ready (driver_arrived), also move booking.status -> "assigned"
// so it becomes dispatch-visible. Idempotent: only if status is still requested/empty.
  if (order_id) {
    const cur = await admin
      .from("bookings")
      .select("id,status,vendor_status")
      .eq("id", order_id)
      .eq("vendor_id", vendor_id)
      .single();

    if (cur.error) return json(500, { ok: false, error: "DB_ERROR", message: cur.error.message });

    const curStatus = String((cur.data as any)?.status || "").trim();
    const nextVendor = vendor_status;

    const patch: any = { vendor_status: nextVendor };

    // Bridge rule: vendor ready -> dispatch sees it
    // Only advance if booking hasn't progressed yet.
    const stillRequested = !curStatus || curStatus === "requested";
    const isReadySignal =
      nextVendor === "driver_arrived" ||
      nextVendor === "ready" ||
      nextVendor === "prepared" ||
      nextVendor === "pickup_ready";

    if (stillRequested && isReadySignal) {
      patch.status = "assigned";
    }

    const up = await admin
      .from("bookings")
      .update(patch)
      .eq("id", order_id)
      .eq("vendor_id", vendor_id)
      .select("*")
      .single();

    if (up.error) return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });

    return json(200, {
      ok: true,
      action: "updated",
      order_id: up.data?.id ?? order_id,
      vendor_status: up.data?.vendor_status ?? nextVendor,
      status: up.data?.status ?? curStatus,
      bridgedToDispatch: !!patch.status,
    });
  }

  // CREATE PATH (Phase 2D snapshot lock runs ONLY here)
// PHASE3C_TAKEOUT_COORDS_HYDRATE_START
// Goal: ensure takeout-created bookings have pickup/dropoff coords so LiveTrips can assign.
// No auth changes, no schema changes, schema-safe update only.

function pickNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickLatLng(obj: any): { lat: number | null; lng: number | null } {
  if (!obj) return { lat: null, lng: null };
  const lat =
    pickNum(obj.pickup_lat) ?? pickNum(obj.lat) ?? pickNum(obj.latitude) ?? pickNum(obj.location_lat) ?? pickNum(obj.pickupLatitude) ?? null;
  const lng =
    pickNum(obj.pickup_lng) ?? pickNum(obj.lng) ?? pickNum(obj.longitude) ?? pickNum(obj.location_lng) ?? pickNum(obj.pickupLongitude) ?? null;
  return { lat, lng };
}

function pickTown(obj: any): string | null {
  if (!obj) return null;
  const v = String(obj.town ?? obj.municipality ?? obj.city ?? obj.area ?? obj.zone_town ?? "").trim();
  return v ? v : null;
}

function pickVendorLabel(obj: any): string | null {
  if (!obj) return null;
  const v =
    String(obj.pickup_label ?? obj.location_label ?? obj.address_label ?? obj.address_text ?? obj.address ?? obj.store_name ?? obj.name ?? "").trim();
  return v ? v : null;
}

async function tryLoadOne(table: string, id: string): Promise<any | null> {
  try {
    const r = await admin!.from(table).select("*").eq("id", id).maybeSingle();
    if (r && !r.error && r.data) return r.data;
  } catch {}
  return null;
}

async function loadVendorMeta(vendor_id: string): Promise<any | null> {
  // try multiple common vendor tables, first that returns data wins
  const tables = ["vendors", "vendor_profiles", "vendor_settings", "vendor_accounts"];
  for (const t of tables) {
    const d = await tryLoadOne(t, vendor_id);
    if (d) return d;
  }
  return null;
}

async function loadPrimaryAddressByDeviceKey(deviceKey: string): Promise<any | null> {
  const dk = String(deviceKey || "").trim();
  if (!dk) return null;
  try {
    // table name used by your /api/passenger-addresses route is usually passenger_addresses
    const r = await admin!
      .from("passenger_addresses")
      .select("*")
      .eq("device_key", dk)
      .order("is_primary", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1);

    if (r && !r.error && Array.isArray(r.data) && r.data[0]) return r.data[0];
  } catch {}
  return null;
}

async function schemaSafeUpdateBooking(id: string, initial: Record<string, any>) {
  let payload: Record<string, any> = { ...initial };

  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await admin!.from("bookings").update(payload).eq("id", id).select("id").single();

    if (!res.error) return res;

    const msg = String((res.error as any)?.message || "");
    const m = msg.match(/Could not find the '([^']+)' column of 'bookings' in the schema cache/i);
    if (m && m[1]) {
      const col = String(m[1]);
      delete (payload as any)[col];
      continue;
    }
    return res;
  }

  return { data: null, error: { message: "DB_ERROR: schema-safe update retries exceeded" } } as any;
}
// PHASE3C_TAKEOUT_COORDS_HYDRATE_END

  const customer_name = String(body?.customer_name ?? body?.customerName ?? "").trim();
  const customer_phone = String(body?.customer_phone ?? body?.customerPhone ?? "").trim();
  const to_label = String(body?.to_label ?? body?.toLabel ?? "").trim();
  const note = String(body?.note ?? "").trim();

  const items_text = String(body?.items_text ?? "").trim();

  const items = normalizeItems(body);
  if (!items.length) {
    return json(400, { ok: false, error: "items_required", message: "items[] required" });
  }

  const subtotal = computeSubtotal(items);

  // Create booking row (schema-safe: auto-drop unknown columns and retry)
  async function insertBookingSchemaSafe(initial: Record<string, any>) {
    // Keep a mutable copy
    let payload: Record<string, any> = { ...initial };

    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await admin!.from("bookings").insert(payload).select("*").single();

      if (!res.error) return res;

      const msg = String((res.error as any)?.message || "");

      // Supabase schema cache error pattern
      const m = msg.match(/Could not find the '([^']+)' column of 'bookings' in the schema cache/i);
      if (m && m[1]) {
        const col = String(m[1]);
        // Remove unknown column and retry
        delete (payload as any)[col];
        continue;
      }

      // Any other DB error: stop
      return res;
    }

    return {
      data: null,
      error: { message: "DB_ERROR: schema-safe insert retries exceeded" },
    } as any;
  }

  const createPayload: Record<string, any> = {
    // Likely required / core
    vendor_id,
    service_type: "takeout",
    vendor_status,
    status: "requested",

    // Optional fields (will be auto-dropped if columns don't exist)
    rider_name: customer_name || null,
    rider_phone: customer_phone || null,

    customer_name: customer_name || null,
    customer_phone: customer_phone || null,

    to_label: to_label || null,
    dropoff_label: to_label || null,

    note: note || null,
    items_text: items_text || null,

    // Phase 2D requirement
    takeout_items_subtotal: subtotal,
  };

  const ins = await insertBookingSchemaSafe(createPayload);

  if (ins.error) return json(500, { ok: false, error: "DB_ERROR", message: ins.error.message });

  const bookingId = String(ins.data?.id ?? "");
  if (!bookingId) return json(500, { ok: false, error: "CREATE_FAILED", message: "Missing booking id after insert" });

  // PHASE3C_TAKEOUT_COORDS_HYDRATE_STEP_START
  try {
    // 1) vendor pickup coords (preferred)
    const vendorMeta = await loadVendorMeta(vendor_id);
    const vLL = pickLatLng(vendorMeta);
    const vTown = pickTown(vendorMeta);
    const vLabel = pickVendorLabel(vendorMeta);

    // 2) dropoff coords from passenger primary address if available (device_key comes from takeout page)
    const addr = await loadPrimaryAddressByDeviceKey(String(body?.device_key ?? body?.deviceKey ?? ""));
    const aLat =
      pickNum(addr?.dropoff_lat) ?? pickNum(addr?.lat) ?? pickNum(addr?.latitude) ?? pickNum(addr?.location_lat) ?? null;
    const aLng =
      pickNum(addr?.dropoff_lng) ?? pickNum(addr?.lng) ?? pickNum(addr?.longitude) ?? pickNum(addr?.location_lng) ?? null;

    // 3) accept coords if caller provided them (future-proof)
    const bPickupLat = pickNum(body?.pickup_lat ?? body?.pickupLat ?? null);
    const bPickupLng = pickNum(body?.pickup_lng ?? body?.pickupLng ?? null);
    const bDropLat = pickNum(body?.dropoff_lat ?? body?.dropoffLat ?? body?.to_lat ?? body?.toLat ?? null);
    const bDropLng = pickNum(body?.dropoff_lng ?? body?.dropoffLng ?? body?.to_lng ?? body?.toLng ?? null);

    const pickup_lat = bPickupLat ?? vLL.lat;
    const pickup_lng = bPickupLng ?? vLL.lng;

    // If we can't find a dropoff coordinate, fallback to pickup coords (pilot-safe: removes PROBLEM trips)
    const dropoff_lat = bDropLat ?? aLat ?? pickup_lat ?? null;
    const dropoff_lng = bDropLng ?? aLng ?? pickup_lng ?? null;

    const updatePayload: Record<string, any> = {
      // labels (schema-safe; unknown cols auto-dropped)
      pickup_label: vLabel || null,
      from_label: vLabel || null,

      dropoff_label: to_label || null,
      to_label: to_label || null,

      // coords
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,

      // town defaults help zoning
      town: vTown || null,
    };

    // only update if we have at least pickup coords (and ideally dropoff coords too)
    const hasAny =
      (pickup_lat != null && pickup_lng != null) || (dropoff_lat != null && dropoff_lng != null);

    if (hasAny) {
      await schemaSafeUpdateBooking(bookingId, updatePayload);
    }
  } catch {
    // fail-open: creation must succeed even if hydration fails
  }
  // PHASE3C_TAKEOUT_COORDS_HYDRATE_STEP_END


  // Snapshot lock (idempotent): if already exists, do not insert again
  let takeoutSnapshot: any = null;
  try {
    const already = await admin
      .from("takeout_order_items")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId);

    const existingCount = (already as any)?.count ?? 0;

    if (existingCount > 0) {
      // Ensure booking subtotal is set (repair only; do not re-snapshot)
      const cur = toNum((ins.data as any)?.takeout_items_subtotal);
      if (!(cur > 0) && subtotal > 0) {
        await admin!.from("bookings").update({ takeout_items_subtotal: subtotal }).eq("id", bookingId);
      }
      takeoutSnapshot = { ok: true, inserted: 0, subtotal, note: "already_snapshotted" };
    } else {
      const rowsToInsert = items.map((it) => ({
        booking_id: bookingId,
        menu_item_id: it.menu_item_id,
        name: it.name,
        price: toNum(it.price),
        quantity: Math.max(1, it.quantity || 1),
        snapshot_at: new Date().toISOString(),
      }));

      const snapIns = await admin.from("takeout_order_items").insert(rowsToInsert);
      if (snapIns.error) {
        takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "Insert failed: " + snapIns.error.message };
      } else {
        takeoutSnapshot = { ok: true, inserted: rowsToInsert.length, subtotal, note: "OK" };
      }
    }
  } catch (e: any) {
    takeoutSnapshot = { ok: false, inserted: 0, subtotal: 0, note: "Snapshot exception: " + String(e?.message || e) };
  }

  return json(200, {
    ok: true,
    action: "created",
    order_id: bookingId,
    takeout_items_subtotal: subtotal,
    takeoutSnapshot,
  });
}