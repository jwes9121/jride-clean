import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SERVICE_FEE = 15;
const PROPOSAL_TTL_SECONDS = 300;
const MAX_DELIVERY_FEE = 2000;
const CUSTOMER_CASH_PICKUP_FREE_KM = 1.5;
const CUSTOMER_CASH_PICKUP_EXCESS_ENV = "JRIDE_TAKEOUT_PICKUP_EXCESS_FEE_PER_500M";

function text(v: any): string {
  return String(v ?? "").trim();
}

function lower(v: any): string {
  return text(v).toLowerCase();
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: any): number | null {
  const n = num(v);
  if (n === null) return null;
  return Math.round(n * 100) / 100;
}

function roundKm(v: number): number {
  return Math.round(v * 100) / 100;
}

function envMoney(name: string): number | null {
  const raw = text(process.env[name]);
  if (!raw) return null;
  return money(raw);
}

function validLatLng(lat: any, lng: any): boolean {
  const a = num(lat);
  const b = num(lng);
  if (a === null || b === null) return false;
  return a >= 4 && a <= 22 && b >= 116 && b <= 127;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

type DriverLocationSnapshot = {
  lat: number | null;
  lng: number | null;
  status: string | null;
  updated_at: string | null;
};

async function loadFreshDriverLocation(serviceSupabase: any, driverId: string): Promise<DriverLocationSnapshot | null> {
  const loc = await serviceSupabase
    .from("driver_locations")
    .select("driver_id,lat,lng,status,updated_at")
    .eq("driver_id", driverId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (loc.error || !loc.data) return null;
  const row = loc.data as any;
  const lat = num(row.lat);
  const lng = num(row.lng);
  return {
    lat,
    lng,
    status: text(row.status) || null,
    updated_at: text(row.updated_at) || null,
  };
}

type CustomerCashPickupBreakdown = {
  pickup_distance_km: number | null;
  pickup_free_km: number;
  pickup_billable_excess_km: number;
  pickup_excess_units_500m: number;
  pickup_excess_fee_per_500m: number;
  pickup_excess_fee: number;
  computation_status: "not_required" | "computed";
};

function noCustomerCashPickupBreakdown(): CustomerCashPickupBreakdown {
  return {
    pickup_distance_km: null,
    pickup_free_km: CUSTOMER_CASH_PICKUP_FREE_KM,
    pickup_billable_excess_km: 0,
    pickup_excess_units_500m: 0,
    pickup_excess_fee_per_500m: 0,
    pickup_excess_fee: 0,
    computation_status: "not_required",
  };
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

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
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

async function assertDriverCanPropose(serviceSupabase: any, driverId: string, currentOrderId?: string): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  const loc = await serviceSupabase
    .from("driver_locations")
    .select("driver_id,status,updated_at")
    .eq("driver_id", driverId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (loc.error) return { ok: false, error: "DRIVER_LOCATION_QUERY_FAILED", message: loc.error.message };
  if (!loc.data || !isOnlineLike((loc.data as any).status) || minutesSince((loc.data as any).updated_at) > 15) {
    if (!currentOrderId) {
      return { ok: false, error: "DRIVER_NOT_AVAILABLE", message: "Driver must be online and fresh before proposing a takeout delivery fee." };
    }
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
    if (currentOrderId && text((row as any).id) === currentOrderId) continue;
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

async function loadTakeoutOrder(serviceSupabase: any, orderId: string, bookingCode: string) {
  let q = serviceSupabase
    .from("bookings")
    .select("id,booking_code,service_type,status,vendor_status,customer_status,assigned_driver_id,takeout_items_subtotal,takeout_pricing_status,vendor_id,passenger_name,to_label,town,dropoff_lat,dropoff_lng,created_at")
    .eq("service_type", "takeout")
    .limit(1);

  if (orderId) q = q.eq("id", orderId);
  else q = q.eq("booking_code", bookingCode);

  return await q.maybeSingle();
}

async function computeItemSubtotal(serviceSupabase: any, bookingId: string): Promise<number | null> {
  const items = await serviceSupabase
    .from("takeout_order_items")
    .select("price,quantity")
    .eq("booking_id", bookingId)
    .limit(100);

  if (items.error) return null;
  let total = 0;
  for (const row of items.data || []) {
    const price = money((row as any).price) ?? 0;
    const quantity = money((row as any).quantity) ?? 1;
    total += price * quantity;
  }
  return total > 0 ? money(total) : null;
}

export async function POST(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const driverAuth = await resolveDriver(req, serviceSupabase);
    if (!driverAuth.ok) return json(driverAuth.status, { ok: false, error: driverAuth.error, message: driverAuth.message });

    const body = await req.json().catch(() => ({}));
    const orderId = text(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id);
    const bookingCode = text(body?.booking_code || body?.bookingCode || body?.code);
    const deliveryFee = money(body?.takeout_delivery_fee ?? body?.delivery_fee ?? body?.deliveryFee ?? body?.fee);
    // JRIDE_TAKEOUT_ROUTE_PLAN_PROPOSE_ROUTE_V1
    // Takeout-only route plan disclosure. This makes clear whether the proposed delivery fee
    // covers vendor-first pickup or customer cash pickup before vendor pickup.
    const routePlan = lower(body?.takeout_route_plan ?? body?.route_plan ?? body?.routePlan);
    const allowedRoutePlans = new Set(["vendor_first", "customer_cash_first"]);

    if (!orderId && !bookingCode) return json(400, { ok: false, error: "ORDER_REQUIRED", message: "order_id or booking_code is required." });
    if (deliveryFee === null || deliveryFee <= 0 || deliveryFee > MAX_DELIVERY_FEE) {
      return json(400, { ok: false, error: "BAD_DELIVERY_FEE", message: "Delivery fee must be greater than 0 and not excessive." });
    }
    if (!allowedRoutePlans.has(routePlan)) {
      return json(400, { ok: false, error: "BAD_TAKEOUT_ROUTE_PLAN", message: "route_plan must be vendor_first or customer_cash_first." });
    }

    const orderRes = await loadTakeoutOrder(serviceSupabase, orderId, bookingCode);
    if (orderRes.error) return json(500, { ok: false, error: "TAKEOUT_ORDER_QUERY_FAILED", message: orderRes.error.message });
    const order = orderRes.data as any;
    if (!order?.id) return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND", message: "Takeout order not found." });

    const assignedDriverId = text(order.assigned_driver_id);
    if (!assignedDriverId) {
      const driverOk = await assertDriverCanPropose(serviceSupabase, driverAuth.driverId);
      if (!driverOk.ok) return json(409, { ok: false, error: driverOk.error, message: driverOk.message });
    } else if (assignedDriverId !== driverAuth.driverId) {
      return json(403, { ok: false, error: "TAKEOUT_ASSIGNED_TO_DIFFERENT_DRIVER", message: "Only the assigned driver can propose this takeout delivery fee." });
    } else {
      const driverOk = await assertDriverCanPropose(serviceSupabase, driverAuth.driverId, order.id);
      if (!driverOk.ok) return json(409, { ok: false, error: driverOk.error, message: driverOk.message });
    }

    const pricingStatus = lower(order.takeout_pricing_status || "pricing_pending");
    const allowedPricingStates = new Set(["", "pricing_pending", "expired", "cancelled"]);
    if (!allowedPricingStates.has(pricingStatus)) {
      return json(409, { ok: false, error: "TAKEOUT_PRICING_NOT_OPEN", message: "Takeout order is not open for delivery fee proposal." });
    }

    const storedSubtotal = money(order.takeout_items_subtotal);
    const computedSubtotal = storedSubtotal ?? (await computeItemSubtotal(serviceSupabase, order.id));
    if (computedSubtotal === null || computedSubtotal <= 0) {
      return json(409, { ok: false, error: "TAKEOUT_SUBTOTAL_MISSING", message: "Cannot propose delivery fee without a takeout item subtotal." });
    }

    let pickupBreakdown = noCustomerCashPickupBreakdown();
    if (routePlan === "customer_cash_first") {
      const driverLoc = await loadFreshDriverLocation(serviceSupabase, driverAuth.driverId);
      const passengerLat = num(order.dropoff_lat);
      const passengerLng = num(order.dropoff_lng);

      if (!driverLoc || !isOnlineLike(driverLoc.status) || minutesSince(driverLoc.updated_at) > 15 || !validLatLng(driverLoc.lat, driverLoc.lng)) {
        return json(409, {
          ok: false,
          error: "DRIVER_LOCATION_REQUIRED",
          message: "Fresh driver coordinates are required to compute customer cash pickup excess.",
        });
      }

      if (!validLatLng(passengerLat, passengerLng)) {
        return json(409, {
          ok: false,
          error: "PASSENGER_LOCATION_REQUIRED",
          message: "Passenger delivery coordinates are required to compute customer cash pickup excess.",
        });
      }

      const feePer500m = envMoney(CUSTOMER_CASH_PICKUP_EXCESS_ENV);
      const pickupDistanceKm = roundKm(haversineKm(
        driverLoc.lat as number,
        driverLoc.lng as number,
        passengerLat as number,
        passengerLng as number
      ));
      const billableExcessKm = roundKm(Math.max(0, pickupDistanceKm - CUSTOMER_CASH_PICKUP_FREE_KM));
      const units500m = billableExcessKm > 0 ? Math.ceil(billableExcessKm / 0.5) : 0;

      if (units500m > 0 && (feePer500m === null || feePer500m < 0)) {
        return json(409, {
          ok: false,
          error: "PICKUP_EXCESS_RATE_MISSING",
          message: `Set ${CUSTOMER_CASH_PICKUP_EXCESS_ENV} before allowing customer_cash_first proposals beyond the free pickup allowance.`,
          pickup_distance_km: pickupDistanceKm,
          pickup_free_km: CUSTOMER_CASH_PICKUP_FREE_KM,
          pickup_billable_excess_km: billableExcessKm,
          pickup_excess_units_500m: units500m,
        });
      }

      const safeFeePer500m = feePer500m ?? 0;
      pickupBreakdown = {
        pickup_distance_km: pickupDistanceKm,
        pickup_free_km: CUSTOMER_CASH_PICKUP_FREE_KM,
        pickup_billable_excess_km: billableExcessKm,
        pickup_excess_units_500m: units500m,
        pickup_excess_fee_per_500m: safeFeePer500m,
        pickup_excess_fee: money(units500m * safeFeePer500m) as number,
        computation_status: "computed",
      };
    }

    const totalPayable = money(computedSubtotal + SERVICE_FEE + deliveryFee + pickupBreakdown.pickup_excess_fee) as number;
    const cashRequired = routePlan === "customer_cash_first" || computedSubtotal >= 500;
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + PROPOSAL_TTL_SECONDS * 1000).toISOString();

    const snapshot = {
      version: "takeout_driver_fee_proposal_v1",
      food_subtotal: computedSubtotal,
      takeout_service_fee: SERVICE_FEE,
      takeout_delivery_fee: deliveryFee,
      takeout_pickup_distance_km: pickupBreakdown.pickup_distance_km,
      takeout_pickup_free_km: pickupBreakdown.pickup_free_km,
      takeout_pickup_billable_excess_km: pickupBreakdown.pickup_billable_excess_km,
      takeout_pickup_excess_units_500m: pickupBreakdown.pickup_excess_units_500m,
      takeout_pickup_excess_fee_per_500m: pickupBreakdown.pickup_excess_fee_per_500m,
      takeout_pickup_excess_fee: pickupBreakdown.pickup_excess_fee,
      takeout_pickup_computation_status: pickupBreakdown.computation_status,
      takeout_total_payable: totalPayable,
      takeout_cash_collection_required: cashRequired,
      proposed_at: nowIso,
      expires_at: expiresIso,
      takeout_route_plan: routePlan,
      route_plan: routePlan,
      // JRIDE_TAKEOUT_PICKUP_EXCESS_DISPLAY_V3
      // Persist pickup excess breakdown so read routes and UIs can display the hidden total line item.
    };

    const updateRes = await serviceSupabase
      .from("bookings")
      .update({
        takeout_pricing_status: "driver_fee_proposed",
        takeout_delivery_fee: deliveryFee,
        takeout_service_fee: SERVICE_FEE,
        takeout_total_payable: totalPayable,
        takeout_cash_collection_required: cashRequired,
        takeout_fee_proposed_at: nowIso,
        takeout_fee_expires_at: expiresIso,
        takeout_route_plan: routePlan,
        takeout_pricing_snapshot: snapshot,
      })
      .eq("id", order.id)
      .eq("service_type", "takeout")
      .select("id,booking_code,service_type,takeout_pricing_status,takeout_delivery_fee,takeout_service_fee,takeout_total_payable,takeout_cash_collection_required,takeout_route_plan,takeout_fee_proposed_at,takeout_fee_expires_at,takeout_pricing_snapshot")
      .single();

    if (updateRes.error) return json(500, { ok: false, error: "TAKEOUT_FEE_PROPOSAL_UPDATE_FAILED", message: updateRes.error.message });

    return json(200, {
      ok: true,
      proposal: updateRes.data,
      pricing: snapshot,
      auth_mode: driverAuth.authMode,
      guard: "takeout_driver_fee_proposal_v6_customer_cash_pickup_excess",
    });
  } catch (err: any) {
    return json(500, { ok: false, error: "TAKEOUT_FEE_PROPOSAL_FAILED", message: err?.message || "Failed to propose takeout delivery fee." });
  }
}
