import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

function isTakeoutEnabled() {
  return String(process.env.TAKEOUT_ENABLED || "0").trim() === "1";
}

function takeoutDisabledResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "TAKEOUT_DISABLED",
      message: "Takeout is not enabled yet. Ride booking remains the active service."
    },
    { status: 503 }
  );
}
// JRIDE_TAKEOUT_NOTE_CONTRACT_V1
// Keep passenger note separate from operational/system instructions.
function cleanTakeoutCustomerNote(v: any): string {
  let t = String(v ?? "").trim();
  if (!t || t.toLowerCase() === "null") return "";
  const markers = [
    "Cash collection required:",
    "Cash collection required",
    "Vendor receipt requested.",
    "Vendor receipt requested",
    "Receipt requested:",
    "Packaging:",
    "Standard item packaging",
  ];
  for (const marker of markers) {
    const idx = t.toLowerCase().indexOf(marker.toLowerCase());
    if (idx >= 0) t = t.slice(0, idx).trim();
  }
  return t.replace(/\s+/g, " ").trim();
}

function takeoutSystemInstructions(row: any): string[] {
  const out: string[] = [];
  const prefs = row?.order_preferences && typeof row.order_preferences === "object" ? row.order_preferences : {};
  const cashRequired = Boolean(row?.takeout_cash_collection_required ?? row?.cash_collection_required ?? false);
  const receiptRequested = Boolean(row?.receipt_requested ?? row?.request_vendor_receipt ?? prefs?.receipt_requested ?? false);
  const packaging = String(row?.premium_packaging_label ?? prefs?.premium_packaging_label ?? "").trim();
  if (packaging) out.push(`Packaging: ${packaging}`);
  if (cashRequired) out.push("Collect cash before vendor purchase.");
  if (receiptRequested) out.push("Vendor receipt requested.");
  return out;
}

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

  const latKeys = ["vendor_lat","store_lat","merchant_lat","pickup_lat","from_lat","start_lat","location_lat","lat","latitude"];
  const lngKeys = ["vendor_lng","store_lng","merchant_lng","pickup_lng","from_lng","start_lng","location_lng","lng","lon","longitude"];

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


type TakeoutPassengerIdentity = {
  userId: string | null;
  email: string | null;
  name: string;
  phone: string;
  verified: boolean;
};

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function phoneFromAuthEmail(email: string | null): string | null {
  const e = cleanString(email);
  if (!e) return null;
  const m = /^p_(\d+)@phone\.jride\.local$/i.exec(e);
  if (!m) return null;
  const raw = m[1];
  if (raw.startsWith("63")) return "+" + raw;
  return raw;
}

function getBearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  return token || null;
}

function isTruthyVerification(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v !== "string") return false;
  const t = v.trim().toLowerCase();
  if (!t || t === "false" || t === "0" || t === "no" || t === "none") return false;
  return true;
}

function isApprovedStatus(v: unknown): boolean {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "approved_admin" || t === "approved" || t === "verified";
}

async function getTakeoutRequestUser(req: NextRequest, admin: any): Promise<any | null> {
  const token = getBearerToken(req);
  if (token) {
    const bearer = await admin.auth.getUser(token).catch(() => null as any);
    if (bearer?.data?.user) return bearer.data.user;
  }

  try {
    const cookieClient = createRouteHandlerClient({ cookies });
    const cookieUser = await cookieClient.auth.getUser();
    if (cookieUser?.data?.user) return cookieUser.data.user;
  } catch {}

  const nextSession = await auth().catch(() => null as any);
  const nextUser = (nextSession as any)?.user || null;
  if (nextUser) return nextUser;

  return null;
}

async function findPassengerProfile(admin: any, userId: string | null, email: string | null, phone: string | null): Promise<any | null> {
  const attempts: Array<{ col: string; val: string | null }> = [
    { col: "user_id", val: userId },
    { col: "email", val: email },
    { col: "phone", val: phone },
  ];

  for (const a of attempts) {
    if (!a.val) continue;
    const r = await admin
      .from("passenger_profiles")
      .select("user_id,full_name,phone,email")
      .eq(a.col, a.val)
      .limit(1)
      .maybeSingle();
    if (!r.error && r.data) return r.data;
  }

  return null;
}

async function isVerifiedTakeoutPassenger(admin: any, userId: string | null, email: string | null): Promise<boolean> {
  if (userId) {
    const pv = await admin
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (!pv.error && pv.data && isApprovedStatus((pv.data as any).status)) return true;

    const pr = await admin
      .from("passenger_verification_requests")
      .select("status")
      .eq("passenger_id", userId)
      .limit(1)
      .maybeSingle();
    if (!pr.error && pr.data && isApprovedStatus((pr.data as any).status)) return true;
  }

  const checks: Array<{ col: string; val: string | null }> = [
    { col: "auth_user_id", val: userId },
    { col: "user_id", val: userId },
    { col: "email", val: email },
  ];

  for (const c of checks) {
    if (!c.val) continue;
    const p = await admin
      .from("passengers")
      .select("is_verified,verified,verification_tier,night_allowed")
      .eq(c.col, c.val)
      .limit(1)
      .maybeSingle();
    if (!p.error && p.data) {
      const row: any = p.data;
      if (
        isTruthyVerification(row.is_verified) ||
        isTruthyVerification(row.verified) ||
        isTruthyVerification(row.verification_tier) ||
        isTruthyVerification(row.night_allowed)
      ) {
        return true;
      }
    }
  }

  return false;
}

async function requireVerifiedTakeoutPassenger(req: NextRequest, admin: any): Promise<{ ok: true; passenger: TakeoutPassengerIdentity } | { ok: false; response: NextResponse }> {
  const user = await getTakeoutRequestUser(req, admin);
  const meta = ((user as any)?.user_metadata || {}) as any;
  const userId = cleanString((user as any)?.id) || null;
  const email = cleanString((user as any)?.email) || null;
  const authPhone = cleanString((user as any)?.phone) || cleanString(meta.phone) || cleanString(meta.mobile) || phoneFromAuthEmail(email);

  if (!userId && !email && !authPhone) {
    return {
      ok: false,
      response: json(401, {
        ok: false,
        error: "PASSENGER_AUTH_REQUIRED",
        message: "Please sign in with a verified passenger account before placing a takeout order.",
      }),
    };
  }

  const profile = await findPassengerProfile(admin, userId, email, authPhone);
  const resolvedUserId = cleanString(profile?.user_id) || userId;
  const resolvedEmail = cleanString(profile?.email) || email;
  const resolvedName = cleanString(profile?.full_name) || cleanString(meta.full_name) || cleanString(meta.name) || null;
  const resolvedPhone = cleanString(profile?.phone) || authPhone || null;

  const verified = await isVerifiedTakeoutPassenger(admin, resolvedUserId, resolvedEmail);
  if (!verified) {
    return {
      ok: false,
      response: json(403, {
        ok: false,
        error: "PASSENGER_VERIFICATION_REQUIRED",
        message: "Only verified JRide passengers can place takeout orders.",
      }),
    };
  }

  if (!resolvedName || !resolvedPhone) {
    return {
      ok: false,
      response: json(409, {
        ok: false,
        error: "PASSENGER_PROFILE_INCOMPLETE",
        message: "Your verified passenger profile must have both name and phone number before booking takeout.",
      }),
    };
  }

  return {
    ok: true,
    passenger: {
      userId: resolvedUserId,
      email: resolvedEmail,
      name: resolvedName,
      phone: resolvedPhone,
      verified: true,
    },
  };
}

type SnapshotItem = {
  booking_id?: string;
  menu_item_id: string | null;
  name: string;
  price: number;
  quantity: number;
  packaging_note?: string | null;
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

    const packaging_note = String(it?.packaging_note ?? it?.packagingNote ?? it?.packaging ?? "").trim() || null;
    out.push({ menu_item_id, name, price, quantity: qty, packaging_note });
  }

  return out;
}

function computeSubtotal(items: SnapshotItem[]): number {
  let s = 0;
  for (const it of items) s += toNum(it.price) * Math.max(1, it.quantity || 1);
  return s;
}

const VENDOR_ACCEPT_WINDOW_MS = 15 * 60 * 1000;
const VENDOR_ACCEPT_TIMEOUT_REASON = "Vendor did not respond within 15 minutes";

function vendorAcceptDeadlineMs(row: any): number | null {
  const raw = String(row?.created_at || "").trim();
  if (!raw) return null;
  const createdMs = new Date(raw).getTime();
  if (!Number.isFinite(createdMs)) return null;
  return createdMs + VENDOR_ACCEPT_WINDOW_MS;
}

function vendorAcceptExpired(row: any, nowMs = Date.now()): boolean {
  const vendorStatus = String(row?.vendor_status || row?.vendorStatus || row?.status || "vendor_pending").trim().toLowerCase();
  const normalized = vendorStatus === "requested" || vendorStatus === "" ? "vendor_pending" : vendorStatus;
  if (normalized !== "vendor_pending") return false;
  const deadlineMs = vendorAcceptDeadlineMs(row);
  return deadlineMs !== null && nowMs >= deadlineMs;
}

function vendorAcceptExpiresAt(row: any): string | null {
  const deadlineMs = vendorAcceptDeadlineMs(row);
  return deadlineMs === null ? null : new Date(deadlineMs).toISOString();
}
// JRIDE_TAKEOUT_VENDOR_ACCEPT_AUTO_ASSIGN_V1
// Takeout-only auto assignment after vendor confirms an order.
// Rule: PHP 500 and below => nearest fresh driver to vendor pickup.
// Rule: Above PHP 500 => nearest fresh driver to customer dropoff for cash-first collection.
// Manual admin assignment remains available and can reassign later.
function takeoutAutoAssignNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function takeoutAutoAssignDistanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const c =
    2 *
    Math.atan2(
      Math.sqrt(s1 * s1 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * s2 * s2),
      Math.sqrt(1 - (s1 * s1 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * s2 * s2)),
    );
  return R * c;
}

function takeoutAutoAssignDriverIsFreshAndOnline(row: any): boolean {
  const status = String(row?.status || "").trim().toLowerCase();
  const onlineLike = new Set(["online", "available", "idle", "waiting"]);
  if (!onlineLike.has(status)) return false;

  const raw = String(row?.updated_at || row?.created_at || "").trim();
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return false;
  const ageMinutes = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return ageMinutes <= 10;
}

async function takeoutAutoAssignOnVendorAccept(admin: any, order: any) {
  const alreadyAssigned = String(order?.assigned_driver_id || order?.driver_id || "").trim();
  if (alreadyAssigned) {
    return { attempted: false, assigned: false, reason: "already_assigned", driver_id: alreadyAssigned };
  }

  const subtotal = toNum(order?.takeout_items_subtotal ?? order?.total_bill ?? order?.items_subtotal ?? 0);
  const cashFirst = subtotal > 500;

  const vendorLat = takeoutAutoAssignNum(order?.pickup_lat);
  const vendorLng = takeoutAutoAssignNum(order?.pickup_lng);
  const customerLat = takeoutAutoAssignNum(order?.dropoff_lat);
  const customerLng = takeoutAutoAssignNum(order?.dropoff_lng);

  const anchorLat = cashFirst ? customerLat : vendorLat;
  const anchorLng = cashFirst ? customerLng : vendorLng;
  const anchor = cashFirst ? "customer" : "vendor";

  if (anchorLat == null || anchorLng == null || anchorLat === 0 || anchorLng === 0) {
    return { attempted: true, assigned: false, reason: "missing_anchor_coords", anchor, subtotal, cash_first: cashFirst };
  }

  const activeStatuses = new Set(["requested", "vendor_accepted", "preparing", "pickup_ready", "driver_assigned", "rider_arrived_vendor", "arrived_vendor", "picked_up", "delivering"]);
  const terminalStatuses = new Set(["completed", "cancelled", "canceled", "vendor_timeout"]);

  const assignedRes = await admin
    .from("bookings")
    .select("assigned_driver_id,driver_id,vendor_status,customer_status,status")
    .eq("service_type", "takeout");

  const reserved = new Set<string>();
  if (!assignedRes.error && Array.isArray(assignedRes.data)) {
    for (const r of assignedRes.data as any[]) {
      const did = String(r?.assigned_driver_id || r?.driver_id || "").trim();
      if (!did) continue;
      const vendorStatus = String(r?.vendor_status || "").trim().toLowerCase();
      const customerStatus = String(r?.customer_status || "").trim().toLowerCase();
      const status = String(r?.status || "").trim().toLowerCase();
      if (terminalStatuses.has(vendorStatus) || terminalStatuses.has(customerStatus) || terminalStatuses.has(status)) continue;
      if (activeStatuses.has(vendorStatus) || activeStatuses.has(customerStatus) || activeStatuses.has(status)) reserved.add(did);
    }
  }

  const driversRes = await admin
    .from("driver_locations")
    .select("driver_id,lat,lng,status,updated_at,created_at,town,home_town,vehicle_type")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (driversRes.error || !Array.isArray(driversRes.data)) {
    return { attempted: true, assigned: false, reason: "driver_locations_read_failed", anchor, subtotal, cash_first: cashFirst };
  }

  const latestByDriver: Record<string, any> = {};
  for (const row of driversRes.data as any[]) {
    const did = String(row?.driver_id || "").trim();
    if (!did || latestByDriver[did]) continue;
    latestByDriver[did] = row;
  }

  let best: any = null;
  for (const row of Object.values(latestByDriver) as any[]) {
    const did = String(row?.driver_id || "").trim();
    if (!did || reserved.has(did)) continue;
    if (!takeoutAutoAssignDriverIsFreshAndOnline(row)) continue;

    const lat = takeoutAutoAssignNum(row?.lat);
    const lng = takeoutAutoAssignNum(row?.lng);
    if (lat == null || lng == null || lat === 0 || lng === 0) continue;

    const meters = takeoutAutoAssignDistanceMeters(anchorLat, anchorLng, lat, lng);
    if (!Number.isFinite(meters)) continue;

    if (!best || meters < best.distance_meters) {
      best = {
        driver_id: did,
        distance_meters: meters,
        driver_lat: lat,
        driver_lng: lng,
        driver_status: row?.status || null,
        driver_town: row?.town || row?.home_town || null,
        vehicle_type: row?.vehicle_type || null,
      };
    }
  }

  if (!best) {
    return { attempted: true, assigned: false, reason: "no_fresh_online_driver", anchor, subtotal, cash_first: cashFirst };
  }

  return {
    attempted: true,
    assigned: true,
    reason: "nearest_fresh_online_driver",
    anchor,
    subtotal,
    cash_first: cashFirst,
    ...best,
  };
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
      .eq("service_type", "takeout")
    .order("created_at", { ascending: false });

  if (b.error) return json(500, { ok: false, error: "DB_ERROR", message: b.error.message });

  let rows = (Array.isArray(b.data) ? b.data : []) as any[];
  const expiredPendingIds = rows
    .filter((r) => vendorAcceptExpired(r))
    .map((r) => String(r?.id || ""))
    .filter(Boolean);

  if (expiredPendingIds.length) {
    const expiredPatch: any = {
      vendor_status: "vendor_timeout",
      customer_status: "vendor_timeout",
      status: "cancelled",
      cancel_reason: VENDOR_ACCEPT_TIMEOUT_REASON,
      vendor_cancel_reason: VENDOR_ACCEPT_TIMEOUT_REASON,
    };

    const expiredUpdate = await admin
      .from("bookings")
      .update(expiredPatch)
      .in("id", expiredPendingIds)
      .eq("vendor_id", vendor_id)
      .eq("service_type", "takeout");

    if (!expiredUpdate.error) {
      const expiredSet = new Set(expiredPendingIds);
      rows = rows.map((r) =>
        expiredSet.has(String(r?.id || ""))
          ? { ...r, ...expiredPatch, updated_at: new Date().toISOString() }
          : r
      );
    }
  }

  const ids = rows.map((r) => r?.id).filter(Boolean);
  const driverIds = Array.from(new Set(rows
    .map((r) => String(r?.driver_id || r?.assigned_driver_id || "").trim())
    .filter(Boolean)));

  const vehicleTypeByDriver: Record<string, string> = {};
  if (driverIds.length) {
    const dl = await admin
      .from("driver_locations")
      .select("driver_id,vehicle_type")
      .in("driver_id", driverIds);

    if (!dl.error && Array.isArray(dl.data)) {
      for (const r of dl.data as any[]) {
        const did = String(r?.driver_id || "").trim();
        const vehicle = String(r?.vehicle_type || "").trim();
        if (did && vehicle) vehicleTypeByDriver[did] = vehicle;
      }
    }
  }

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
          packaging_note: r?.packaging_note ? String(r.packaging_note) : null,
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
    const snapItems = itemsByBooking[bid] || [];
    const pricingSnapshot = (r?.takeout_pricing_snapshot && typeof r.takeout_pricing_snapshot === "object") ? r.takeout_pricing_snapshot : {};
    const preferences = (r?.order_preferences && typeof r.order_preferences === "object") ? r.order_preferences : pricingSnapshot;

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
      vendor_accept_expires_at: vendorAcceptExpiresAt(r),
      vendor_accept_expired: vendorAcceptExpired(r),
      cancel_reason: r?.cancel_reason ?? null,
      vendor_cancel_reason: r?.vendor_cancel_reason ?? null,

      driver_id: r?.driver_id ?? r?.assigned_driver_id ?? null,
      driver_name: r?.driver_name ?? r?.assigned_driver_name ?? r?.rider_name ?? null,
      driver_vehicle_type: vehicleTypeByDriver[String(r?.driver_id || r?.assigned_driver_id || "").trim()] || r?.driver_vehicle_type || r?.vehicle_type || r?.assigned_vehicle_type || null,

      customer_name: r?.customer_name ?? r?.passenger_name ?? r?.rider_name ?? null,
      customer_phone: r?.customer_phone ?? r?.passenger_phone ?? r?.phone ?? r?.contact_phone ?? r?.rider_phone ?? pricingSnapshot?.customer_phone ?? pricingSnapshot?.passenger_phone ?? pricingSnapshot?.phone ?? null,
      passenger_phone: r?.passenger_phone ?? r?.customer_phone ?? r?.phone ?? r?.contact_phone ?? r?.rider_phone ?? pricingSnapshot?.passenger_phone ?? pricingSnapshot?.customer_phone ?? pricingSnapshot?.phone ?? null,
      phone: r?.phone ?? r?.passenger_phone ?? r?.customer_phone ?? r?.contact_phone ?? r?.rider_phone ?? pricingSnapshot?.phone ?? pricingSnapshot?.passenger_phone ?? pricingSnapshot?.customer_phone ?? null,
      to_label: r?.to_label ?? r?.dropoff_label ?? null,

      items: snapItems,
      item_count: snapItems.length,
      items_text: r?.items_text ?? null,
      note: cleanTakeoutCustomerNote(r?.notes ?? r?.note ?? null) || null,
      customer_note: cleanTakeoutCustomerNote(r?.customer_note ?? r?.notes ?? r?.note ?? null) || null,
      passenger_note: cleanTakeoutCustomerNote(r?.customer_note ?? r?.notes ?? r?.note ?? null) || null,
      system_instructions: takeoutSystemInstructions({ ...r, order_preferences: preferences }),
      order_preferences: preferences,
      items_subtotal: (storedSubtotal != null ? Number(storedSubtotal) : (computed != null ? Number(computed) : null)),
      takeout_items_subtotal: (storedSubtotal != null ? Number(storedSubtotal) : (computed != null ? Number(computed) : null)),
      total_bill,
      premium_packaging_selected: Boolean(r?.premium_packaging_selected ?? preferences?.premium_packaging_selected ?? false),
      premium_packaging_fee: r?.premium_packaging_fee ?? preferences?.premium_packaging_fee ?? null,
      premium_packaging_label: r?.premium_packaging_label ?? preferences?.premium_packaging_label ?? null,
      receipt_requested: Boolean(r?.receipt_requested ?? r?.request_vendor_receipt ?? preferences?.receipt_requested ?? false),
      request_vendor_receipt: Boolean(r?.request_vendor_receipt ?? r?.receipt_requested ?? preferences?.receipt_requested ?? false),
    };
  });

  return json(200, { ok: true, vendor_id, orders });
}

export async function POST(req: NextRequest) {
  if (!isTakeoutEnabled()) return takeoutDisabledResponse();
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

  const vendor_status = order_id
    ? String(body?.vendor_status ?? body?.vendorStatus ?? "").trim()
    : "vendor_pending";
  const cancelReason = String(body?.cancel_reason ?? body?.cancellation_reason ?? body?.vendor_cancel_reason ?? "").trim();
  const cancelNote = String(body?.cancel_note ?? body?.cancellation_note ?? body?.vendor_cancel_note ?? "").trim();

  // If order_id exists, treat as "update vendor_status" (NO SNAPSHOT HERE)
// Phase 3A bridge: when vendor marks ready (driver_arrived), do not move booking.status to ride lifecycle values
// so it becomes dispatch-visible. Idempotent: only if status is still requested/empty.
  if (order_id) {
    const cur = await admin
      .from("bookings")
      .select("id,status,vendor_status,customer_status,created_at,cancel_reason,vendor_cancel_reason,assigned_driver_id,driver_id,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,takeout_items_subtotal,town")
      .eq("id", order_id)
      .eq("vendor_id", vendor_id)
      .eq("service_type", "takeout")
      .single();

    if (cur.error) return json(500, { ok: false, error: "DB_ERROR", message: cur.error.message });

    const curStatus = String((cur.data as any)?.status || "").trim();
    const curVendor = String((cur.data as any)?.vendor_status || "").trim().toLowerCase();
    const nextVendor = String(vendor_status || "").trim().toLowerCase();

    const allowedForward: Record<string, string[]> = {
      "": ["vendor_accepted", "cancelled"],
      "requested": ["vendor_accepted", "cancelled"],
      "vendor_pending": ["vendor_accepted", "cancelled"],
      "vendor_accepted": ["preparing", "cancelled"],
      "driver_assigned": ["pickup_ready", "cancelled"],
      "preparing": ["pickup_ready", "cancelled"],
      "pickup_ready": ["completed", "cancelled"],
      "completed": [],
      "cancelled": [],
      "canceled": [],
      "vendor_timeout": []
    };

    const normalizedCurrent = curVendor === "canceled" ? "cancelled" : (curVendor || "vendor_pending");
    const normalizedNextRaw = nextVendor === "accepted" ? "vendor_accepted" : nextVendor;
    const normalizedNext = normalizedNextRaw === "canceled" ? "cancelled" : normalizedNextRaw;

    if (normalizedCurrent === "vendor_pending" && normalizedNext === "vendor_accepted" && vendorAcceptExpired(cur.data)) {
      const expiredPatch: any = {
        vendor_status: "cancelled",
        customer_status: "cancelled",
        status: "cancelled",
        cancel_reason: VENDOR_ACCEPT_TIMEOUT_REASON,
        vendor_cancel_reason: VENDOR_ACCEPT_TIMEOUT_REASON,
      };

      await admin
        .from("bookings")
        .update(expiredPatch)
        .eq("id", order_id)
        .eq("vendor_id", vendor_id)
        .eq("service_type", "takeout");

      return json(409, {
        ok: false,
        error: "VENDOR_ACCEPT_EXPIRED",
        message: "Vendor did not respond within 15 minutes. This order was automatically closed.",
        current: "vendor_timeout",
        attempted: normalizedNext,
        cancel_reason: VENDOR_ACCEPT_TIMEOUT_REASON,
      });
    }

    if (normalizedCurrent === "completed" || normalizedCurrent === "cancelled" || normalizedCurrent === "vendor_timeout") {
      return json(409, {
        ok: false,
        error: "TERMINAL_STATE_LOCKED",
        message: "Order already " + normalizedCurrent + ". No further updates allowed.",
        current: normalizedCurrent,
        attempted: normalizedNext
      });
    }

    const allowed = allowedForward[normalizedCurrent] || [];
    if (!allowed.includes(normalizedNext)) {
      return json(409, {
        ok: false,
        error: "INVALID_VENDOR_STATUS_TRANSITION",
        message: "Invalid transition: " + normalizedCurrent + " -> " + normalizedNext,
        current: normalizedCurrent,
        attempted: normalizedNext,
        allowed
      });
    }

    const patch: any = { vendor_status: normalizedNext };

    // JRIDE_TAKEOUT_VENDOR_ACCEPTANCE_FLOW_V1
    // Vendor state is separate from driver movement and passenger pricing.
    // Do not call ride lifecycle or wallet logic here.
    let autoAssignResult: any = null;

    if (normalizedNext === "vendor_accepted") {
      // LAUNCH-SAFE ACCEPT PATH:
      // Persist vendor acceptance first. Auto-assign is best-effort and must never block acceptance.
      patch.customer_status = "vendor_accepted";

      const acceptUp = await admin
        .from("bookings")
        .update(patch)
        .eq("id", order_id)
        .eq("vendor_id", vendor_id)
        .eq("service_type", "takeout");

      if (acceptUp.error) {
        return json(500, {
          ok: false,
          error: "ACCEPT_UPDATE_FAILED",
          message: acceptUp.error.message,
          details: acceptUp.error.details ?? null,
          hint: acceptUp.error.hint ?? null,
          code: acceptUp.error.code ?? null,
        });
      }

      const acceptedRow = {
        ...(cur.data as any),
        vendor_status: "vendor_accepted",
        customer_status: "vendor_accepted",
      };

      try {
        autoAssignResult = await takeoutAutoAssignOnVendorAccept(admin, acceptedRow);
      } catch (e: any) {
        autoAssignResult = { attempted: true, assigned: false, reason: "auto_assign_exception", message: String(e?.message || e) };
      }

      if (autoAssignResult?.assigned && autoAssignResult?.driver_id) {
        const assignPatch = {
          vendor_status: "driver_assigned",
          customer_status: "driver_assigned",
          assigned_driver_id: autoAssignResult.driver_id,
        };

        const assignUp = await admin
          .from("bookings")
          .update(assignPatch)
          .eq("id", order_id)
          .eq("vendor_id", vendor_id)
          .eq("service_type", "takeout");

        if (!assignUp.error) {
          return json(200, {
            ok: true,
            action: "updated",
            order_id,
            vendor_status: "driver_assigned",
            status: curStatus,
            bridgedToDispatch: false,
            auto_assign: autoAssignResult,
          });
        }

        autoAssignResult = {
          ...autoAssignResult,
          assigned: false,
          assignment_update_failed: true,
          assignment_update_error: assignUp.error.message,
          assignment_update_code: assignUp.error.code ?? null,
        };
      }

      return json(200, {
        ok: true,
        action: "updated",
        order_id,
        vendor_status: "vendor_accepted",
        status: curStatus,
        bridgedToDispatch: false,
        auto_assign: autoAssignResult,
      });
    } else if (normalizedNext === "preparing") {
      patch.customer_status = "preparing";
    } else if (normalizedNext === "pickup_ready") {
      patch.customer_status = "ready_for_pickup";
    } else if (normalizedNext === "completed") {
      patch.customer_status = "completed";
    } else if (normalizedNext === "cancelled") {
      if (!cancelReason) {
        return json(400, { ok: false, error: "CANCEL_REASON_REQUIRED", message: "Cancellation reason is required." });
      }

      // Vendor cancellation is takeout-only and must not call ride lifecycle, wallet, fare, or dispatch routes.
      // Keep this schema-safe: update only columns confirmed in the bookings table.
      patch.customer_status = "cancelled";
      patch.status = "cancelled";
      const cancelSummary = cancelNote ? `${cancelReason} - ${cancelNote}` : cancelReason;
      patch.vendor_cancel_reason = cancelSummary;
      patch.cancel_reason = cancelSummary;
    }

    const up = await admin
      .from("bookings")
      .update(patch)
      .eq("id", order_id)
      .eq("vendor_id", vendor_id)
      .eq("service_type", "takeout")
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
      auto_assign: autoAssignResult,
    });
  }

  // CREATE PATH (Phase 2D snapshot lock runs ONLY here)
  // JRIDE_TAKEOUT_VERIFIED_PASSENGER_CREATE_GUARD_V1
  // Takeout booking identity is server-derived. Do not trust passenger name/phone from request body.
  const passengerAuth = await requireVerifiedTakeoutPassenger(req, admin);
  if (!passengerAuth.ok) return passengerAuth.response;

  const customer_name = passengerAuth.passenger.name;
  const customer_phone = passengerAuth.passenger.phone;
  const to_label = String(body?.to_label ?? body?.toLabel ?? "").trim();
  const note = cleanTakeoutCustomerNote(body?.customer_note ?? body?.passenger_note ?? body?.note ?? "");
  const premium_packaging_selected = Boolean(body?.premium_packaging_selected ?? body?.premiumPackagingSelected ?? body?.order_preferences?.premium_packaging_selected ?? false);
  const premium_packaging_fee = toNum(body?.premium_packaging_fee ?? body?.premiumPackagingFee ?? body?.order_preferences?.premium_packaging_fee ?? 0);
  const premium_packaging_label = String(body?.premium_packaging_label ?? body?.premiumPackagingLabel ?? body?.order_preferences?.premium_packaging_label ?? "").trim() || null;
  const receipt_requested = Boolean(body?.receipt_requested ?? body?.request_vendor_receipt ?? body?.receiptRequested ?? body?.order_preferences?.receipt_requested ?? false);

  const items_text = String(body?.items_text ?? "").trim();

  const items = normalizeItems(body);
  if (!items.length) {
    return json(400, { ok: false, error: "items_required", message: "items[] required" });
  }

  // JRIDE_TAKEOUT_VENDOR_CLOSED_ENFORCEMENT_V43
  // Server-authoritative check. Passenger UI is not trusted for open/closed state.
  const vendorMetaForOrder =
    (await tryFetchRowById(admin, "vendor_accounts", "id", vendor_id)) ||
    (await tryFetchRowById(admin, "vendor_accounts", "email", vendor_id)) ||
    (await tryFetchRowById(admin, "vendor_accounts", "display_name", vendor_id)) ||
    (await tryFetchRowById(admin, "vendor_accounts", "location_label", vendor_id)) ||
    null;

  if (vendorMetaForOrder && (vendorMetaForOrder as any).accepting_orders === false) {
    return json(409, {
      ok: false,
      error: "TAKEOUT_VENDOR_CLOSED",
      message: "This vendor is currently closed and cannot accept new takeout orders.",
    });
  }

  const subtotal = computeSubtotal(items);

  // JRIDE_VENDOR_CLOSED_HARD_BLOCK_V46
  // Server-authoritative guard. UI state can be stale, but closed vendors must never create new takeout orders.
  const vendorOpenCheck = await admin
    .from("vendor_accounts")
    .select("id,accepting_orders")
    .eq("id", vendor_id)
    .limit(1);

  if (vendorOpenCheck.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: vendorOpenCheck.error.message });
  }

  const vendorOpenRow = Array.isArray(vendorOpenCheck.data) ? vendorOpenCheck.data[0] : null;
  if (vendorOpenRow && vendorOpenRow.accepting_orders === false) {
    return json(409, {
      ok: false,
      error: "VENDOR_CLOSED",
      message: "This vendor is currently closed and cannot accept new orders.",
    });
  }

  // JRIDE_TAKEOUT_STOCK_HARD_BLOCK_V1
  // Server-authoritative stock guard. UI remaining counts are not trusted.
  // This only validates takeout menu quantity before booking creation.
  const submittedMenuIds = Array.from(new Set(items
    .map((it) => String(it.menu_item_id || "").trim())
    .filter(Boolean)));

  if (submittedMenuIds.length) {
    const menuState = await admin
      .from("vendor_menu_items")
      .select("*")
      .eq("vendor_id", vendor_id)
      .in("id", submittedMenuIds);

    if (menuState.error) {
      return json(500, { ok: false, error: "DB_ERROR", message: menuState.error.message });
    }

    const menuRows = Array.isArray(menuState.data) ? (menuState.data as any[]) : [];
    const byId = new Map<string, any>();
    for (const row of menuRows) {
      const id = String(row?.id ?? row?.menu_item_id ?? "").trim();
      if (id) byId.set(id, row);
    }

    const requestedById = new Map<string, { qty: number; name: string }>();
    for (const item of items) {
      const id = String(item.menu_item_id || "").trim();
      if (!id) continue;
      const qty = Math.max(1, Number(item.quantity || 1) || 1);
      const prev = requestedById.get(id);
      requestedById.set(id, {
        qty: (prev?.qty || 0) + qty,
        name: String(item.name || prev?.name || id),
      });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const soldById = new Map<string, number>();
    try {
      const soldRes = await admin
        .from("takeout_order_items")
        .select("menu_item_id,quantity,snapshot_at")
        .in("menu_item_id", submittedMenuIds)
        .gte("snapshot_at", todayIso);

      if (!soldRes.error && Array.isArray(soldRes.data)) {
        for (const row of soldRes.data as any[]) {
          const id = String(row?.menu_item_id || "").trim();
          if (!id) continue;
          const qty = Math.max(0, Number(row?.quantity || 0) || 0);
          soldById.set(id, (soldById.get(id) || 0) + qty);
        }
      }
    } catch {
      // If the sold-count lookup fails unexpectedly, keep the direct menu remaining guard below.
    }

    const blocked: Array<{ name: string; requested: number; remaining: number }> = [];
    const unavailable: string[] = [];

    for (const [id, req] of requestedById.entries()) {
      const row = byId.get(id);
      if (!row) {
        unavailable.push(req.name || id);
        continue;
      }

      const availableRaw = row?.is_active ?? row?.is_available ?? row?.is_available_today ?? row?.available_today ?? row?.available;
      const soldRaw = row?.sold_out_today ?? row?.is_sold_out_today;
      const available = typeof availableRaw === "boolean" ? availableRaw : true;
      const soldOut = typeof soldRaw === "boolean" ? soldRaw : false;
      if (!available || soldOut) {
        unavailable.push(req.name || String(row?.name || id));
        continue;
      }

      const directRemaining = Number(row?.remaining_quantity ?? row?.remaining_today ?? row?.available_quantity_today);
      const dailyLimit = Number(row?.daily_limit ?? row?.daily_quantity_limit ?? row?.max_daily_quantity ?? row?.quantity_limit_per_day);

      let remaining: number | null = null;
      if (Number.isFinite(directRemaining)) {
        remaining = Math.max(0, Math.floor(directRemaining));
      } else if (Number.isFinite(dailyLimit)) {
        const sold = soldById.get(id) || 0;
        remaining = Math.max(0, Math.floor(dailyLimit - sold));
      }

      if (remaining != null && req.qty > remaining) {
        blocked.push({
          name: String(row?.name || req.name || id),
          requested: req.qty,
          remaining,
        });
      }
    }

    if (unavailable.length) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_ITEM_UNAVAILABLE",
        message: "One or more selected items are unavailable. Please refresh the menu.",
        blocked_items: unavailable,
      });
    }

    if (blocked.length) {
      const first = blocked[0];
      return json(409, {
        ok: false,
        error: "INSUFFICIENT_STOCK",
        message: "Only " + first.remaining + " remaining for " + first.name + ".",
        blocked_items: blocked,
      });
    }
  }

  // JRIDE TAKEOUT ORDER CREATE SCHEMA SAFE V1
  // Create booking row (schema-safe: auto-drop unknown booking columns and retry).
  // This must stay fail-safe because production schemas may not yet contain
  // productization fields such as receipt_requested or premium_packaging_* .
  async function insertBookingSchemaSafe(initial: Record<string, any>) {
    let payload: Record<string, any> = { ...initial };
    let lastError: any = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      const res = await admin!.from("bookings").insert(payload).select("*").single();

      if (!res.error) return res;

      lastError = res.error;
      const msg = String((res.error as any)?.message || "");

      const m =
        msg.match(/Could not find the '([^']+)' column of 'bookings' in the schema cache/i) ||
        msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"bookings"\s+does\s+not\s+exist/i);

      if (m && m[1]) {
        const col = String(m[1]);
        if (Object.prototype.hasOwnProperty.call(payload, col)) {
          delete (payload as any)[col];
          continue;
        }
      }

      return res;
    }

    return {
      data: null,
      error: {
        message:
          "DB_ERROR: schema-safe insert retries exceeded. Last error: " +
          String(lastError?.message || "unknown"),
      },
    } as any;
  }

  // TAKEOUT_CREATE_COORDS_RESTORE_V1
  // Create path only: resolve pickup/dropoff/town before inserting booking.
  const device_key = String(body?.device_key ?? body?.deviceKey ?? "").trim();
  const address_id = String(body?.address_id ?? body?.addressId ?? "").trim() || null;
  const to_label_hint = String(body?.to_label ?? body?.toLabel ?? body?.address_text ?? body?.addressText ?? "").trim() || null;

  const v = await fetchVendorCoordsAndTown(admin, vendor_id);
  const vendorLL = v.ll;
  const vendorTown = v.town;

  // JRIDE_VENDOR_ORDERS_DELIVERY_PIN_PRIORITY_V1
  // The passenger live map pin is authoritative for takeout dropoff.
  // Fallback to saved address/geocoder only when no live pin was sent.
  const explicitDropLat = isFiniteNum(
    body?.delivery_pin_lat ??
      body?.deliveryPinLat ??
      body?.dropoff_lat ??
      body?.dropoffLat ??
      body?.to_lat ??
      body?.toLat ??
      null,
  );
  const explicitDropLng = isFiniteNum(
    body?.delivery_pin_lng ??
      body?.deliveryPinLng ??
      body?.dropoff_lng ??
      body?.dropoffLng ??
      body?.to_lng ??
      body?.toLng ??
      null,
  );

  const fallbackDropLL = await fetchAddressCoords(admin, device_key, address_id, to_label_hint);
  const dropLL =
    explicitDropLat != null && explicitDropLng != null
      ? { lat: explicitDropLat, lng: explicitDropLng }
      : fallbackDropLL;

  const explicitTown = String((body as any)?.town ?? (body as any)?.municipality ?? "").trim() || null;
  const derivedTown =
    explicitTown ||
    vendorTown ||
    inferTownFromLabel(to_label_hint) ||
    deriveTownFromLatLng(vendorLL.lat, vendorLL.lng) ||
    null;

  const pickupLL = normalizeLL(vendorLL);
  const dropoffLL = normalizeLL(dropLL);

  if (pickupLL?.lat == null || pickupLL?.lng == null || dropoffLL?.lat == null || dropoffLL?.lng == null) {
    return json(400, {
      ok: false,
      error: "TAKEOUT_COORDS_MISSING",
      message: "Missing pickup/dropoff coordinates. Check vendor_accounts lat/lng and passenger_addresses lat/lng.",
      details: {
        pickup_lat: (pickupLL as any)?.lat ?? null,
        pickup_lng: (pickupLL as any)?.lng ?? null,
        dropoff_lat: (dropoffLL as any)?.lat ?? null,
        dropoff_lng: (dropoffLL as any)?.lng ?? null,
        town: derivedTown,
      },
    });
  }
  // TAKEOUT_BOOKING_CODE_CREATE_V1
  const takeoutBookingCode =
    String(body?.booking_code ?? body?.bookingCode ?? "").trim() ||
    ("TO-" +
      new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) +
      "-" +
      Math.floor(1000 + Math.random() * 9000));
  const createPayload: Record<string, any> = {    // PHASE_3D_TAKEOUT_COORDS_FIX fields

    // PHASE_3E_VENDORORDERS_TOWNZONE_FIELDS
    // bookings has 'town' column (no 'zone' column) - keep town only

    // Likely required / core

    vendor_id,

    service_type: "takeout",

    vendor_status,
    booking_code: takeoutBookingCode,
  // PHASE_3F create-time town + coords (no 0/0)
  town: (typeof derivedTown !== "undefined" ? derivedTown : null),
        pickup_lat: (pickupLL as any)?.lat ?? null,
        pickup_lng: (pickupLL as any)?.lng ?? null,
        dropoff_lat: (dropoffLL as any)?.lat ?? null,
        dropoff_lng: (dropoffLL as any)?.lng ?? null,
    status: "requested",

    // Optional fields (schema-safe; unknown columns are auto-dropped).
    // Authoritative passenger identity comes from verified server-side auth/profile only.
    created_by_user_id: passengerAuth.passenger.userId || null,
    passenger_name: customer_name,
    passenger_phone: customer_phone,
    customer_phone: customer_phone,
    phone: customer_phone,
    contact_phone: customer_phone,

    to_label: to_label || null,

    notes: note || null,
    customer_note: note || null,
    passenger_note: note || null,

    items_text: items_text || null,
    premium_packaging_selected,
    premium_packaging_fee: premium_packaging_selected ? premium_packaging_fee : 0,
    premium_packaging_label: premium_packaging_selected ? premium_packaging_label : null,
    receipt_requested,
    request_vendor_receipt: receipt_requested,
    order_preferences: {
      premium_packaging_selected,
      premium_packaging_fee: premium_packaging_selected ? premium_packaging_fee : 0,
      premium_packaging_label: premium_packaging_selected ? premium_packaging_label : null,
      receipt_requested,
    },

    // Canonical fallback for production schemas where optional booking columns
    // such as receipt_requested, order_preferences, or premium_packaging_*
    // do not exist. This column is already used by takeout pricing routes.
    takeout_pricing_snapshot: {
      premium_packaging_selected,
      premium_packaging_fee: premium_packaging_selected ? premium_packaging_fee : 0,
      premium_packaging_label: premium_packaging_selected ? premium_packaging_label : null,
      packaging_subtotal: premium_packaging_selected ? premium_packaging_fee : 0,
      takeout_packaging_subtotal: premium_packaging_selected ? premium_packaging_fee : 0,
      passenger_phone: customer_phone,
      customer_phone: customer_phone,
      phone: customer_phone,
      receipt_requested,
      request_vendor_receipt: receipt_requested,
    },

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
      String(
        (vendorMeta as any)?.vendor_location_label ??
        (body as any)?.pickup_label ??
        (body as any)?.from_label ??
        (body as any)?.vendor_label ??
        (vendorMeta as any)?.location_label ??
        ""
      ).trim() ||
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
    booking_code: takeoutBookingCode,
    premium_packaging_selected,
    premium_packaging_fee: premium_packaging_selected ? premium_packaging_fee : 0,
    premium_packaging_label: premium_packaging_selected ? premium_packaging_label : null,
    receipt_requested,

    
    resolved_pickup: pickupLL ?? vendorLL ?? null,
    resolved_dropoff: dropoffLL ?? dropLL ?? null,
    db_coords: coords_debug,

takeout_items_subtotal: subtotal,

    takeoutSnapshot,

  });

}
















function normalizeDriverVehicleType(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase()

  if (raw.includes('tricycle') || raw.includes('trike')) {
    return 'Tricycle'
  }

  if (raw.includes('motor')) {
    return 'Motorcycle'
  }

  return ''
}







