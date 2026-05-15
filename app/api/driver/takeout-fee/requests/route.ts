import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_ROWS = 10;

function text(v: any): string {
  return String(v ?? "").trim();
}

function lower(v: any): string {
  return text(v).toLowerCase();
}

function n(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function money(v: any): number | null {
  const x = n(v);
  if (x === null) return null;
  return Math.round(x * 100) / 100;
}

function json(status: number, payload: any) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
  });
}

function createServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase service configuration.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function createAnonSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) throw new Error("Missing Supabase anon configuration.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const provided = text(req.headers.get("x-jride-driver-secret"));
  const expected = text(process.env.DRIVER_PING_SECRET) || text(process.env.NEXT_PUBLIC_DRIVER_PING_SECRET);
  return !!provided && !!expected && provided === expected;
}

async function resolveDriverIdFromBearer(serviceSupabase: any, authUserId: string): Promise<string | null> {
  const direct = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("driver_id", authUserId)
    .limit(1)
    .maybeSingle();

  if (!direct.error && direct.data?.driver_id) return text(direct.data.driver_id) || null;

  const authUser = await serviceSupabase
    .from("auth_users_view")
    .select("email")
    .eq("id", authUserId)
    .limit(1)
    .maybeSingle();

  const email = text((authUser.data as any)?.email);
  if (!email) return null;

  const byEmail = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (!byEmail.error && byEmail.data?.driver_id) return text(byEmail.data.driver_id) || null;
  return null;
}

async function resolveDriver(req: NextRequest, serviceSupabase: any): Promise<
  | { ok: true; driverId: string; authMode: "bearer" | "driver_secret" }
  | { ok: false; status: number; error: string; message: string }
> {
  const token = getBearerToken(req);

  if (token) {
    const anon = createAnonSupabase();
    const { data, error } = await anon.auth.getUser(token);
    const user = data?.user ?? null;
    if (error || !user?.id) {
      return { ok: false, status: 401, error: "NOT_AUTHED", message: "Invalid bearer token." };
    }

    const driverId = await resolveDriverIdFromBearer(serviceSupabase, user.id);
    if (!driverId) {
      return { ok: false, status: 404, error: "DRIVER_NOT_FOUND", message: "No driver profile found for token user." };
    }

    return { ok: true, driverId, authMode: "bearer" };
  }

  if (isDriverSecretAuthorized(req)) {
    const driverId = text(req.nextUrl.searchParams.get("driver_id"));
    if (!driverId) {
      return { ok: false, status: 400, error: "DRIVER_ID_REQUIRED", message: "driver_id query parameter required for driver secret mode." };
    }
    return { ok: true, driverId, authMode: "driver_secret" };
  }

  return { ok: false, status: 401, error: "NOT_AUTHED", message: "Missing bearer token or valid driver secret." };
}

function minutesSince(value: any): number {
  const raw = text(value);
  if (!raw) return 999999;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return 999999;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function isOnlineLike(value: any): boolean {
  const s = lower(value);
  return s === "online" || s === "available" || s === "idle" || s === "waiting";
}

async function assertDriverCanViewRequests(serviceSupabase: any, driverId: string): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  const loc = await serviceSupabase
    .from("driver_locations")
    .select("driver_id,status,updated_at")
    .eq("driver_id", driverId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (loc.error) return { ok: false, error: "DRIVER_LOCATION_QUERY_FAILED", message: loc.error.message };
  if (!loc.data || !isOnlineLike((loc.data as any).status) || minutesSince((loc.data as any).updated_at) > 15) {
    return { ok: false, error: "DRIVER_NOT_AVAILABLE", message: "Driver must be online and fresh before viewing takeout fee requests." };
  }

  const active = await serviceSupabase
    .from("bookings")
    .select("id,booking_code,service_type,status,vendor_status,customer_status,assigned_driver_id")
    .eq("assigned_driver_id", driverId)
    .limit(100);

  if (active.error) return { ok: false, error: "DRIVER_ACTIVE_QUERY_FAILED", message: active.error.message };

  const activeRide = new Set(["pending", "assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"]);
  const activeTakeout = new Set(["requested", "preparing", "pickup_ready", "driver_assigned", "rider_arrived_vendor", "picked_up", "delivering"]);

  for (const row of active.data || []) {
    const serviceType = lower((row as any).service_type);
    const rideStatus = lower((row as any).status);
    const takeoutStatus = lower((row as any).vendor_status || (row as any).customer_status || (row as any).status);
    if (serviceType === "takeout" && activeTakeout.has(takeoutStatus)) {
      return { ok: false, error: "DRIVER_ALREADY_ACTIVE", message: "Driver already has an active takeout order." };
    }
    if (serviceType !== "takeout" && activeRide.has(rideStatus)) {
      return { ok: false, error: "DRIVER_ALREADY_ACTIVE", message: "Driver already has an active ride booking." };
    }
  }

  return { ok: true };
}

async function loadItemSummary(serviceSupabase: any, bookingIds: string[]): Promise<Record<string, { summary: string | null; computedSubtotal: number | null }>> {
  const result: Record<string, { summary: string | null; computedSubtotal: number | null }> = {};
  if (!bookingIds.length) return result;

  const itemRes = await serviceSupabase
    .from("takeout_order_items")
    .select("booking_id,name,price,quantity")
    .in("booking_id", bookingIds)
    .limit(300);

  if (itemRes.error || !Array.isArray(itemRes.data)) return result;

  for (const row of itemRes.data as any[]) {
    const bookingId = text(row?.booking_id);
    if (!bookingId) continue;
    if (!result[bookingId]) result[bookingId] = { summary: null, computedSubtotal: null };

    const qty = money(row?.quantity) ?? 1;
    const name = text(row?.name) || "Item";
    const price = money(row?.price) ?? 0;
    const line = `${qty}x ${name}`;

    result[bookingId].summary = result[bookingId].summary ? `${result[bookingId].summary}, ${line}` : line;
    const current = result[bookingId].computedSubtotal ?? 0;
    result[bookingId].computedSubtotal = money(current + price * qty);
  }

  return result;
}

async function loadVendorNames(serviceSupabase: any, vendorIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!vendorIds.length) return out;

  const vendorRes = await serviceSupabase
    .from("vendor_accounts")
    .select("id,display_name,location_label,town")
    .in("id", vendorIds)
    .limit(100);

  if (vendorRes.error || !Array.isArray(vendorRes.data)) return out;
  for (const row of vendorRes.data as any[]) {
    const id = text(row?.id);
    if (!id) continue;
    out[id] = text(row?.display_name) || text(row?.location_label) || text(row?.town) || id;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const driverAuth = await resolveDriver(req, serviceSupabase);
    if (!driverAuth.ok) return json(driverAuth.status, { ok: false, error: driverAuth.error, message: driverAuth.message });

    const driverOk = await assertDriverCanViewRequests(serviceSupabase, driverAuth.driverId);
    if (!driverOk.ok) return json(409, { ok: false, error: driverOk.error, message: driverOk.message, requests: [] });

    // JRIDE_TAKEOUT_DRIVER_FEE_REQUESTS_ROUTE_V1
    // Read-only feed for unassigned takeout orders waiting for driver delivery fee proposals.
    // This route does not assign drivers, move statuses, or update ride booking fields.
    const orderRes = await serviceSupabase
      .from("bookings")
      .select("id,booking_code,service_type,status,vendor_status,customer_status,assigned_driver_id,takeout_items_subtotal,takeout_pricing_status,vendor_id,passenger_name,to_label,town,notes,created_at,updated_at")
      .eq("service_type", "takeout")
      .is("assigned_driver_id", null)
      .or("takeout_pricing_status.is.null,takeout_pricing_status.eq.pricing_pending,takeout_pricing_status.eq.expired")
      .order("created_at", { ascending: true })
      .limit(MAX_ROWS);

    if (orderRes.error) return json(500, { ok: false, error: "TAKEOUT_FEE_REQUESTS_QUERY_FAILED", message: orderRes.error.message });

    const rows = Array.isArray(orderRes.data) ? orderRes.data : [];
    const bookingIds = rows.map((r: any) => text(r?.id)).filter(Boolean);
    const vendorIds = Array.from(new Set(rows.map((r: any) => text(r?.vendor_id)).filter(Boolean)));
    const itemsByBooking = await loadItemSummary(serviceSupabase, bookingIds);
    const vendorNameById = await loadVendorNames(serviceSupabase, vendorIds);

    const requests = rows.map((row: any) => {
      const id = text(row?.id);
      const itemInfo = itemsByBooking[id] || { summary: null, computedSubtotal: null };
      const foodSubtotal = money(row?.takeout_items_subtotal) ?? itemInfo.computedSubtotal;
      const pricingStatus = lower(row?.takeout_pricing_status || "pricing_pending");
      const cashRequired = (foodSubtotal ?? 0) >= 500;
      const vendorId = text(row?.vendor_id);

      return {
        id,
        booking_id: id,
        booking_code: text(row?.booking_code),
        service_type: "takeout",
        status: text(row?.status),
        vendor_status: text(row?.vendor_status),
        customer_status: text(row?.customer_status),
        takeout_pricing_status: pricingStatus,
        vendor_id: vendorId || null,
        vendor_name: vendorNameById[vendorId] || vendorId || null,
        customer_name: text(row?.passenger_name) || "Takeout Customer",
        delivery_address: text(row?.to_label) || null,
        town: text(row?.town) || null,
        notes: text(row?.notes) || null,
        items_summary: itemInfo.summary,
        takeout_items_subtotal: foodSubtotal,
        takeout_cash_collection_required: cashRequired,
        created_at: row?.created_at ?? null,
        updated_at: row?.updated_at ?? null,
      };
    });

    return json(200, {
      ok: true,
      requests,
      count: requests.length,
      auth_mode: driverAuth.authMode,
      guard: "takeout_driver_fee_requests_v1_read_only",
    });
  } catch (err: any) {
    return json(500, { ok: false, error: "TAKEOUT_FEE_REQUESTS_FAILED", message: err?.message || "Failed to load takeout fee requests." });
  }
}
