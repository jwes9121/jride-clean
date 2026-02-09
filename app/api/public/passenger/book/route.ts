import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { headers } from "next/headers";


function jrideNightGateBypass(): boolean {
  try {
    const h = headers();
    const isTest = (h.get("x-jride-test") || "").trim() === "1";
    const bypass = (h.get("x-jride-bypass-night-gate") || "").trim() === "1";
    return isTest && bypass;
  } catch {
    return false;
  }
}
/* PHASE2D_SNAPSHOT_HELPERS_BEGIN */
function p2dNum(v:any){ const n=Number(v??0); return Number.isFinite(n)?n:0 }
function p2dQty(v:any){ const q=parseInt(String(v??1),10); return (Number.isFinite(q) && q>0)?q:1 }
function p2dPickItemsArray(body:any): any[] {
  const cands = [body?.items, body?.cart, body?.order_items, body?.takeout_items, body?.menu_snapshot];
  for (const x of cands) if (Array.isArray(x) && x.length) return x;
  return [];
}
function p2dPickId(it:any){ return String(it?.menu_item_id || it?.menuItemId || it?.id || it?.item_id || it?.itemId || "").trim() }
function p2dPickName(it:any){ return String(it?.name || it?.title || it?.label || "").trim() }
function p2dPickPrice(it:any){ return p2dNum(it?.price ?? it?.unit_price ?? it?.unitPrice ?? it?.amount ?? 0) }

async function p2dFetchMenuRowsForVendor(admin:any, vendorId:string): Promise<any[]> {
  // best-effort: tolerate table name differences
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
function p2dMenuById(menuRows:any[]): Record<string, any> {
  const m: Record<string, any> = {};
  for (const r of (menuRows || [])) {
    const id = String(r?.menu_item_id || r?.id || r?.item_id || r?.menuItemId || "").trim();
    if (id) m[id] = r;
  }
  return m;
}

async function p2dSnapshotTakeout(admin:any, bookingId:string, vendorId:string, body:any) {
  const itemsIn = p2dPickItemsArray(body);
  if (!bookingId || !vendorId || !itemsIn.length) return { ok:false, inserted:0, subtotal:0, note:"Missing vendor_id or items[]" };

  const menuRows = await p2dFetchMenuRowsForVendor(admin, vendorId);
  const byId = p2dMenuById(menuRows);

  const rows:any[] = [];
  let subtotal = 0;

  for (const it of itemsIn) {
    const mid = p2dPickId(it);
    const qty = p2dQty(it?.quantity ?? it?.qty ?? it?.count ?? 1);

    const mr = mid ? byId[mid] : null;
    const name = String((mr?.name ?? mr?.item_name ?? mr?.title) ?? p2dPickName(it) ?? "").trim();
    const price = p2dNum((mr?.price ?? mr?.unit_price ?? mr?.amount) ?? p2dPickPrice(it));

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

  if (!rows.length) return { ok:false, inserted:0, subtotal:0, note:"No valid items to snapshot" };

  const ins = await admin.from("takeout_order_items").insert(rows);
  if (ins?.error) return { ok:false, inserted:0, subtotal:0, note:"Snapshot insert failed: " + ins.error.message };

  const up = await admin.from("bookings").update({ service_type:"takeout", takeout_items_subtotal: subtotal }).eq("id", bookingId);
  if (up?.error) return { ok:true, inserted: rows.length, subtotal, note:"Subtotal update failed: " + up.error.message };

  return { ok:true, inserted: rows.length, subtotal };
}
/* PHASE2D_SNAPSHOT_HELPERS_END */
function inIfugaoBBox(lat: number, lng: number): boolean {
  // Conservative backend geofence (matches UI)
  return lat >= 16.5 && lat <= 17.2 && lng >= 120.8 && lng <= 121.4;
}
/* JRIDE_ENV_ECHO */
function jrideEnvEcho() {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let host = "";
  try { host = u ? new URL(u).host : ""; } catch { host = ""; }
  return {
    supabase_host: host || null,
    vercel_env: process.env.VERCEL_ENV || null,
    nextauth_url: process.env.NEXTAUTH_URL || null
  };
}
/* JRIDE_ENV_ECHO_END */

type BookReq = {
  passenger_name?: string | null;
  town?: string | null;

  from_label?: string | null;
  to_label?: string | null;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;

  service?: string | null;
};



/* PHASE2D_ORDER_SNAPSHOT_LOCK_BEGIN */
function isTakeoutReq(body: any): boolean {
  const s = String(body?.service || body?.service_type || body?.serviceType || body?.trip_type || body?.tripType || "").toLowerCase();
  if (s.includes("takeout") || s.includes("food") || s.includes("order")) return true;
  if (body?.vendor_id || body?.vendorId) return true;
  if (Array.isArray(body?.items) && body.items.length) return true;
  if (Array.isArray(body?.cart) && body.cart.length) return true;
  if (Array.isArray(body?.order_items) && body.order_items.length) return true;
  if (Array.isArray(body?.takeout_items) && body.takeout_items.length) return true;
  return false;
}

function pickItemsArray(body: any): any[] {
  const cands = [body?.items, body?.cart, body?.order_items, body?.takeout_items, body?.menu_items];
  for (const x of cands) if (Array.isArray(x) && x.length) return x;
  return [];
}

function num(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pickId(it: any): string {
  return String(it?.menu_item_id || it?.menuItemId || it?.id || it?.item_id || it?.itemId || "").trim();
}

function pickQty(it: any): number {
  const q = parseInt(String(it?.quantity ?? it?.qty ?? it?.count ?? 1), 10);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function pickName(it: any): string {
  return String(it?.name || it?.title || it?.label || "").trim();
}

function pickPrice(it: any): number {
  return num(it?.price ?? it?.unit_price ?? it?.unitPrice ?? it?.amount ?? 0);
}

async function fetchMenuRowsForVendor(supabase: any, vendorId: string): Promise<any[]> {
  // Try likely menu tables in order; select * to survive column differences.
  const tables = ["vendor_menu_items", "takeout_menu_items", "menu_items", "vendor_menu"];
  for (const t of tables) {
    try {
      const q = supabase.from(t).select("*").limit(1000);
      // try filter if vendor column exists (best effort)
      let r = await q.eq("vendor_id", vendorId);
      if (r?.error) {
        r = await supabase.from(t).select("*").limit(1000); // fallback no filter
      }
      if (!r?.error && Array.isArray(r.data)) return r.data;
    } catch {}
  }
  return [];
}

function mapMenuById(menuRows: any[]): Record<string, any> {
  const m: Record<string, any> = {};
  for (const r of (menuRows || [])) {
    const id =
      String(r?.menu_item_id || r?.id || r?.item_id || r?.menuItemId || "").trim();
    if (id) m[id] = r;
  }
  return m;
}

async function snapshotTakeoutOrNull(supabase: any, bookingId: string, body: any): Promise<{ ok: boolean; subtotal: number; inserted: number; note?: string }> {
  const vendorId = String(body?.vendor_id || body?.vendorId || "").trim();
  const itemsIn = pickItemsArray(body);
  if (!vendorId || !itemsIn.length) return { ok: false, subtotal: 0, inserted: 0, note: "Missing vendor_id or items[]" };

  const menuRows = await fetchMenuRowsForVendor(supabase, vendorId);
  const byId = mapMenuById(menuRows);

  const rows: any[] = [];
  let subtotal = 0;

  for (const it of itemsIn) {
    const mid = pickId(it);
    const qty = pickQty(it);

    const mr = mid ? byId[mid] : null;
    const name = String((mr?.name ?? mr?.item_name ?? mr?.title) ?? pickName(it) ?? "").trim();
    const price = num((mr?.price ?? mr?.unit_price ?? mr?.amount) ?? pickPrice(it) ?? 0);

    if (!name || !Number.isFinite(price)) continue;

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

  if (!rows.length) return { ok: false, subtotal: 0, inserted: 0, note: "No valid items to snapshot" };

  const ins = await supabase.from("takeout_order_items").insert(rows);
  if (ins?.error) return { ok: false, subtotal: 0, inserted: 0, note: "Insert snapshot failed: " + ins.error.message };

  const up = await supabase.from("bookings").update({ takeout_items_subtotal: subtotal }).eq("id", bookingId);
  if (up?.error) return { ok: true, subtotal, inserted: rows.length, note: "Subtotal update failed: " + up.error.message };

  return { ok: true, subtotal, inserted: rows.length };
}
/* PHASE2D_ORDER_SNAPSHOT_LOCK_END */
function codeNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}${m}${day}${hh}${mm}${ss}`;
}

function rand4() {
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

async function canBookOrThrow(supabase: ReturnType<typeof createClient>) {
  const out: any = { ok: true };

  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12: false, hour: "2-digit" });
  const hour = parseInt(fmt.format(new Date()), 10);
  const nightGate = hour >= 20 || hour < 5;

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;

  let verified = false;
  if (user) {
    const email = user.email ?? null;
    const userId = user.id;
    const selV = "is_verified,verified,verification_tier";
    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase.from("passengers").select(selV).eq(col, val).limit(1).maybeSingle();
      if (!r.error && r.data) {
        const row: any = r.data;
        const truthy = (v: any) =>
          v === true ||
          (typeof v === "string" && v.trim().toLowerCase() !== "" && v.trim().toLowerCase() !== "false") ||
          (typeof v === "number" && v > 0);
        verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
        break;
      }
    }
  }
if (nightGate && !verified && !jrideNightGateBypass()) {
    out.ok = false;
    out.status = 403;
    out.code = "NIGHT_GATE_UNVERIFIED";
    out.message = "Booking is restricted from 8PM to 5AM unless verified.";
    throw out;
  }

  if (user) {
    const email = user.email ?? null;
    const userId = user.id;
    const selW = "wallet_balance,min_wallet_required,wallet_locked";
    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase.from("passengers").select(selW).eq(col, val).limit(1).maybeSingle();
      if (r.error) break; // fail-open
      if (r.data) {
        const row: any = r.data;
        const locked = row.wallet_locked === true;
        const bal = typeof row.wallet_balance === "number" ? row.wallet_balance : null;
        const min = typeof row.min_wallet_required === "number" ? row.min_wallet_required : null;

        if (locked) {
          out.ok = false;
          out.status = 402;
          out.code = "WALLET_LOCKED";
          out.message = "Wallet is locked.";
          throw out;
        }
        if (typeof bal === "number" && typeof min === "number" && bal < min) {
          out.ok = false;
          out.status = 402;
          out.code = "WALLET_INSUFFICIENT";
          out.message = "Insufficient wallet balance.";
          throw out;
        }
        break;
      }
    }
  }

  return true;
}

/* FREE_RIDE_PROMO_HELPERS_BEGIN */
function frTruthy(v:any): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s !== "" && s !== "false" && s !== "0" && s !== "no";
  }
  return false;
}

async function frGetUserAndVerified(supabase:any): Promise<{ user:any|null; verified:boolean }> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user || null;
  if (!user) return { user: null, verified: false };

  const meta:any = user.user_metadata || {};
  const verified =
    frTruthy(meta?.verified) ||
    frTruthy(meta?.is_verified) ||
    frTruthy(meta?.verification_tier) ||
    frTruthy(meta?.night_allowed);

  return { user, verified };
}

async function frForfeitIfNeeded(supabase:any, passengerId:string, reason:string) {
  if (!passengerId) return;
  // Only set forfeited if no row exists yet
  const ex = await supabase.from("passenger_free_ride_audit").select("status").eq("passenger_id", passengerId).maybeSingle();
  if (!ex.error && ex.data) return;

  await supabase.from("passenger_free_ride_audit").insert({
    passenger_id: passengerId,
    status: "forfeited",
    reason: reason,
    discount_php: 35,
    driver_credit_php: 20,
    platform_cost_php: 15,
    forfeited_at: new Date().toISOString(),
  });
}

async function frMarkUsedIfEligible(supabase:any, passengerId:string, bookingId:string) {
  if (!passengerId || !bookingId) return;

  const ex = await supabase
    .from("passenger_free_ride_audit")
    .select("*")
    .eq("passenger_id", passengerId)
    .maybeSingle();

  if (!ex.error && ex.data) {
    const st = String(ex.data.status || "");
    if (st === "used" || st === "forfeited") return;
    // eligible -> used
    await supabase.from("passenger_free_ride_audit").update({
      status: "used",
      trip_id: bookingId,
      used_at: new Date().toISOString(),
      reason: ex.data.reason || "verified_first_booking",
      discount_php: ex.data.discount_php ?? 35,
      driver_credit_php: ex.data.driver_credit_php ?? 20,
      platform_cost_php: ex.data.platform_cost_php ?? 15,
    }).eq("passenger_id", passengerId);
    return;
  }

  // No row yet -> create used now (burn on first verified booking to avoid abuse)
  await supabase.from("passenger_free_ride_audit").insert({
    passenger_id: passengerId,
    status: "used",
    reason: "verified_first_booking",
    trip_id: bookingId,
    discount_php: 35,
    driver_credit_php: 20,
    platform_cost_php: 15,
    used_at: new Date().toISOString(),
  });
}
/* FREE_RIDE_PROMO_HELPERS_END */
async function getBaseUrlFromHeaders(req: Request) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  // JRIDE_TEST_BYPASS_PILOT_TOWN
  // Allows test bookings to bypass pilot-town restriction ONLY when explicit test headers are present.
  const hx = (k: string) => {
    try { return String((req as any)?.headers?.get?.(k) || "").trim(); } catch { return ""; }
  };
  const jrideTestBypass = (hx("x-jride-test") === "1" && hx("x-jride-bypass-location") === "1");
  // JRIDE_TEST_BYPASS_PILOT_TOWN_END

  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as BookReq;

  

  const isTakeout = isTakeoutReq(body as any);

  /* FREE_RIDE_PROMO_APPLY_BEGIN */
  const uv = await frGetUserAndVerified(supabase as any);
  const user = uv.user;
  const isVerified = uv.verified;

  // Always attach creator (bookings has created_by_user_id in your schema)
  // If insert fails due to column mismatch, fallback logic already exists below.
  const createdByUserId = user?.id ? String(user.id) : null;

  // TAKEOUT REQUIRES VERIFIED (always, per business rule)
  if (isTakeout && !isVerified) {
    return NextResponse.json(
      { ok: false, code: "TAKEOUT_REQUIRES_VERIFIED", message: "Verify your account to order takeout during pilot." },
      { status: 403 }
    );
  }
  /* FREE_RIDE_PROMO_APPLY_END */
// PHASE13-E2_BACKEND_PILOT_TOWN_GATE
  // Enforce pilot pickup towns (UI + backend parity)
  const PILOT_TOWNS = ["Lagawe", "Hingyon", "Banaue"] as const;
  const pickupTown = String((body as any)?.town || "").trim();
  const pilotTownAllowed = PILOT_TOWNS.includes(pickupTown as any);

  if (!pilotTownAllowed) {
    if (!jrideTestBypass) {
    return NextResponse.json(
      {
        ok: false,
        code: "PILOT_TOWN_DISABLED",
        message: "Pickup in Kiangan/Lamut is temporarily unavailable during pilot.",
      },
      { status: 403 }
    );
    }
  }

  // PHASE13-B_BACKEND_GEO_GATE
  // Booking must include location and must be inside Ifugao (conservative bbox).
  // Phase 13-C1: allow a local verification code fallback (QR/referral/admin code).
  const expectedLocal = String(process.env.JRIDE_LOCAL_VERIFY_CODE || "").trim();
  const providedLocal = String(((body as any)?.local_verification_code || (body as any)?.local_verify || "")).trim();
  const localOk = !!expectedLocal && !!providedLocal && (providedLocal === expectedLocal);

  const lat = Number((body as any)?.pickup_lat);
  const lng = Number((body as any)?.pickup_lng);
  if (!localOk && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
    return NextResponse.json(
      { ok: false, code: "GEO_REQUIRED", message: "Location is required to book a ride." },
      { status: 400 }
    );
  }
  if (!localOk && Number.isFinite(lat) && Number.isFinite(lng) && !inIfugaoBBox(lat, lng)) {
    return NextResponse.json(
      { ok: false, code: "GEO_OUTSIDE_IFUGAO", message: "Booking is only allowed inside Ifugao." },
      { status: 403 }
    );
  }
  try {
    await canBookOrThrow(supabase);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: e.code || "CAN_BOOK_FAILED", message: e.message || "Not allowed" },
      { status: e.status || 403 }
    );
  }

  const booking_code = isTakeout
    ? `TAKEOUT-UI-${codeNow()}-${rand4()}`
    : `JR-UI-${codeNow()}-${rand4()}`;const payload: any = {
    booking_code,
    passenger_name: body.passenger_name ?? null,
    from_label: body.from_label ?? null,
    to_label: body.to_label ?? null,
    town: body.town ?? null,
    pickup_lat: body.pickup_lat ?? null,
    pickup_lng: body.pickup_lng ?? null,
    dropoff_lat: body.dropoff_lat ?? null,
    dropoff_lng: body.dropoff_lng ?? null,
    status: "requested",
  };

  /* PHASE2D_PAYLOAD_TAKEOUT_FIELDS */
  if (isTakeout) {
    const vendorId = String((body as any)?.vendor_id || (body as any)?.vendorId || "").trim();
    (payload as any).service_type = "takeout";
    (payload as any).vendor_id = vendorId || null;
    (payload as any).vendor_status = "preparing";
    (payload as any).takeout_items_subtotal = 0;
    // Optional pass-through fields if provided by UI (safe)
    (payload as any).customer_phone = (body as any)?.customer_phone ?? (body as any)?.customerPhone ?? null;
    (payload as any).delivery_address = (body as any)?.delivery_address ?? (body as any)?.deliveryAddress ?? null;
    (payload as any).note = (body as any)?.note ?? null;
  }

  const ins = await supabase.from("bookings").insert(payload).select("*").maybeSingle();
  if (ins.error) {
    const payload2: any = { ...payload };
    delete payload2.status;

    const ins2 = await supabase.from("bookings").insert(payload2).select("*").maybeSingle();
    if (ins2.error) {
      console.error("[passenger/book] insert error", ins2.error);
      return NextResponse.json({ ok: false, code: "BOOKING_INSERT_FAILED", message: ins2.error.message }, { status: 500 });
    }

    let booking: any = ins2.data;

    // best-effort set status requested
    await supabase.from("bookings").update({ status: "requested" }).eq("id", String(booking.id));

    /* PHASE2D_SKIP_ASSIGN_FOR_TAKEOUT */
    // Phase 6H2: CALL DISPATCH ASSIGN (single source of truth, includes busy lock)
    const baseUrl = await getBaseUrlFromHeaders(req);
    let assign: any = { ok: false, note: "Assignment skipped." };

    if (!isTakeout) {
      try {
        const resp = await fetch(`${baseUrl}/api/dispatch/assign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ booking_id: String(booking.id) }),
        });
        const j = await resp.json().catch(() => ({}));
        assign = j;
      } catch (err: any) {
        assign = { ok: false, note: "Assign call failed: " + String(err?.message || err) };
      }
    } else {
      assign = { ok: true, skipped: true, reason: "takeout_booking" };
    }
/* PHASE2D_SKIP_ASSIGN_FOR_TAKEOUT_END */// re-read booking for final status/driver_id
    const reread = await supabase.from("bookings").select("*").eq("id", String(booking.id)).maybeSingle();
    if (!reread.error && reread.data) booking = reread.data;

    

    /* PHASE2D_TAKEOUT_SNAPSHOT_INS2 */
    let takeoutSnapshot: any = null;
    if (isTakeout) {
      try {
        takeoutSnapshot = await snapshotTakeoutOrNull(supabase as any, String(booking.id), body as any);
      } catch (e: any) {
        takeoutSnapshot = { ok: false, note: "Snapshot threw: " + String(e?.message || e) };
      }
    }

    // FREE_RIDE_PROMO_INS2_MARK
    try {
      const takeout = isTakeout;
      const bid = booking?.id ? String(booking.id) : "";
      if (createdByUserId && bid && !takeout) {
        if (!isVerified) {
          await frForfeitIfNeeded(supabase as any, createdByUserId, "booked_unverified");
        } else {
          await frMarkUsedIfEligible(supabase as any, createdByUserId, bid);
        }
      }
    } catch {}

    return NextResponse.json({ ok: true, env: jrideEnvEcho(), booking_code, booking, assign, takeoutSnapshot }, { status: 200 });
  }

  let booking: any = ins.data;

  // FREE RIDE PROMO RULES (RIDES ONLY)
  // - If unverified and tries to book a ride: forfeit promo immediately (even if later verified)
  // - If verified and promo not yet used/forfeited: mark used on this booking to prevent abuse
  try {
    const svc = String((payload as any)?.service_type ?? (payload as any)?.serviceType ?? (payload as any)?.service ?? "").toLowerCase();
    const takeout = svc.includes("takeout") || !!(payload as any)?.vendor_id;
    const bid = booking?.id ? String(booking.id) : "";
    if (createdByUserId && bid && !takeout) {
      if (!isVerified) {
        await frForfeitIfNeeded(supabase as any, createdByUserId, "booked_unverified");
      } else {
        await frMarkUsedIfEligible(supabase as any, createdByUserId, bid);
      }
    }
  } catch {}
  // PHASE 2D: ORDER SNAPSHOT LOCK (TAKEOUT)
  // Freeze items + compute subtotal + store on booking. Menu edits won't affect history.
  try {
    const svc = String((payload as any)?.service || (payload as any)?.service_type || (payload as any)?.serviceType || "").toLowerCase();
    const isTakeout = svc.includes("takeout") || !!(payload as any)?.vendor_id || !!(payload as any)?.vendorId;
    if (isTakeout) {
      const bookingId = String((booking as any)?.id || "");
      const vendorId = String((payload as any)?.vendor_id || (payload as any)?.vendorId || "").trim();
      if (bookingId && vendorId) {
        // use same client used for insert
        const takeoutSnapshot = await p2dSnapshotTakeout(supabase as any, bookingId, vendorId, payload as any);
        // best-effort (do not fail booking)
        (booking as any).takeoutSnapshot = takeoutSnapshot;
      }
    }
  } catch (e) {
    console.error("[PHASE2D] snapshot failed", e);
  }

  

  /* PHASE2D_TAKEOUT_SNAPSHOT_INS1 */
  let takeoutSnapshot: any = null;
  if (isTakeout) {
    try {
      takeoutSnapshot = await snapshotTakeoutOrNull(supabase as any, String(booking.id), body as any);
    } catch (e: any) {
      takeoutSnapshot = { ok: false, note: "Snapshot threw: " + String(e?.message || e) };
    }
  }// Phase 6H2: CALL DISPATCH ASSIGN (single source of truth, includes busy lock)
  const baseUrl = await getBaseUrlFromHeaders(req);
  let assign: any = { ok: false, note: "Assignment skipped." };
  try {
    const resp = await fetch(`${baseUrl}/api/dispatch/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ booking_id: String(booking.id) }),
    });
    const j = await resp.json().catch(() => ({}));
    assign = j;
  } catch (err: any) {
    assign = { ok: false, note: "Assign call failed: " + String(err?.message || err) };
  }

  // re-read booking for final status/driver_id
  const reread = await supabase.from("bookings").select("*").eq("id", String(booking.id)).maybeSingle();
  if (!reread.error && reread.data) booking = reread.data;

  return NextResponse.json({ ok: true, env: jrideEnvEcho(), booking_code, booking, assign, takeoutSnapshot }, { status: 200 });
}





