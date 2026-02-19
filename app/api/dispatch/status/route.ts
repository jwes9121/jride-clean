import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type StatusReq = {
  booking_id?: string | null;
  booking_code?: string | null;
  status?: string | null;
  note?: string | null;
  force?: boolean | null;
};

const ALLOWED = [
  "requested",
  "assigned",
  "accepted",
  "fare_proposed",
  "on_the_way",
  "arrived",
  "enroute",
  "on_trip",
  "completed",
  "cancelled",
] as const;


/* JRIDE_COMPLETE_PROXIMITY_BEGIN */
const JRIDE_COMPLETE_RADIUS_M = Number(process.env.JRIDE_COMPLETE_RADIUS_M ?? 250);

// Haversine distance (meters)
function jrideHaversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000; // meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function jrideGetDriverCoords(supabase: any, driverId: string): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!driverId) return null;
    const { data, error } = await supabase
      .from("driver_locations")
      .select("lat,lng,updated_at")
      .eq("driver_id", driverId)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) return null;
    const row = Array.isArray(data) && data.length ? data[0] : null;
    const lat = Number(row?.lat);
    const lng = Number(row?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
/* JRIDE_COMPLETE_PROXIMITY_END */
const NEXT: Record<string, string[]> = {
  requested: ["assigned", "cancelled"],
  assigned: ["accepted", "on_the_way", "arrived", "enroute", "cancelled"],
  accepted: ["fare_proposed", "cancelled"],
  fare_proposed: ["on_the_way", "arrived", "enroute", "cancelled"],
  on_the_way: ["arrived", "enroute", "cancelled"],
  arrived: ["on_trip", "completed", "cancelled"],
  enroute: ["arrived", "on_trip", "completed", "cancelled"],
  on_trip: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function norm(v: any): string {
  let s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/[\s\-]+/g, "_");
  if (s === "new") return "requested";
  if (s === "ongoing") return "on_trip";
  return s;
}

function jsonOk(body: any, status = 200) {
return NextResponse.json(body, { status });
}

function jsonErr(code: string, message: string, status: number, extra?: any) {
return NextResponse.json(
    Object.assign({ ok: false, code, message }, extra || {}),
    { status }
  );
}

function getActorFromReq(req: Request): string {
  try {
    const h: any = (req as any)?.headers;
    const v =
      h?.get?.("x-dispatcher-id") ||
      h?.get?.("x-user-id") ||
      h?.get?.("x-admin-id") ||
      h?.get?.("x-actor") ||
      "system";
    return String(v || "system");
  } catch {
    return "system";
  }
}

async function bestEffortAudit(
  supabase: ReturnType<typeof createClient>,
  entry: {
    booking_id?: string | null;
    booking_code?: string | null;
    from_status?: string | null;
    to_status?: string | null;
    actor?: string | null;
    source?: string | null;
  }
): Promise<{ warning?: string }> {
  const payload: any = {
    booking_id: entry.booking_id ?? null,
    booking_code: entry.booking_code ?? null,
    from_status: entry.from_status ?? null,
    to_status: entry.to_status ?? null,
    actor: entry.actor ?? "system",
    source: entry.source ?? "dispatch/status",
    created_at: new Date().toISOString(),
  };

  const tables = ["dispatch_audit_log", "audit_log", "status_audit"];

  for (let i = 0; i < tables.length; i++) {
    const tbl = tables[i];
    try {
      const r: any = await supabase.from(tbl).insert(payload);
      if (!r?.error) return {};
    } catch {}
  }
  return {};
}

async function bestEffortDispatchAction(
  supabase: any,
  entry: {
    trip_id: string;
    driver_id?: string | null;
    from_status?: string | null;
    to_status?: string | null;
    dispatcher_id?: string | null;
    dispatcher_name?: string | null;
    source?: string | null;
  }
): Promise<{ warning?: string | null }> {
  // Match your real public.dispatch_actions schema:
  // dispatcher_id, dispatcher_name, trip_id, driver_id, action_type, note, meta
  const payload: any = {
    trip_id: entry.trip_id,
    driver_id: entry.driver_id ?? null,
    dispatcher_id: entry.dispatcher_id ?? null,
    dispatcher_name: entry.dispatcher_name ?? null,
    action_type: "status_change",
    note: null,
    meta: {
      from_status: entry.from_status ?? null,
      to_status: entry.to_status ?? null,
      source: entry.source ?? "dispatch/status",
    },
  };

  try {
    const r = await supabase.from("dispatch_actions").insert(payload);
    if (!r?.error) return { warning: null };
    return { warning: "DISPATCH_ACTIONS_INSERT_ERROR: " + String(r.error?.message || r.error) };
  } catch (e: any) {
    return { warning: "DISPATCH_ACTIONS_INSERT_THROW: " + String(e?.message || e) };
  }
}

async function fetchBooking(
  supabase: ReturnType<typeof createClient>,
  booking_id?: string | null,
  booking_code?: string | null
): Promise<{ data: any | null; error: string | null }> {
  try {
    if (booking_id) {
      const r = await supabase
        .from("bookings")
        .select("*, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, town, verified_fare")
        .eq("id", booking_id)
        .maybeSingle();
      return { data: r.data ?? null, error: r.error?.message || null };
    }
    if (booking_code) {
      const r = await supabase
        .from("bookings")
        .select("*")
        .eq("booking_code", booking_code)
        .maybeSingle();
      return { data: r.data ?? null, error: r.error?.message || null };
    }
    return { data: null, error: "Missing booking_id or booking_code" };
  } catch (e: any) {
    return { data: null, error: e?.message || "Booking lookup failed" };
  }
}

async function tryUpdateBooking(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  patch: Record<string, any>
): Promise<{ ok: boolean; data: any | null; error: string | null }> {
  try {
    const r = await supabase
      .from("bookings")
      .update(patch)
      .eq("id", bookingId)
      .select("*")
      .maybeSingle();
    if (r.error) return { ok: false, data: null, error: r.error.message };
    return { ok: true, data: r.data ?? null, error: null };
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message || "Booking update failed" };
  }
}

// Best-effort: keep driver status roughly aligned (non-blocking)
function driverStatusForBookingStatus(status: string): string | null {
  const s = norm(status);
  // IMPORTANT: do NOT overwrite ONLINE/AVAILABLE with "assigned" (prevents UI showing OFFLINE).`n  if (s === "assigned") return null;
  if (s === "on_the_way" || s === "enroute") return "on_the_way";
  if (s === "arrived") return "arrived";
  if (s === "on_trip") return "on_trip";
  if (s === "completed") return "available";
  if (s === "cancelled") return "available";
  return null;
}

async function bestEffortUpdateDriverLocation(
  supabase: ReturnType<typeof createClient>,
  driverId: string,
  bookingStatus: string
): Promise<{ warning?: string }> {
  // Guard: this helper must return an object (never void) to satisfy Promise<{ warning?: string }>.
  if (!driverId) return {};
  if (!bookingStatus) return {};

  const mapped = driverStatusForBookingStatus(bookingStatus);
  
    if (!mapped) return {}; // do not overwrite driver_locations.status when mapping is null
    if (!driverId || !mapped) return {};

  try {
    const r = await supabase
      .from("driver_locations")
      .update({ status: mapped, updated_at: new Date().toISOString() })
      .eq("driver_id", driverId);

    if (r.error) {
      return { warning: "DRIVER_LOCATION_STATUS_UPDATE_ERROR: " + r.error.message };
    }
    return {};
  } catch (e: any) {
    return { warning: "DRIVER_LOCATION_STATUS_UPDATE_ERROR: " + (e?.message || "Unknown error") };
  }
}

/**
 * PHASE 3L - wallet sync (completion only)
 * IMPORTANT: Do NOT call admin_finalize_trip_and_credit_wallets(text)
 * because you have a DB trigger that credits driver wallet on status -> completed.
 * Calling finalize could double-credit driver earnings.
 *
 * What we DO:
 * - apply platform cut via process_booking_wallet_cut(p_booking_id uuid)
 * - for takeout: sync vendor wallet via sync_vendor_takeout_wallet(v_vendor_id uuid)
 */
/* ===== JRIDE STEP 5E: EMERGENCY WALLET SPLIT ===== */
const STEP5E_DRIVER_CREDIT = 20;
const STEP5E_COMPANY_FEE = 15;

async function step5eHasDriverCredit(supabase: any, bookingId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("driver_wallet_transactions")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("reason", "emergency_pickup_fee_driver")
      .limit(1);

    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

async function step5eNextDriverBalanceAfter(supabase: any, driverId: string, delta: number): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("driver_wallet_transactions")
      .select("balance_after")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) return delta;
    const last = Array.isArray(data) && data.length > 0 ? Number(data[0]?.balance_after ?? 0) : 0;
    const next = last + Number(delta);
    return Number.isFinite(next) ? next : Number(delta);
  } catch {
    return Number(delta);
  }
}

async function step5eHasCompanyFee(supabase: any, bookingCode: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("vendor_wallet_transactions")
      .select("id")
      .eq("booking_code", bookingCode)
      .eq("kind", "company_convenience_fee")
      .eq("amount", STEP5E_COMPANY_FEE)
      .limit(1);

    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

async function step5eBestEffortEmergencyWalletSplit(
  supabase: any,
  booking: any,
  warnings: string[]
): Promise<void> {
  try {
    const isEmergency = Boolean(booking?.is_emergency);
    if (!isEmergency) return;

    const bookingId = String(booking?.id ?? "").trim();
    const bookingCode = String(booking?.booking_code ?? "").trim();
    const driverId = String(booking?.driver_id ?? "").trim();

    if (!bookingId || !driverId) {
  const warnings: string[] = [];

      ((globalThis as any).__jrideWarnings ??= []).push("STEP5E_MISSING_BOOKING_OR_DRIVER");
      return;
    }

    // ---- Driver +20 (idempotent by booking_id + reason) ----
    const alreadyDriver = await step5eHasDriverCredit(supabase, bookingId);
    if (!alreadyDriver) {
      const balanceAfter = await step5eNextDriverBalanceAfter(supabase, driverId, STEP5E_DRIVER_CREDIT);
      const { error } = await supabase.from("driver_wallet_transactions").insert({
        driver_id: driverId,
        amount: STEP5E_DRIVER_CREDIT,
        balance_after: balanceAfter,
        reason: "emergency_pickup_fee_driver",
        booking_id: bookingId,
      });
      if (error) ((globalThis as any).__jrideWarnings ??= []).push("STEP5E_DRIVER_LEDGER_INSERT_FAILED: " + error.message);
    }

    // ---- Company +15 (idempotent by booking_code + kind + amount) ----
    if (!bookingCode) {
      ((globalThis as any).__jrideWarnings ??= []).push("STEP5E_MISSING_BOOKING_CODE_FOR_COMPANY_LEDGER");
      return;
    }

    const alreadyCompany = await step5eHasCompanyFee(supabase, bookingCode);
    if (!alreadyCompany) {
      const { error } = await supabase.from("vendor_wallet_transactions").insert({
        vendor_id: null,
        booking_code: bookingCode,
        amount: STEP5E_COMPANY_FEE,
        kind: "company_convenience_fee",
        note: "Emergency convenience fee",
      });

      if (error) ((globalThis as any).__jrideWarnings ??= []).push("STEP5E_COMPANY_LEDGER_INSERT_FAILED: " + error.message);
    }
  } catch (e: any) {
    ((globalThis as any).__jrideWarnings ??= []).push("STEP5E_UNEXPECTED: " + String(e?.message ?? e ?? "Unknown"));
  }
}
/* ===== END JRIDE STEP 5E ===== */
async function bestEffortWalletSyncOnComplete(
  supabase: ReturnType<typeof createClient>,
  booking: any
): Promise<{ warning?: string }> {
  const bookingId = booking?.id ? String(booking.id) : null;
  const serviceType = String(booking?.service_type ?? booking?.serviceType ?? "").toLowerCase();
  const vendorId = booking?.vendor_id ? String(booking.vendor_id) : null;

  

  // STEP5E_CALL_SITE: Emergency fee wallet split (idempotent, completion-only)
  await step5eBestEffortEmergencyWalletSplit(supabase, booking, []);


  // 1) Apply platform/company cut (driver wallet deduction)
  if (bookingId) {
  const warnings: string[] = [];    try {
      const r: any = await supabase.rpc("process_booking_wallet_cut", {
        p_booking_id: bookingId,
      });
      if (r?.error) ((globalThis as any).__jrideWarnings ??= []).push("WALLET_CUT_RPC_ERROR: " + r.error.message);
    } catch (e: any) {
      ((globalThis as any).__jrideWarnings ??= []).push("WALLET_CUT_RPC_ERROR: " + String(e?.message || e));
    }
  } else {
    ((globalThis as any).__jrideWarnings ??= []).push("WALLET_CUT_SKIPPED_NO_BOOKING_ID");
  }

  // 2) Vendor wallet for takeout only
  if (serviceType === "takeout" && vendorId) {
    try {
      const r: any = await supabase.rpc("sync_vendor_takeout_wallet", {
        v_vendor_id: vendorId,
      });
      if (r?.error) ((globalThis as any).__jrideWarnings ??= []).push("VENDOR_SYNC_RPC_ERROR: " + r.error.message);
    } catch (e: any) {
      ((globalThis as any).__jrideWarnings ??= []).push("VENDOR_SYNC_RPC_ERROR: " + String(e?.message || e));
    }
  }

  return ((globalThis as any).__jrideWarnings ?? []).length ? { warning: ((globalThis as any).__jrideWarnings ?? []).join("; ") } : {};
}


/* FREE_RIDE_DRIVER_CREDIT_BEGIN */
async function freeRideCreditDriverOnComplete(supabase:any, booking:any): Promise<{ warning?: string }> {
  try {
    const bookingId = booking?.id ? String(booking.id) : "";
    const driverId = booking?.driver_id ? String(booking.driver_id) : "";
    if (!bookingId || !driverId) return {};

    // Only if this booking is the promo trip
    const ar = await supabase
      .from("passenger_free_ride_audit")
      .select("*")
      .eq("trip_id", bookingId)
      .maybeSingle();

    if (ar?.error || !ar?.data) return {};
    if (String(ar.data.status || "") !== "used") return {};

    // Prevent double-credit: check reason unique by booking
    const reason = "free_ride_credit:" + bookingId;
    const ex = await supabase
      .from("driver_wallet_transactions")
      .select("id")
      .eq("reason", reason)
      .limit(1);

    if (!ex?.error && Array.isArray(ex.data) && ex.data.length) {
      return {};
    }

    // Compute next balance_after from last known entry
    let prevBal = 0;
    try {
      const last = await supabase
        .from("driver_wallet_transactions")
        .select("balance_after")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!last?.error && Array.isArray(last.data) && last.data.length) {
        const v = Number(last.data[0]?.balance_after);
        if (Number.isFinite(v)) prevBal = v;
      }
    } catch {}

    const credit = Number(ar.data.driver_credit_php ?? 20);
    const nextBal = prevBal + (Number.isFinite(credit) ? credit : 20);

    // Insert credit row
    const ins = await supabase.from("driver_wallet_transactions").insert({
      driver_id: driverId,
      amount: credit,
      balance_after: nextBal,
      reason: reason,
      booking_id: bookingId,
      created_at: new Date().toISOString(),
    });

    if (ins?.error) {
      return { warning: "FREE_RIDE_CREDIT_INSERT_ERROR: " + String(ins.error.message || "insert failed") };
    }

    // Backfill audit with driver_id if missing (best-effort)
    try {
      if (!ar.data.driver_id) {
        await supabase
          .from("passenger_free_ride_audit")
          .update({ driver_id: driverId, used_at: ar.data.used_at || new Date().toISOString() })
          .eq("passenger_id", String(ar.data.passenger_id));
      }
    } catch {}

    return {};
  } catch (e:any) {
    return { warning: "FREE_RIDE_CREDIT_EXCEPTION: " + String(e?.message || e) };
  }
}
/* FREE_RIDE_DRIVER_CREDIT_END */
export async function GET(req: Request) {
  const supabase = createClient();
  
  // Auth/secret gate (OFF by default in production)
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_STATUS || "").trim() === "1";
  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret = String(req.headers.get("x-jride-admin-secret") || req.headers.get("x-admin-secret") || "").trim();

  let actorUserId: string | null = null;

  if (!allowUnauth && !(wantSecret && gotSecret && gotSecret === wantSecret)) {
    try {
      const { data } = await supabase.auth.getUser();
      actorUserId = data?.user?.id ?? null;
    } catch {
      actorUserId = null;
    }
    if (!actorUserId) {
      return jsonErr("UNAUTHORIZED", "Not authenticated", 401);
    }
  }
try {
    const url = new URL(req.url);
    const bookingId = url.searchParams.get("booking_id") || url.searchParams.get("id");
    const bookingCode = url.searchParams.get("booking_code") || url.searchParams.get("code");

    const bk = await fetchBooking(supabase, bookingId ?? null, bookingCode ?? null);
    if (!bk.data) {
      return jsonErr(
        "BOOKING_NOT_FOUND",
        bk.error || "Booking not found",
        404,
        { booking_id: bookingId ?? null, booking_code: bookingCode ?? null }
      );
    }

    const booking: any = bk.data;
    const cur = norm(booking.status) || "requested";
    const allowedNext = NEXT[cur] ?? [];
    const hasDriver = !!booking.driver_id;

    return jsonOk({
      ok: true,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      has_driver: hasDriver,
      allowed_next: allowedNext,
      booking,
    });
  } catch (e: any) {
    return jsonErr("SERVER_ERROR", e?.message || "Unknown error", 500);
  }
}

export async function POST(req: Request) {

    // ===== JRIDE_WARNINGS_STABILIZE (AUTO) =====
  let warnings: string[] = [];
  (globalThis as any).__jrideWarnings = warnings;
// ===== JRIDE_P5C_POST_START_BLOCK (fare history prep; best-effort) =====
  // Runs early inside POST() async scope. Does NOT depend on later local variables.
  // It attempts to derive booking id/code from body/payload/data and fetch booking for signature + suggestion.

  let fare_signature: string | null = null;
  let p5c_warning: string | null = null;

  // Helper: stable rounding
  const __p5c_round6 = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 1e6) / 1e6;
  };

  const __p5c_sigFrom = (b: any): string | null => {
    const pLat = __p5c_round6(b?.pickup_lat);
    const pLng = __p5c_round6(b?.pickup_lng);
    const dLat = __p5c_round6(b?.dropoff_lat);
    const dLng = __p5c_round6(b?.dropoff_lng);
    if (pLat === null || pLng === null || dLat === null || dLng === null) return null;
    return `${pLat},${pLng}|${dLat},${dLng}`;
  };

  const __p5c_num = (v: any): number | null => {
    if (v === null || typeof v === "undefined") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // We will attempt after body parse exists; this block expects later code defines `body` OR uses req.json()
  // So we do nothing here yet; we run after body is available by wrapping in a microtask below.
  Promise.resolve().then(async () => {
    try {
      // Try to use any of these names if they exist in this scope
      const src: any =
        (typeof (globalThis as any).body !== "undefined" ? (globalThis as any).body : null) ??
        (typeof (globalThis as any).payload !== "undefined" ? (globalThis as any).payload : null) ??
        (typeof (globalThis as any).data !== "undefined" ? (globalThis as any).data : null) ??
        null;

      // Fallback: try to read request JSON again only if needed (safe best-effort)
      let bdy: any = null;
      try { bdy = await (req as any).json(); } catch { bdy = null; }

      const s = src ?? bdy ?? {};
      const id = String(s.booking_id ?? s.bookingId ?? s.id ?? "").trim();
      const code = String(s.booking_code ?? s.bookingCode ?? s.code ?? "").trim();

      if (!id && !code) return;
      if (typeof supabase === "undefined" || !supabase) return;

      // Fetch booking
      let q: any = supabase
        .from("bookings")
        .select("pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,town, verified_fare");

      if (id) q = q.eq("id", id);
      else q = q.eq("booking_code", code);

      const r: any = await q.order("updated_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (r?.error) {
        p5c_warning = "P5C_BOOKING_FETCH_ERROR: " + String(r.error.message || "fetch failed");
        return;
      }

      const booking = r?.data || null;
      fare_signature = __p5c_sigFrom(booking);

      const vf = __p5c_num(booking?.verified_fare);
      if (!fare_signature || vf === null) return;

      const town = String((booking?.town ?? "") || "").trim() || null;
      const vehicle = String((booking?.vehicle_type ?? "") || "").trim() || null;

      try {
        const ru: any = await supabase.rpc("fare_suggestion_upsert_v1", {
          route_signature: fare_signature,
          town_name: town,
          vehicle_type_in: vehicle,
          verified_fare_in: vf,
        });
        if (ru?.error) {
          p5c_warning = "P5C_RPC_ERROR: " + String(ru.error.message || "rpc failed");
        }
      } catch (e: any) {
        p5c_warning = "P5C_RPC_EXCEPTION: " + String(e?.message || e);
      }
    } catch (e: any) {
      p5c_warning = "P5C_BLOCK_EXCEPTION: " + String(e?.message || e);
    }
  });
  // ===== END JRIDE_P5C_POST_START_BLOCK =====

  const supabase = createClient();
  
  // Auth/secret gate (OFF by default in production)
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_STATUS || "").trim() === "1";
  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret = String(req.headers.get("x-jride-admin-secret") || req.headers.get("x-admin-secret") || "").trim();

  let actorUserId: string | null = null;

  if (!allowUnauth && !(wantSecret && gotSecret && gotSecret === wantSecret)) {
    try {
      const { data } = await supabase.auth.getUser();
      actorUserId = data?.user?.id ?? null;
    } catch {
      actorUserId = null;
    }
    if (!actorUserId) {
      return jsonErr("UNAUTHORIZED", "Not authenticated", 401);
    }
  }
const rawBody = (await req.json().catch(() => ({}))) as any;

  const booking_id =
    rawBody?.booking_id ??
    rawBody?.bookingId ??
    rawBody?.id ??
    rawBody?.booking?.id ??
    null;

  const booking_code =
    rawBody?.booking_code ??
    rawBody?.bookingCode ??
    rawBody?.code ??
    rawBody?.booking?.booking_code ??
    rawBody?.booking?.bookingCode ??
    null;

  const status = rawBody?.status ?? null;
  const note = rawBody?.note ?? null;
  const force = Boolean(rawBody?.force);

  if ((!booking_id || String(booking_id).trim() === "") && (!booking_code || String(booking_code).trim() === "")) {
    return jsonErr("BAD_REQUEST", "Missing booking identifier", 400);
  }
  if (!status) {
    return jsonErr("BAD_REQUEST", "Missing target status", 400);
  }

  const target = norm(status);
  if (!target || !(ALLOWED as any).includes(target)) {
    return jsonErr("INVALID_STATUS", "Invalid status. Allowed: " + ALLOWED.join(", "), 400);
  }

  const bk = await fetchBooking(
    supabase,
    booking_id ? String(booking_id).trim() : null,
    booking_code ? String(booking_code).trim() : null
  );

  if (!bk.data) {
    return jsonErr("BOOKING_NOT_FOUND", bk.error || "Booking not found", 404, {
      booking_id: booking_id ?? null,
      booking_code: booking_code ?? null,
    });
  }

  const booking: any = bk.data;
  const cur = norm(booking.status) || "requested";
  const allowedNext = NEXT[cur] ?? [];
  const hasDriver = !!booking.driver_id;

  // PHASE 3L: Trip lock
  if ((cur === "completed" || cur === "cancelled") && cur !== target) {
    return jsonErr("TRIP_LOCKED", "Trip already " + cur + " (no further updates allowed)", 409, {
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      target_status: target,
    });
  }

  // Require driver for lifecycle statuses (except requested/cancelled)
  if (!hasDriver && target !== "requested" && target !== "cancelled") {
    return jsonErr("NO_DRIVER", "Cannot set status without driver_id", 409, {
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      target_status: target,
      has_driver: hasDriver,
      allowed_next: allowedNext,
      current_status_raw: booking.status ?? null,
    });
  }

  // Idempotent retry
  if (cur === target) {
    return jsonOk({
      ok: true,
      changed: false,
      idempotent: true,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      status: booking.status ?? null,
      booking,
    });
  }

  // Strict transitions unless forced
  if (!force && !allowedNext.includes(target)) {
    return jsonErr("INVALID_TRANSITION", "Cannot transition " + cur + " -> " + target, 409, {
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      target_status: target,
      has_driver: hasDriver,
      allowed_next: allowedNext,
    });
  }
  /* JRIDE_COMPLETE_PROXIMITY_CHECK_BEGIN */
  // Completion must be destination-based, NOT polyline-based.
  // Allow complete if within radius of dropoff OR if forced.
  if (target === "completed" && !force) {
    const dLat = Number(booking?.dropoff_lat);
    const dLng = Number(booking?.dropoff_lng);

    // Prefer coords from request body if present, else driver_locations fallback.
    const bodyLat = Number(rawBody?.lat ?? rawBody?.driver_lat ?? rawBody?.driverLat);
    const bodyLng = Number(rawBody?.lng ?? rawBody?.driver_lng ?? rawBody?.driverLng);

    let curLat: number | null = null;
    let curLng: number | null = null;

    if (Number.isFinite(bodyLat) && Number.isFinite(bodyLng)) {
      curLat = bodyLat; curLng = bodyLng;
    } else {
      const dl = await jrideGetDriverCoords(supabase as any, String(booking?.driver_id ?? ""));
      if (dl) { curLat = dl.lat; curLng = dl.lng; }
    }

    if (Number.isFinite(dLat) && Number.isFinite(dLng) && Number.isFinite(curLat as any) && Number.isFinite(curLng as any)) {
      const meters = jrideHaversineMeters(curLat as any, curLng as any, dLat, dLng);
      const radius = Number.isFinite(JRIDE_COMPLETE_RADIUS_M) ? JRIDE_COMPLETE_RADIUS_M : 250;
      if (meters > radius) {
        return jsonErr("TOO_FAR_FROM_DROPOFF", "Driver too far from dropoff to complete (" + Math.round(meters) + "m, radius " + radius + "m). Use force=true to override.", 409, {
          booking_id: String(booking.id),
          booking_code: booking.booking_code ?? null,
          meters: meters,
          radius_m: radius,
          driver_lat: curLat,
          driver_lng: curLng,
          dropoff_lat: dLat,
          dropoff_lng: dLng
        });
      }
    }
  }
  /* JRIDE_COMPLETE_PROXIMITY_CHECK_END */

// Best-effort timestamps + note (falls back to status-only if columns missing)
  const nowIso = new Date().toISOString();
  const patch: Record<string, any> = { status: target };

  if (target === "assigned") patch.assigned_at = nowIso;
  if (target === "on_the_way" || target === "enroute") patch.enroute_at = nowIso;
  if (target === "arrived") patch.arrived_at = nowIso;
  if (target === "on_trip") patch.on_trip_at = nowIso;
  if (target === "completed") patch.completed_at = nowIso;
  if (target === "cancelled") patch.cancelled_at = nowIso;

  if (note && String(note).trim() !== "") {
    patch.status_note = String(note).trim();
  }

  let upd = await tryUpdateBooking(supabase, String(booking.id), patch);

  if (!upd.ok && upd.error && upd.error.toLowerCase().includes("column")) {
    upd = await tryUpdateBooking(supabase, String(booking.id), { status: target });
  
    // JRIDE_DISPATCH_ACTIONS_LOG_V6C (non-blocking)
  try {
    const driverForLog =
      (booking?.driver_id ? String(booking.driver_id) :
        (booking?.assigned_driver_id ? String(booking.assigned_driver_id) : null));

    const dispatcherIdForLog =
      ((typeof actorUserId !== "undefined" && actorUserId) ? String(actorUserId) : null);

    await bestEffortDispatchAction(supabase, {
      trip_id: String(booking.id),
      driver_id: driverForLog,
      from_status: cur,
      to_status: target,
      dispatcher_id: dispatcherIdForLog,
      dispatcher_name: null,
      source: "dispatch/status",
    });
  } catch {}}

  if (!upd.ok) {
    return jsonErr("DISPATCH_STATUS_DB_ERROR", upd.error || "Booking update failed", 500, {
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      current_status: cur,
      target_status: target,
    });
  }

  const updatedBooking = upd.data ?? booking;

  // Driver location sync (non-blocking)
  const driverId =
    updatedBooking?.driver_id ? String(updatedBooking.driver_id) :
    (booking?.driver_id ? String(booking.driver_id) : "");

  const drv = await bestEffortUpdateDriverLocation(supabase, driverId, target);

  // Audit (non-blocking)
  const actor = (actorUserId || '').trim() ? String(actorUserId) : getActorFromReq(req);
  const audit = await bestEffortAudit(supabase, {
    booking_id: String(booking.id),
    booking_code: booking.booking_code ?? null,
    from_status: cur,
    to_status: target,
    actor,
    source: "dispatch/status",
  });

  // Wallet sync (completion only)
  let walletWarn: string | null = null;
  if (target === "completed") {
    const w = await bestEffortWalletSyncOnComplete(supabase, updatedBooking);
    walletWarn = w.warning ?? null;

    // FREE_RIDE_CREDIT_CALL (promo ride only)
    const fr = await freeRideCreditDriverOnComplete(supabase as any, updatedBooking);
    if (fr.warning) walletWarn = walletWarn ? (String(walletWarn) + "; " + String(fr.warning)) : String(fr.warning);
  }

  const warn =
    drv.warning
      ? (audit.warning ? (String(drv.warning) + "; " + String(audit.warning)) : String(drv.warning))
      : (audit.warning ? String(audit.warning) : null);

  const mergedWarn =
    warn
      ? (walletWarn ? (String(warn) + "; " + String(walletWarn)) : String(warn))
      : (walletWarn ? String(walletWarn) : null);

  return jsonOk({
    ok: true,
    changed: true,
    booking_id: String(booking.id),
    booking_code: booking.booking_code ?? null,
    status: target,
    allowed_next: NEXT[target] ?? [],
    booking: updatedBooking ?? null,
    warning: mergedWarn,
  });
}


















