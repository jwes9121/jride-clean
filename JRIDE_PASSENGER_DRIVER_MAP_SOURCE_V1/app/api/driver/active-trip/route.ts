import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";


// JRIDE_ACTIVE_TRIP_TAKEOUT_STATUS_SHAPE_V1
// Driver active-trip read shaping only.
// Purpose: keep takeout status values as takeout workflow statuses for Android driver UI.
// Does not write to DB and does not alter ride lifecycle rules.
function jrideActiveTripText(v: any): string {
  return String(v ?? "").trim();
}

function jrideActiveTripLower(v: any): string {
  return jrideActiveTripText(v).toLowerCase();
}


// JRIDE_TAKEOUT_NOTE_CONTRACT_V1
// Read-only shaping: remove operational text from passenger notes.
function jrideCleanTakeoutCustomerNote(v: any): string {
  let t = jrideActiveTripText(v);
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

function jrideTakeoutSystemInstructions(row: any, cashRequired: boolean): string[] {
  const out: string[] = [];
  const snap = row?.takeout_pricing_snapshot && typeof row.takeout_pricing_snapshot === "object" ? row.takeout_pricing_snapshot : {};
  const receiptRequested = Boolean(row?.receipt_requested ?? row?.request_vendor_receipt ?? snap?.receipt_requested ?? false);
  const packaging = jrideActiveTripText(row?.premium_packaging_label ?? snap?.premium_packaging_label ?? "");
  if (packaging) out.push(`Packaging: ${packaging}`);
  if (cashRequired) out.push("Collect cash before vendor purchase.");
  if (receiptRequested) out.push("Vendor receipt requested.");
  return out;
}

function jrideIsTakeoutActiveTrip(row: any): boolean {
  if (!row || typeof row !== "object") return false;
  const serviceType = jrideActiveTripLower(row.service_type ?? row.serviceType ?? row.trip_type ?? row.tripType);
  const bookingCode = jrideActiveTripText(row.booking_code ?? row.bookingCode ?? row.code ?? row.id);
  return serviceType === "takeout" || serviceType === "food" || serviceType === "delivery" || bookingCode.toUpperCase().startsWith("TO-");
}

function jrideTakeoutDriverStatus(row: any): string | null {
  if (!jrideIsTakeoutActiveTrip(row)) return null;

  const raw = jrideActiveTripLower(
    row.takeout_status ??
      row.takeoutStatus ??
      row.driver_takeout_status ??
      row.driverTakeoutStatus ??
      row.vendor_status ??
      row.vendorStatus ??
      row.customer_status ??
      row.customerStatus ??
      row.delivery_status ??
      row.deliveryStatus ??
      row.status
  );

  if (!raw) return "driver_assigned";

  // JRIDE_TAKEOUT_STATUS_ALIAS_V1
  // Normalize backend takeout aliases to the Android takeout state machine.
  if (raw === "arrived_customer_cash") return "driver_assigned";
  if (raw === "cash_collected" || raw === "customer_cash_collected") return "cash_collected";
  if (raw === "rider_arrived_vendor" || raw === "arrived_at_vendor" || raw === "at_vendor") return "arrived_vendor";
  if (raw === "order_picked_up" || raw === "pickedup" || raw === "picked-up") return "picked_up";
  if (raw === "out_for_delivery" || raw === "in_delivery") return "delivering";

  if (raw === "requested" || raw === "pending") return "preparing";
  if (raw === "assigned" || raw === "accepted" || raw === "driver_assigned") return "driver_assigned";
  if (raw === "pickup_ready") return "driver_assigned";
  if (raw === "arrived_vendor" || raw === "at_vendor") return "arrived_vendor";
  if (raw === "picked_up" || raw === "pickup_done") return "picked_up";
  if (raw === "delivering" || raw === "on_delivery") return "delivering";
  if (raw === "completed" || raw === "cancelled") return raw;

  return raw;
}

function jrideShapeActiveTripForDriver(row: any): any {
  if (!row || typeof row !== "object") return row;
  if (!jrideIsTakeoutActiveTrip(row)) return row;

  const shaped = { ...row };
  const status = jrideTakeoutDriverStatus(row) ?? "driver_assigned";
  shaped.status = status;
  shaped.service_type = "takeout";
  shaped.serviceType = "takeout";
  shaped.takeout_status = status;
  return shaped;
}

// JRIDE_ACTIVE_TRIP_TAKEOUT_STATUS_SHAPE_V2
// Completed/cancelled takeout orders must never be returned as an active driver job.
function jrideIsTerminalTakeoutActiveTrip(row: any): boolean {
  if (!jrideIsTakeoutActiveTrip(row)) return false;
  const vendorStatus = jrideActiveTripLower(row.vendor_status ?? row.vendorStatus);
  const customerStatus = jrideActiveTripLower(row.customer_status ?? row.customerStatus);
  const takeoutStatus = jrideTakeoutDriverStatus(row);
  return (
    vendorStatus === "completed" ||
    vendorStatus === "cancelled" ||
    customerStatus === "completed" ||
    customerStatus === "cancelled" ||
    takeoutStatus === "completed" ||
    takeoutStatus === "cancelled"
  );
}
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function s(v: unknown): string | null {
  const x = String(v ?? "").trim();
  return x.length > 0 ? x : null;
}

// JRIDE_TAKEOUT_PICKUP_EXCESS_DISPLAY_V3
// Read-only helper for pickup excess values persisted in takeout_pricing_snapshot.
function jrideTakeoutPricingSnapshot(row: any): any {
  const raw = row?.takeout_pricing_snapshot ?? row?.pricing_snapshot ?? null;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function jrideTakeoutSnapshotNumber(row: any, key: string): number | null {
  const snap = jrideTakeoutPricingSnapshot(row);
  return n(row?.[key]) ?? n(snap?.[key]);
}

function statusOf(raw: unknown): string {
  const s0 = String(raw ?? "").trim().toLowerCase();
  if (s0 === "requested" || s0 === "searching") return "searching";
  if (s0 === "driver_assigned") return "assigned";
  if (s0 === "accepted_by_driver") return "accepted";
  if (s0 === "en_route") return "on_the_way";
  if (s0 === "in_progress") return "on_trip";
  return s0;
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function createAnonSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) throw new Error("Missing Supabase anon client environment variables.");
  return createSupabaseClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRole) throw new Error("Missing Supabase service role environment variables.");
  return createSupabaseClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function estimateEtaMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(1, Math.ceil((distanceKm / 25) * 60));
}

// JRIDE_TAKEOUT_ACTIVE_TRIP_PRICING_SYNC_V16
// Read-side only: expose takeout fee proposal and customer confirmation fields to Android.
// This does not write to DB and does not alter ride lifecycle, wallet, or dispatch rules.
function jrideTakeoutConfirmedAt(row: any): string | null {
  return (
    s(row?.takeout_customer_confirmed_at) ??
    s(row?.customer_confirmed_at) ??
    s(row?.passenger_confirmed_at)
  );
}

function jrideTakeoutPricingStatusForDriver(row: any): string | null {
  const explicit = s(row?.takeout_pricing_status ?? row?.pricing_status ?? row?.driver_fee_status ?? row?.fee_status);
  if (explicit) return explicit;
  if (jrideTakeoutConfirmedAt(row)) return "customer_confirmed";
  const fee = n(row?.takeout_delivery_fee ?? row?.driver_delivery_fee ?? row?.delivery_fee ?? row?.proposed_delivery_fee);
  return fee != null && fee > 0 ? "driver_fee_proposed" : null;
}

function jrideTakeoutDeliveryFeeForDriver(row: any): number | null {
  return (
    n(row?.takeout_delivery_fee) ??
    n(row?.driver_delivery_fee) ??
    n(row?.delivery_fee) ??
    n(row?.proposed_delivery_fee)
  );
}

function jrideTakeoutTotalPayableForDriver(row: any): number | null {
  return (
    n(row?.takeout_total_payable) ??
    n(row?.total_payable) ??
    n(row?.payable_total) ??
    n(row?.grand_total)
  );
}

// JRIDE_TAKEOUT_ACTIVE_TRIP_DISTANCE_GUARD_V1
// Read-side only: prevent impossible takeout distance and ETA values from leaking to Android.
function jrideIsPhilippinesCoordPair(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= 4 && lat <= 22 && lng >= 116 && lng <= 127;
}

function jrideIsSaneTakeoutDistanceKm(km: number | null): boolean {
  if (km == null) return false;
  if (!Number.isFinite(km)) return false;
  return km >= 0 && km <= 100;
}



// JRIDE_ACTIVE_TRIP_TAKEOUT_RECEIPT_SCHEMA_V1`r`n// Align active-trip takeout receipt loader with production takeout_order_items schema.`r`n// JRIDE_TAKEOUT_DRIVER_ORDER_RECEIPT_V3
// Read-only fields for Android driver takeout receipt. No DB writes. No ride lifecycle changes.
function jrideTakeoutReceiptAmount(row: any): number | null {
  return (
    n(row?.takeout_items_subtotal) ??
    n(row?.items_subtotal) ??
    n(row?.order_total) ??
    n(row?.food_total) ??
    n(row?.total_food_price) ??
    n(row?.subtotal) ??
    n(row?.total_amount) ??
    n(row?.grand_total)
  );
}

function jrideTakeoutDisplayName(row: any): string | null {
  return (
    s(row?.display_name) ??
    s(row?.vendor_name) ??
    s(row?.restaurant_name) ??
    s(row?.store_name) ??
    s(row?.business_name) ??
    s(row?.name) ??
    s(row?.email) ??
    s(row?.id)
  );
}

function jrideTakeoutItemLine(row: any): string | null {
  const qty = n(row?.quantity ?? row?.qty ?? row?.count) ?? 1;
  const name =
    s(row?.name) ??
    s(row?.item_name) ??
    s(row?.menu_name) ??
    s(row?.product_name) ??
    s(row?.title) ??
    s(row?.description);
  if (!name) return null;
  return `${qty}x ${name}`;
}

async function jrideLoadTakeoutReceiptV3(serviceSupabase: any, booking: any): Promise<{
  vendorName: string | null;
  vendorLocationLabel: string | null;
  vendorLat: number | null;
  vendorLng: number | null;
  itemsSummary: string | null;
  computedSubtotal: number | null;
}> {
  let vendorName: string | null = null;
  let vendorLocationLabel: string | null = null;
  let vendorLat: number | null = null;
  let vendorLng: number | null = null;
  let itemsSummary: string | null = null;
  let computedSubtotal: number | null = null;

  const vendorId = s(booking?.vendor_id);
  if (vendorId) {
    try {
      const vendorRes = await serviceSupabase
        .from("vendor_accounts")
        .select("id,display_name,email,town,lat,lng,location_label,vendor_lat,vendor_lng,vendor_location_label")
        .eq("id", vendorId)
        .limit(1)
        .maybeSingle();
      if (!vendorRes.error && vendorRes.data) {
        vendorName = jrideTakeoutDisplayName(vendorRes.data);
        vendorLocationLabel = s((vendorRes.data as any).vendor_location_label) ?? s((vendorRes.data as any).location_label);
        vendorLat = n((vendorRes.data as any).vendor_lat) ?? n((vendorRes.data as any).lat);
        vendorLng = n((vendorRes.data as any).vendor_lng) ?? n((vendorRes.data as any).lng);
      }
    } catch (_) {}
  }

  try {
    const itemRes = await serviceSupabase
      .from("takeout_order_items")
      .select("booking_id,menu_item_id,name,price,quantity,snapshot_at")
      .eq("booking_id", booking?.id)
      .limit(20);
    if (!itemRes.error && Array.isArray(itemRes.data) && itemRes.data.length) {
      const lines: string[] = [];
      let subtotal = 0;
      for (const row of itemRes.data as any[]) {
        const line = jrideTakeoutItemLine(row);
        if (line) lines.push(line);
        const price = n(row?.price) ?? 0;
        const qty = n(row?.quantity ?? row?.qty) ?? 1;
        subtotal += price * qty;
      }
      if (lines.length) itemsSummary = lines.join(", ");
      if (subtotal > 0) computedSubtotal = Number(subtotal.toFixed(2));
    }
  } catch (_) {}

  return { vendorName, vendorLocationLabel, vendorLat, vendorLng, itemsSummary, computedSubtotal };
}

function deriveStageHints(status: string, fareReady: boolean) {
  const waitingForDriverProposal = !fareReady && (status === "assigned" || status === "accepted");
  return {
    waiting_for_driver_proposal: waitingForDriverProposal,
    fare_ready: fareReady,
    pickup_metrics_ready: !waitingForDriverProposal,
  };
}

async function resolveDriverIdFromBearer(serviceSupabase: any, authUserId: string): Promise<string | null> {
  const directProfile = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("driver_id", authUserId)
    .limit(1)
    .maybeSingle();

  if (!directProfile.error && directProfile.data?.driver_id) {
    return s(directProfile.data.driver_id);
  }

  const authUser = await serviceSupabase
    .from("auth_users_view")
    .select("email")
    .eq("id", authUserId)
    .limit(1)
    .maybeSingle();

  const email = s((authUser.data as any)?.email);
  if (!email) return null;

  const byEmail = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (!byEmail.error && byEmail.data?.driver_id) {
    return s(byEmail.data.driver_id);
  }

  return null;
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const provided = s(req.headers.get("x-jride-driver-secret"));
  const expected = s(process.env.DRIVER_PING_SECRET) ?? s(process.env.NEXT_PUBLIC_DRIVER_PING_SECRET);
  return !!provided && !!expected && provided === expected;
}

export async function GET(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const accessToken = getBearerToken(req);

    let driverId: string | null = null;
    let authMode: "bearer" | "driver_secret" | null = null;

    if (accessToken) {
      const authSupabase = createAnonSupabase();
      const { data: userRes, error: userErr } = await authSupabase.auth.getUser(accessToken);
      const user = userRes?.user ?? null;
      if (userErr || !user?.id) {
        return NextResponse.json(
          { ok: false, error: "NOT_AUTHED", message: "Invalid bearer token." },
          { status: 401, headers: noStoreHeaders() }
        );
      }
      driverId = await resolveDriverIdFromBearer(serviceSupabase, user.id);
      authMode = "bearer";
    } else if (isDriverSecretAuthorized(req)) {
      driverId = s(req.nextUrl.searchParams.get("driver_id"));
      authMode = "driver_secret";
    } else {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Missing bearer token or valid driver secret." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    if (!driverId) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_NOT_FOUND",
          message: authMode === "driver_secret" ? "Missing driver_id query parameter." : "No driver profile found for token user.",
        },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const bookingRes = await serviceSupabase
      .from("bookings")
      .select("*")
      .or(`driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`)
      // JRIDE_ACTIVE_TRIP_TAKEOUT_ASSIGNMENT_QUERY_V1
      // Read-only active-trip query widening for takeout assignments.
      // Ride lifecycle statuses remain unchanged. This only lets Android see
      // assigned takeout rows where bookings.status is still "requested" but
      // vendor_status/customer_status already shows driver assignment.
      .or("status.in.(assigned,accepted,fare_proposed,ready,on_the_way,arrived,on_trip),and(service_type.eq.takeout,vendor_status.in.(driver_assigned,preparing,pickup_ready,arrived_customer_cash,cash_collected,rider_arrived_vendor,picked_up,delivering)),and(service_type.eq.takeout,customer_status.in.(driver_assigned,preparing,pickup_ready,arrived_customer_cash,cash_collected,rider_arrived_vendor,picked_up,delivering))")
      .order("updated_at", { ascending: false })
      .limit(10);

    if (bookingRes.error) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_QUERY_FAILED", details: bookingRes.error.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const bookingRows = Array.isArray(bookingRes.data) ? bookingRes.data : (bookingRes.data ? [bookingRes.data] : []);
    const booking = bookingRows.find((row: any) => !jrideIsTerminalTakeoutActiveTrip(row)) ?? null;
    if (!booking) {
      return NextResponse.json(
        { ok: true, trip: null, active_trip: null, auth_mode: authMode },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    let passengerPhone: string | null = null;

    if ((booking as any).created_by_user_id) {
      const passengerProfileRes = await serviceSupabase
        .from("passenger_profiles")
        .select("phone")
        .eq("user_id", (booking as any).created_by_user_id)
        .limit(1)
        .maybeSingle();

      if (!passengerProfileRes.error && passengerProfileRes.data) {
        passengerPhone = s((passengerProfileRes.data as any).phone);
      }
    }

    if (!passengerPhone) {
      const passengerNameForPhone = s((booking as any).passenger_name);
      if (passengerNameForPhone) {
        try {
          const passengerProfileByNameRes = await serviceSupabase
            .from("passenger_profiles")
            .select("phone")
            .ilike("full_name", passengerNameForPhone)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!passengerProfileByNameRes.error && passengerProfileByNameRes.data) {
            passengerPhone = s((passengerProfileByNameRes.data as any).phone);
          }
        } catch (_) {}
      }
    }

    if (!passengerPhone) {
      const passengerNameForPhone = s((booking as any).passenger_name);
      if (passengerNameForPhone) {
        try {
          const passengerVerificationByNameRes = await serviceSupabase
            .from("passenger_verifications")
            .select("phone")
            .ilike("full_name", passengerNameForPhone)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!passengerVerificationByNameRes.error && passengerVerificationByNameRes.data) {
            passengerPhone = s((passengerVerificationByNameRes.data as any).phone);
          }
        } catch (_) {}
      }
    }
    passengerPhone =
      passengerPhone ??
      s((booking as any).passenger_phone) ??
      s((booking as any).customer_phone) ??
      s((booking as any).phone) ??
      s((booking as any).contact_phone) ??
      s((booking as any).rider_phone);

    let driverName: string | null = null;
    let driverPhone: string | null = null;
    let driverLat: number | null = null;
    let driverLng: number | null = null;

    const driverProfileRes = await serviceSupabase
      .from("driver_profiles")
      .select("driver_id, full_name, callsign, phone")
      .eq("driver_id", driverId)
      .limit(1)
      .maybeSingle();

    if (!driverProfileRes.error && driverProfileRes.data) {
      driverName = s((driverProfileRes.data as any).full_name) ?? s((driverProfileRes.data as any).callsign);
      driverPhone = s((driverProfileRes.data as any).phone);
    }

    const driverLocRes = await serviceSupabase
      .from("driver_locations_latest")
      .select("lat,lng")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (!driverLocRes.error && driverLocRes.data) {
      driverLat = n((driverLocRes.data as any).lat);
      driverLng = n((driverLocRes.data as any).lng);
    }

    const isTakeoutBooking = jrideIsTakeoutActiveTrip(booking as any);
    const takeoutDriverStatus = jrideTakeoutDriverStatus(booking as any);
    const normalizedStatus = takeoutDriverStatus ?? statusOf((booking as any).status);
    const takeoutReceipt = isTakeoutBooking
      ? await jrideLoadTakeoutReceiptV3(serviceSupabase, booking as any)
      : {
        vendorName: null,
        vendorLocationLabel: null,
        vendorLat: null,
        vendorLng: null,
        itemsSummary: null,
        computedSubtotal: null
      };
    const takeoutAmount = isTakeoutBooking
      ? (jrideTakeoutReceiptAmount(booking as any) ?? takeoutReceipt.computedSubtotal)
      : null;
    const rawPickupLat = n((booking as any).pickup_lat);
    const rawPickupLng = n((booking as any).pickup_lng);
    const rawDropoffLat = n((booking as any).dropoff_lat);
    const rawDropoffLng = n((booking as any).dropoff_lng);

    const hasVendorCoords = jrideIsPhilippinesCoordPair(takeoutReceipt.vendorLat, takeoutReceipt.vendorLng);
    const pickupLat = isTakeoutBooking && hasVendorCoords ? takeoutReceipt.vendorLat : rawPickupLat;
    const pickupLng = isTakeoutBooking && hasVendorCoords ? takeoutReceipt.vendorLng : rawPickupLng;
    const dropoffLat = rawDropoffLat;
    const dropoffLng = rawDropoffLng;

    const takeoutRoutePlan = s((booking as any).takeout_route_plan) ?? s((booking as any).route_plan);
    const cashCollectionRequired =
      (booking as any).takeout_cash_collection_required === true ||
      (booking as any).cash_collection_required === true ||
      takeoutRoutePlan === "customer_cash_first";
    const cashCollectionConfirmed =
      takeoutDriverStatus === "cash_collected" ||
      Boolean((booking as any).takeout_cash_collected_at) ||
      Boolean((booking as any).cash_collected_at) ||
      (booking as any).takeout_cash_collection_confirmed === true ||
      (booking as any).cash_collection_confirmed === true;
    const cashCollectionAddress =
      s((booking as any).delivery_pin_label) ??
      s((booking as any).to_label) ??
      s((booking as any).dropoff_label) ??
      "Passenger delivery location";
    const cashCollectionLat =
      n((booking as any).delivery_pin_lat) ??
      n((booking as any).dropoff_lat);
    const cashCollectionLng =
      n((booking as any).delivery_pin_lng) ??
      n((booking as any).dropoff_lng);

    let driverToPickupKm = n((booking as any).driver_to_pickup_km);
    if (isTakeoutBooking) {
      const hasDriverCoords = jrideIsPhilippinesCoordPair(driverLat, driverLng);
      const hasPickupCoords = jrideIsPhilippinesCoordPair(pickupLat, pickupLng);

      if (hasDriverCoords && hasPickupCoords) {
        driverToPickupKm = Number(haversineKm(driverLat as number, driverLng as number, pickupLat as number, pickupLng as number).toFixed(2));
      } else if (!jrideIsSaneTakeoutDistanceKm(driverToPickupKm)) {
        driverToPickupKm = null;
      }
    } else if (driverToPickupKm == null && driverLat != null && driverLng != null && pickupLat != null && pickupLng != null) {
      driverToPickupKm = Number(haversineKm(driverLat, driverLng, pickupLat, pickupLng).toFixed(1));
    }

    let tripDistanceKm = n((booking as any).trip_distance_km);
    if (isTakeoutBooking) {
      if (jrideIsPhilippinesCoordPair(pickupLat, pickupLng) && jrideIsPhilippinesCoordPair(dropoffLat, dropoffLng)) {
        tripDistanceKm = Number(haversineKm(pickupLat as number, pickupLng as number, dropoffLat as number, dropoffLng as number).toFixed(2));
      } else if (!jrideIsSaneTakeoutDistanceKm(tripDistanceKm)) {
        tripDistanceKm = null;
      }
    } else if (tripDistanceKm == null && pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null) {
      tripDistanceKm = Number(haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng).toFixed(2));
    }

    const storedPickupEtaMinutes = n((booking as any).pickup_eta_minutes) ?? n((booking as any).eta_minutes);
    const pickupEtaMinutes = isTakeoutBooking
      ? estimateEtaMinutes(driverToPickupKm) ?? (jrideIsSaneTakeoutDistanceKm(driverToPickupKm) ? storedPickupEtaMinutes : null)
      : storedPickupEtaMinutes ?? estimateEtaMinutes(driverToPickupKm);

    const proposedFare = n((booking as any).proposed_fare);
    const verifiedFare = n((booking as any).verified_fare);
    const submittedRegularFare = n((booking as any).submitted_regular_fare);
    const pickupDistanceFee = n((booking as any).pickup_distance_fee) ?? 0;
    const promoAppliedAmount = n((booking as any).promo_applied_amount) ?? 0;
    const promoStatus = s((booking as any).promo_status);
    const promoProgramCode = s((booking as any).promo_program_code);
    const platformFee = 15;

    const fare = verifiedFare ?? proposedFare;
    const subtotalBeforeDiscount =
      fare == null
        ? null
        : Number((fare + pickupDistanceFee + platformFee).toFixed(2));

    const payableTotal =
      subtotalBeforeDiscount == null
        ? null
        : Number(Math.max(0, subtotalBeforeDiscount - promoAppliedAmount).toFixed(2));

    const hints = deriveStageHints(normalizedStatus, fare != null);

    const takeoutPricingStatusForDriver = isTakeoutBooking ? jrideTakeoutPricingStatusForDriver(booking as any) : null;
    const takeoutDeliveryFeeForDriver = isTakeoutBooking ? jrideTakeoutDeliveryFeeForDriver(booking as any) : null;
    const takeoutConfirmedAtForDriver = isTakeoutBooking ? jrideTakeoutConfirmedAt(booking as any) : null;
    const takeoutTotalPayableForDriver = isTakeoutBooking ? jrideTakeoutTotalPayableForDriver(booking as any) : null;
    const takeoutPickupDistanceKmForDriver = isTakeoutBooking ? jrideTakeoutSnapshotNumber(booking as any, "takeout_pickup_distance_km") : null;
    const takeoutPickupFreeKmForDriver = isTakeoutBooking ? jrideTakeoutSnapshotNumber(booking as any, "takeout_pickup_free_km") : null;
    const takeoutPickupBillableExcessKmForDriver = isTakeoutBooking ? jrideTakeoutSnapshotNumber(booking as any, "takeout_pickup_billable_excess_km") : null;
    const takeoutPickupExcessUnits500mForDriver = isTakeoutBooking ? jrideTakeoutSnapshotNumber(booking as any, "takeout_pickup_excess_units_500m") : null;
    const takeoutPickupExcessFeePer500mForDriver = isTakeoutBooking ? jrideTakeoutSnapshotNumber(booking as any, "takeout_pickup_excess_fee_per_500m") : null;
    const takeoutPickupExcessFeeForDriver = isTakeoutBooking ? jrideTakeoutSnapshotNumber(booking as any, "takeout_pickup_excess_fee") : null;
    const takeoutPassengerConfirmedTotal = isTakeoutBooking && (
      takeoutPricingStatusForDriver === "customer_confirmed" ||
      takeoutPricingStatusForDriver === "confirmed" ||
      takeoutPricingStatusForDriver === "accepted" ||
      !!takeoutConfirmedAtForDriver
    );

    const trip = {
      id: booking.id,
      booking_id: booking.id,
      booking_code: booking.booking_code,
      code: booking.booking_code,
      status: normalizedStatus,
      lifecycle_locked: normalizedStatus === "cancelled" || normalizedStatus === "completed",
      service_type: isTakeoutBooking ? "takeout" : s((booking as any).service_type),
      serviceType: isTakeoutBooking ? "takeout" : s((booking as any).serviceType),
      takeout_status: takeoutDriverStatus,
      vendor_status: s((booking as any).vendor_status),
      customer_status: s((booking as any).customer_status),
      takeout_pricing_status: takeoutPricingStatusForDriver,
      pricing_status: takeoutPricingStatusForDriver,
      fee_status: takeoutPricingStatusForDriver,
      driver_fee_status: takeoutPricingStatusForDriver,
      takeout_customer_confirmed_at: takeoutConfirmedAtForDriver,
      customer_confirmed_at: takeoutConfirmedAtForDriver,
      passenger_confirmed_total: takeoutPassengerConfirmedTotal,
      takeout_delivery_fee: takeoutDeliveryFeeForDriver,
      driver_delivery_fee: takeoutDeliveryFeeForDriver,
      delivery_fee: takeoutDeliveryFeeForDriver,
      takeout_total_payable: takeoutTotalPayableForDriver,
      // JRIDE_TAKEOUT_PICKUP_EXCESS_DISPLAY_V3
      takeout_pickup_distance_km: takeoutPickupDistanceKmForDriver,
      takeout_pickup_free_km: takeoutPickupFreeKmForDriver,
      takeout_pickup_billable_excess_km: takeoutPickupBillableExcessKmForDriver,
      takeout_pickup_excess_units_500m: takeoutPickupExcessUnits500mForDriver,
      takeout_pickup_excess_fee_per_500m: takeoutPickupExcessFeePer500mForDriver,
      takeout_pickup_excess_fee: takeoutPickupExcessFeeForDriver,
      pickup_excess_fee: takeoutPickupExcessFeeForDriver,
      cash_collection_required: cashCollectionRequired,
      takeout_cash_collection_required: cashCollectionRequired,
      cash_collection_confirmed: cashCollectionConfirmed,
      takeout_cash_collection_confirmed: cashCollectionConfirmed,
      route_plan: takeoutRoutePlan,
      takeout_route_plan: takeoutRoutePlan,
      cash_collection_address: cashCollectionAddress,
      cash_collection_label: cashCollectionAddress,
      cash_collection_lat: cashCollectionLat,
      cash_collection_lng: cashCollectionLng,
      customer_cash_collection_address: cashCollectionAddress,
      customer_cash_collection_lat: cashCollectionLat,
      customer_cash_collection_lng: cashCollectionLng,
      vendor_id: s((booking as any).vendor_id),
      vendor_name: takeoutReceipt.vendorName ?? s((booking as any).vendor_name),
      restaurant_name: takeoutReceipt.vendorName ?? s((booking as any).restaurant_name),
      store_name: takeoutReceipt.vendorName ?? s((booking as any).store_name),
vendor_address: takeoutReceipt.vendorLocationLabel,
      items_summary: takeoutReceipt.itemsSummary ?? s((booking as any).items_summary),
      order_summary: takeoutReceipt.itemsSummary ?? s((booking as any).order_summary),
      // JRIDE_TAKEOUT_NOTE_CONTRACT_V1
      // Expose passenger note separately from system instructions.
      notes: jrideCleanTakeoutCustomerNote((booking as any).customer_note ?? (booking as any).passenger_note ?? (booking as any).notes),
      customer_note: jrideCleanTakeoutCustomerNote((booking as any).customer_note ?? (booking as any).passenger_note ?? (booking as any).notes),
      passenger_note: jrideCleanTakeoutCustomerNote((booking as any).customer_note ?? (booking as any).passenger_note ?? (booking as any).notes),
      system_instructions: jrideTakeoutSystemInstructions(booking as any, cashCollectionRequired),
      takeout_receipt_requested: Boolean((booking as any).receipt_requested ?? (booking as any).request_vendor_receipt ?? (booking as any).takeout_pricing_snapshot?.receipt_requested ?? false),
      receipt_requested: Boolean((booking as any).receipt_requested ?? (booking as any).request_vendor_receipt ?? (booking as any).takeout_pricing_snapshot?.receipt_requested ?? false),
      request_vendor_receipt: Boolean((booking as any).request_vendor_receipt ?? (booking as any).receipt_requested ?? (booking as any).takeout_pricing_snapshot?.receipt_requested ?? false),
      order_total: takeoutAmount,
      food_total: takeoutAmount,
      takeout_items_subtotal: takeoutAmount,
      town: s((booking as any).town),
      from_label: s((booking as any).from_label),
      to_label: s((booking as any).to_label),
      pickup_label: isTakeoutBooking ? (takeoutReceipt.vendorName ?? takeoutReceipt.vendorLocationLabel ?? s((booking as any).from_label)) : s((booking as any).from_label),
      pickup_address_label: isTakeoutBooking ? (takeoutReceipt.vendorLocationLabel ?? s((booking as any).from_label)) : s((booking as any).from_label),
      pickup_store_name: isTakeoutBooking ? (takeoutReceipt.vendorName ?? null) : null,
      dropoff_label: s((booking as any).to_label),
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,
      passenger_name: s((booking as any).passenger_name),
      passenger_phone: passengerPhone,
      customer_phone: passengerPhone,
      phone: passengerPhone,
      contact_phone: passengerPhone,
      passenger_count: n((booking as any).passenger_count),
      driver_id: s((booking as any).driver_id) ?? driverId,
      assigned_driver_id: s((booking as any).assigned_driver_id) ?? driverId,
      driver_name: driverName,
      driver_phone: driverPhone,
      driver_lat: driverLat,
      driver_lng: driverLng,
      driver_to_pickup_km: driverToPickupKm,
      distance_to_pickup_km: driverToPickupKm,
      pickup_distance_km: driverToPickupKm,
      distance_to_pickup: driverToPickupKm,
      trip_distance_km: tripDistanceKm,
      pickup_eta_minutes: pickupEtaMinutes,
      eta_minutes: pickupEtaMinutes,
      eta_to_pickup_minutes: pickupEtaMinutes,
      pickup_eta: pickupEtaMinutes,
      proposed_fare: proposedFare,
      verified_fare: verifiedFare,
      submitted_regular_fare: submittedRegularFare,
      fare,
      pickup_distance_fee: pickupDistanceFee,
      platform_fee: platformFee,
      promo_applied_amount: promoAppliedAmount,
      promo_status: promoStatus,
      promo_program_code: promoProgramCode,
      subtotal_before_discount: subtotalBeforeDiscount,
      payable_total: payableTotal,
      total_fare: payableTotal,
      total_amount: payableTotal,
      grand_total: payableTotal,
      fare_ready: hints.fare_ready,
      pickup_metrics_ready: hints.pickup_metrics_ready,
      waiting_for_driver_proposal: hints.waiting_for_driver_proposal,
      passenger_fare_response: s((booking as any).passenger_fare_response),
      created_at: s((booking as any).created_at),
      updated_at: s((booking as any).updated_at),
      completed_at: s((booking as any).completed_at),
      cancelled_at: s((booking as any).cancelled_at),
    };

    const shapedTrip = jrideShapeActiveTripForDriver(trip);
    return NextResponse.json(
      {
        ok: true,
        trip: shapedTrip,
        active_trip: shapedTrip,
        auth_mode: authMode,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "ACTIVE_TRIP_ROUTE_CRASH", details: err?.message ?? "UNKNOWN_ERROR" },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}













