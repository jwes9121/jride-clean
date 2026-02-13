import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

// PHASE_3D_TAKEOUT_COORDS_HELPERS
type LatLng = { lat: number | null; lng: number | null };

function isFiniteNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

// Treat 0/0 as invalid for this app (Ifugao coords will never be 0/0)
function normalizeLL(ll: LatLng): LatLng {
  const lat = isFiniteNum(ll?.lat);
  const lng = isFiniteNum(ll?.lng);
  if (lat == null || lng == null) return { lat: null, lng: null };
  if (lat === 0 || lng === 0) return { lat: null, lng: null };
  return { lat, lng };
}

function pickLatLng(obj: any): LatLng {
  if (!obj || typeof obj !== "object") return { lat: null, lng: null };

  const keys = Object.keys(obj);
  const lowerMap: Record<string, any> = {};
  for (const k of keys) lowerMap[k.toLowerCase()] = (obj as any)[k];

  const latKeys = ["lat","latitude","location_lat","pickup_lat","from_lat","start_lat","vendor_lat","store_lat","merchant_lat"];
  const lngKeys = ["lng","lon","longitude","location_lng","pickup_lng","from_lng","start_lng","vendor_lng","store_lng","merchant_lng"];

  function firstNum(cands: string[]) {
    for (const k of cands) {
      if (k in lowerMap) {
        const n = Number(lowerMap[k]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  const lat = firstNum(latKeys);
  const lng = firstNum(lngKeys);

  return normalizeLL({ lat, lng });
}

function pickTown(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  const keys = Object.keys(obj);
  const lower: Record<string, any> = {};
  for (const k of keys) lower[k.toLowerCase()] = (obj as any)[k];
  const cands = ["town","municipality","lgu","city"];
  for (const k of cands) {
    if (k in lower) {
      const v = String(lower[k] ?? "").trim();
      if (v) return v;
    }
  }
  return null;
}

function inferTownFromLabel(label: string | null): string | null {
  const s = String(label || "").toLowerCase();
  if (!s) return null;
  const towns = ["kiangan","lagawe","hingyon","lamut","banaue"];
  for (const t of towns) {
    if (s.includes(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return null;
}

async function tryFetchRowById(admin: any, table: string, idField: string, idValue: string) {
  try {
    const res = await admin.from(table).select("*").eq(idField, idValue).limit(1);
    if (res.error) return null;
    const row = Array.isArray(res.data) ? res.data[0] : null;
    return row || null;
  } catch {
    return null;
  }
}

async function mapboxGeocode(label: string): Promise<LatLng> {
  const q = String(label || "").trim();
  if (!q) return { lat: null, lng: null };

  const token =
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.MAPBOX_TOKEN ||
    "";

  if (!token) return { lat: null, lng: null };

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    encodeURIComponent(q) +
    ".json?limit=1&language=en&access_token=" +
    encodeURIComponent(token);

  try {
    const r = await fetch(url, { method: "GET" });
    const j: any = await r.json().catch(() => null);
    const f = j?.features?.[0];
    const center = Array.isArray(f?.center) ? f.center : null; // [lng,lat]
    const lng = center && center.length >= 2 ? Number(center[0]) : null;
    const lat = center && center.length >= 2 ? Number(center[1]) : null;
    return normalizeLL({ lat, lng });
  } catch {
    return { lat: null, lng: null };
  }
}

async function fetchVendorCoordsAndTown(admin: any, vendorId: string): Promise<{ ll: LatLng; town: string | null }> {
  const candidates: Array<[string, string]> = [
    ["vendor_accounts", "id"],
    ["vendor_accounts", "email"],
    ["vendor_accounts", "display_name"],
    ["vendor_accounts", "location_label"],
  ];

  for (const [table, key] of candidates) {
    const row = await tryFetchRowById(admin, table, key, vendorId);
    if (!row) continue;
    const ll = pickLatLng(row);
    const town = pickTown(row);
    if (ll.lat != null && ll.lng != null) return { ll, town };
    if (town) return { ll: { lat: null, lng: null }, town };
  }

  return { ll: { lat: null, lng: null }, town: null };
}

async function fetchAddressCoords(admin: any, deviceKey: string, addressId: string | null, addressText: string | null): Promise<LatLng> {
  try {
    if (addressId) {
      const byId = await admin.from("passenger_addresses").select("*").eq("id", addressId).limit(1);
      const row = Array.isArray(byId.data) ? byId.data[0] : null;
      const ll = pickLatLng(row);
      if (ll.lat != null && ll.lng != null) return ll;
    }
  } catch {}

  try {
    const dk = String(deviceKey || "").trim();
    if (dk) {
      const pri = await admin
        .from("passenger_addresses")
        .select("*")
        .eq("device_key", dk)
        .order("is_primary", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1);

      const row = Array.isArray(pri.data) ? pri.data[0] : null;
      const ll = pickLatLng(row);
      if (ll.lat != null && ll.lng != null) return ll;
    }
  } catch {}

  if (addressText) {
    const ll = await mapboxGeocode(addressText);
    if (ll.lat != null && ll.lng != null) return ll;
  }

  return { lat: null, lng: null };
}
// PHASE_3D_TAKEOUT_COORDS_HELPERS_END


export const dynamic = "force-dynamic";
/* PHASE_3E_TOWNZONE_DERIVE_START */
function deriveTownFromLatLng(lat: number | null, lng: number | null): string | null {
  const la = (lat == null ? NaN : Number(lat));
  const lo = (lng == null ? NaN : Number(lng));
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

  // Rough Ifugao municipality boxes (fallback).
  const BOXES: Array<{ name: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
    { name: "Lagawe",  minLat: 17.05, maxLat: 17.16, minLng: 121.10, maxLng: 121.30 },
    { name: "Kiangan", minLat: 16.98, maxLat: 17.10, minLng: 121.05, maxLng: 121.25 },
    { name: "Lamut",   minLat: 16.86, maxLat: 17.02, minLng: 121.10, maxLng: 121.28 },
    { name: "Hingyon", minLat: 17.10, maxLat: 17.22, minLng: 121.00, maxLng: 121.18 },
    { name: "Banaue",  minLat: 16.92, maxLat: 17.15, minLng: 121.02, maxLng: 121.38 },
  ];

  for (const b of BOXES) {
    if (la >= b.minLat && la <= b.maxLat && lo >= b.minLng && lo <= b.maxLng) return b.name;
  }
  return null;
}

function deriveZoneFromTown(town: string | null): string | null {
  const t = String(town || "").trim();
  return t ? t : null; // zone==town for now
}
/* PHASE_3E_TOWNZONE_DERIVE_END */


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

  // PHASE_3F_TAKEOUT_COORDS_TOWN
  const device_key = String(body?.device_key ?? body?.deviceKey ?? "").trim();
  const address_id = String(body?.address_id ?? body?.addressId ?? "").trim() || null;

  const to_label_hint = String(body?.to_label ?? body?.toLabel ?? body?.address_text ?? body?.addressText ?? "").trim() || null;

  const v = await fetchVendorCoordsAndTown(admin, vendor_id);
  const vendorLL = v.ll;
  const vendorTown = v.town;

  const dropLL = await fetchAddressCoords(admin, device_key, address_id, to_label_hint);

  const explicitTown = String((body as any)?.town ?? (body as any)?.municipality ?? "").trim() || null;
  const derivedTown =
    explicitTown ||
    vendorTown ||
    inferTownFromLabel(to_label_hint) ||
    deriveTownFromLatLng(vendorLL.lat, vendorLL.lng) ||
    null;

  const pickupLL = normalizeLL(vendorLL);
  const dropoffLL = normalizeLL(dropLL);
  // PHASE_3F_TAKEOUT_COORDS_TOWN_END
/* PHASE3I_TAKEOUT_COORDS_BASELINE_GUARD_START
   Ensure CREATE path will never write missing coords (prevents LiveTrips PROBLEM noise).
   Uses vars computed above in PHASE_3F:
   - pickupLL, dropoffLL, derivedTown
*/
const town = derivedTown;
const zone = deriveZoneFromTown(town) || town;

if (pickupLL?.lat == null || pickupLL?.lng == null || dropoffLL?.lat == null || dropoffLL?.lng == null) {
  return json(400, {
    ok: false,
    error: "TAKEOUT_COORDS_MISSING",
    message: "Missing pickup/dropoff coordinates. Check vendor_accounts lat/lng and passenger_addresses lat/lng (or Mapbox token fallback).",
    details: {
      pickup_lat: (pickupLL as any)?.lat ?? null,
      pickup_lng: (pickupLL as any)?.lng ?? null,
      dropoff_lat: (dropoffLL as any)?.lat ?? null,
      dropoff_lng: (dropoffLL as any)?.lng ?? null,
      town,
      zone,
    },
  });
}
/* PHASE3I_TAKEOUT_COORDS_BASELINE_GUARD_END */
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





  const createPayload: Record<string, any> = {    // PHASE_3D_TAKEOUT_COORDS_FIX fields






    // PHASE_3E_VENDORORDERS_TOWNZONE_FIELDS
    // bookings has 'town' column (no 'zone' column) - keep town only

    // Likely required / core


    vendor_id,


    service_type: "takeout",


    vendor_status,
  // PHASE_3F create-time town + coords (no 0/0)
  town: (typeof derivedTown !== "undefined" ? derivedTown : null),
        pickup_lat: (pickupLL as any)?.lat ?? null,
        pickup_lng: (pickupLL as any)?.lng ?? null,
        dropoff_lat: (dropoffLL as any)?.lat ?? null,
        dropoff_lng: (dropoffLL as any)?.lng ?? null,
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
  // PHASE3I_FORCE_COORDS_AUTHORITATIVE_START
  // DB appears to default coords to 0/0 on INSERT for takeout in some cases.
  // Force-correct via UPDATE immediately and surface any error (do NOT swallow).
  const forcePayload: Record<string, any> = {
    vendor_id,
      pickup_lat: (pickupLL as any)?.lat ?? null,
      pickup_lng: (pickupLL as any)?.lng ?? null,
      dropoff_lat: (dropoffLL as any)?.lat ?? null,
      dropoff_lng: (dropoffLL as any)?.lng ?? null,
    town: (typeof derivedTown !== "undefined" ? derivedTown : null),
  };

  const forceRes = await admin
    .from("bookings")
    .update(forcePayload)
    .eq("id", bookingId)
    .select("id,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,town")
    .single();

  if (forceRes.error) {
    return json(500, {
      ok: false,
      error: "FORCE_UPDATE_FAILED",
      message: forceRes.error.message,
      forcePayload,
    });
  }
  // PHASE3I_FORCE_COORDS_AUTHORITATIVE_END

  // PHASE3C_TAKEOUT_COORDS_HYDRATE_STEP_START


  try {


    // 1) vendor pickup coords (preferred)
    const vendorMeta =
      (await tryFetchRowById(admin, "vendor_accounts", "id", vendor_id)) ||
      (await tryFetchRowById(admin, "vendor_accounts", "email", vendor_id)) ||
      (await tryFetchRowById(admin, "vendor_accounts", "display_name", vendor_id)) ||
      (await tryFetchRowById(admin, "vendor_accounts", "location_label", vendor_id)) ||
      null;
    const vLL = pickLatLng(vendorMeta);


    const vTown = pickTown(vendorMeta);
    const vLabel =
      String((body as any)?.pickup_label ?? (body as any)?.from_label ?? (body as any)?.vendor_label ?? "").trim() ||
      null;
    // 2) dropoff coords from passenger primary address if available (device_key comes from takeout page)
    const _dk = String(body?.device_key ?? body?.deviceKey ?? "").trim();
    const _addrRes =
      _dk
        ? await admin
            .from("passenger_addresses")
            .select("*")
            .eq("device_key", _dk)
            .order("is_primary", { ascending: false })
            .order("updated_at", { ascending: false })
            .limit(1)
        : null;

    const addr =
      (_addrRes && !(_addrRes as any).error && Array.isArray((_addrRes as any).data) && (_addrRes as any).data[0])
        ? (_addrRes as any).data[0]
        : null;
    const aLat =
      isFiniteNum(addr?.lat) ?? null;
    const aLng =
      isFiniteNum(addr?.lng) ?? null;
    // 3) accept coords if caller provided them (future-proof)


    const bPickupLat = isFiniteNum(body?.pickup_lat ?? body?.pickupLat ?? null);


    const bPickupLng = isFiniteNum(body?.pickup_lng ?? body?.pickupLng ?? null);


    const bDropLat = isFiniteNum(body?.dropoff_lat ?? body?.dropoffLat ?? body?.to_lat ?? body?.toLat ?? null);


    const bDropLng = isFiniteNum(body?.dropoff_lng ?? body?.dropoffLng ?? body?.to_lng ?? body?.toLng ?? null);





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
      // town defaults help zoning


      town: vTown || null,


    };





    // only update if we have at least pickup coords (and ideally dropoff coords too)


    const hasAny =


      (pickup_lat != null && pickup_lng != null) || (dropoff_lat != null && dropoff_lng != null);





    if (hasAny) {
      // Inline schema-safe update (drop unknown booking columns and retry)
      let _payload: any = { ...(updatePayload as any) };

      let _lastErr: any = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const _res = await admin
          .from("bookings")
          .update(_payload)
          .eq("id", bookingId)
          .select("id")
          .single();

        if (!_res.error) {
          _lastErr = null;
          break;
        }

        _lastErr = _res.error;
        const msg = String((_res.error as any)?.message || "");
        const m =
          msg.match(/Could not find the '([^']+)' column of 'bookings' in the schema cache/i) ||
          msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"bookings"\s+does\s+not\s+exist/i);

        if (m && m[1]) {
          const col = String(m[1]);
          delete (_payload as any)[col];
          continue;
        }

        break; // unknown error -> stop retrying
      }

      if (_lastErr) {
        throw _lastErr;
      }
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





  // PHASE3I_VENDOR_ORDERS_COORDS_DEBUG
  let coords_debug: any = null;
  try {
    const chk = await admin
      .from("bookings")
      .select("id,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,town")
      .eq("id", bookingId)
      .single();
    coords_debug = (chk && !chk.error) ? chk.data : null;
  } catch {}
  // PHASE3I_VENDOR_ORDERS_COORDS_DEBUG_END
  return json(200, {


    ok: true,


    action: "created",


    order_id: bookingId,


    
    resolved_pickup: pickupLL ?? vendorLL ?? null,
    resolved_dropoff: dropoffLL ?? dropLL ?? null,
    db_coords: coords_debug,

takeout_items_subtotal: subtotal,


    takeoutSnapshot,


  });


}