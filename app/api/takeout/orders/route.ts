import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(v: any): string {
  return String(v ?? "").trim();
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

const TAKEOUT_ORDER_SELECT = [
  "id",
  "booking_code",
  "service_type",
  "vendor_id",
  "vendor_status",
  "customer_status",
  "assigned_driver_id",
  "driver_id",
  "takeout_pricing_status",
  "takeout_delivery_fee",
  "takeout_service_fee",
  "takeout_total_payable",
  "takeout_cash_collection_required",
  "takeout_fee_proposed_by_driver_id",
  "takeout_fee_proposed_at",
  "takeout_fee_expires_at",
  "takeout_customer_confirmed_at",
  "takeout_items_subtotal",
  "cancel_reason",
  "vendor_cancel_reason",
  "takeout_route_plan",
  "takeout_pricing_snapshot",
  "pickup_lat",
  "pickup_lng",
  "dropoff_lat",
  "dropoff_lng",
  "created_at",
  "updated_at",
].join(",");


function obj(v: any): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, any>;
}

function firstValue(...values: any[]): any {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

const VENDOR_ACCEPT_WINDOW_MS = 5 * 60 * 1000;
const VENDOR_ACCEPT_TIMEOUT_REASON = "Vendor did not respond within 5 minutes";

function vendorAcceptDeadlineMs(row: any): number | null {
  const raw = text(row?.created_at);
  if (!raw) return null;
  const createdMs = new Date(raw).getTime();
  if (!Number.isFinite(createdMs)) return null;
  return createdMs + VENDOR_ACCEPT_WINDOW_MS;
}

function vendorAcceptExpiresAt(row: any): string | null {
  const deadlineMs = vendorAcceptDeadlineMs(row);
  return deadlineMs === null ? null : new Date(deadlineMs).toISOString();
}

function vendorAcceptExpired(row: any, nowMs = Date.now()): boolean {
  const vendorStatus = text(row?.vendor_status || row?.status || "vendor_pending").toLowerCase();
  const normalized = vendorStatus === "requested" || vendorStatus === "" ? "vendor_pending" : vendorStatus;
  if (normalized !== "vendor_pending") return false;
  const deadlineMs = vendorAcceptDeadlineMs(row);
  return deadlineMs !== null && nowMs >= deadlineMs;
}

function exposePickupBreakdown(row: any): any {
  const snap = obj(row?.takeout_pricing_snapshot);
  const pickupDistanceKm = firstValue(
    row?.takeout_pickup_distance_km,
    row?.pickup_distance_km,
    snap.takeout_pickup_distance_km,
    snap.takeout_pickup_distance_km_road,
    snap.pickup_distance_km,
    snap.pickup_distance_km_road
  );
  const pickupFreeKm = firstValue(
    row?.takeout_pickup_free_km,
    row?.pickup_free_km,
    snap.takeout_pickup_free_km,
    snap.pickup_free_km
  );
  const pickupBillableKm = firstValue(
    row?.takeout_pickup_billable_excess_km,
    row?.pickup_billable_excess_km,
    snap.takeout_pickup_billable_excess_km,
    snap.pickup_billable_excess_km,
    snap.pickup_billable_km
  );
  const pickupFirstTierKm = firstValue(
    row?.takeout_pickup_first_tier_km,
    row?.pickup_first_tier_km,
    snap.takeout_pickup_first_tier_km,
    snap.pickup_first_tier_km
  );
  const pickupSecondTierKm = firstValue(
    row?.takeout_pickup_second_tier_km,
    row?.pickup_second_tier_km,
    snap.takeout_pickup_second_tier_km,
    snap.pickup_second_tier_km,
    snap.takeout_pickup_beyond_first_tier_km,
    snap.pickup_beyond_first_tier_km
  );
  const pickupFee = firstValue(
    row?.takeout_pickup_distance_fee,
    row?.pickup_distance_fee,
    row?.takeout_pickup_excess_fee,
    row?.pickup_excess_fee,
    snap.takeout_pickup_distance_fee,
    snap.pickup_distance_fee,
    snap.takeout_pickup_excess_fee,
    snap.pickup_excess_fee
  );
  const pickupSource = firstValue(
    row?.takeout_pickup_distance_source,
    row?.pickup_distance_source,
    snap.takeout_pickup_distance_source,
    snap.pickup_distance_source
  );

  return {
    ...row,
    takeout_pickup_distance_km: pickupDistanceKm,
    takeout_pickup_distance_km_road: firstValue(row?.takeout_pickup_distance_km_road, snap.takeout_pickup_distance_km_road, pickupDistanceKm),
    takeout_pickup_free_km: pickupFreeKm,
    takeout_pickup_billable_excess_km: pickupBillableKm,
    takeout_pickup_first_tier_km: pickupFirstTierKm,
    takeout_pickup_second_tier_km: pickupSecondTierKm,
    takeout_pickup_distance_fee: pickupFee,
    takeout_pickup_excess_fee: pickupFee,
    takeout_pickup_distance_source: pickupSource,
    pickup_distance_source: pickupSource,
    pickup_first_tier_km: pickupFirstTierKm,
    pickup_second_tier_km: pickupSecondTierKm,
  };
}

export async function GET(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const url = new URL(req.url);
    const orderId = text(url.searchParams.get("order_id") || url.searchParams.get("orderId") || url.searchParams.get("booking_id") || url.searchParams.get("bookingId") || url.searchParams.get("id"));
    const bookingCode = text(url.searchParams.get("booking_code") || url.searchParams.get("bookingCode") || url.searchParams.get("code"));

    let q = serviceSupabase
      .from("bookings")
      .select(TAKEOUT_ORDER_SELECT)
      .eq("service_type", "takeout")
      .order("created_at", { ascending: false })
      .limit(10);

    if (orderId) {
      q = q.eq("id", orderId).limit(1);
    } else if (bookingCode) {
      q = q.eq("booking_code", bookingCode).limit(1);
    }

    const res = await q;
    if (res.error) {
      return json(500, {
        ok: false,
        error: "TAKEOUT_ORDERS_QUERY_FAILED",
        message: res.error.message,
      });
    }

    let rawRows = Array.isArray(res.data) ? res.data : [];
    const expiredIds = rawRows
      .filter((row: any) => vendorAcceptExpired(row))
      .map((row: any) => text(row?.id))
      .filter(Boolean);

    if (expiredIds.length) {
      const expiredPatch: any = {
        vendor_status: "vendor_timeout",
        customer_status: "vendor_timeout",
        status: "cancelled",
        cancel_reason: VENDOR_ACCEPT_TIMEOUT_REASON,
        vendor_cancel_reason: VENDOR_ACCEPT_TIMEOUT_REASON,
      };

      const expiredUpdate = await serviceSupabase
        .from("bookings")
        .update(expiredPatch)
        .in("id", expiredIds)
        .eq("service_type", "takeout");

      if (!expiredUpdate.error) {
        const expiredSet = new Set(expiredIds);
        rawRows = rawRows.map((row: any) =>
          expiredSet.has(text(row?.id))
            ? { ...row, ...expiredPatch, updated_at: new Date().toISOString() }
            : row
        );
      }
    }

    const orders = rawRows.map((row: any) =>
      exposePickupBreakdown({
        ...row,
        vendor_accept_expires_at: vendorAcceptExpiresAt(row),
        vendor_accept_expired: vendorAcceptExpired(row),
      })
    );
    const assignedDriverIds = Array.from(new Set(
      orders
        .map((row: any) => text(row?.assigned_driver_id || row?.driver_id))
        .filter(Boolean)
    ));

    const driverProfileById: Record<string, any> = {};
    const driverLocationById: Record<string, any> = {};
    const driverRatingById: Record<string, { average: number | null; count: number }> = {};

    if (assignedDriverIds.length > 0) {
      const profileRes = await serviceSupabase
        .from("driver_profiles")
        .select("driver_id,full_name,callsign,phone,photo_url")
        .in("driver_id", assignedDriverIds);

      if (!profileRes.error && Array.isArray(profileRes.data)) {
        for (const row of profileRes.data as any[]) {
          const id = text(row?.driver_id);
          if (id) driverProfileById[id] = row;
        }
      }

      const locationRes = await serviceSupabase
        .from("driver_locations")
        .select("driver_id,vehicle_type,updated_at,lat,lng")
        .in("driver_id", assignedDriverIds)
        .order("updated_at", { ascending: false });

      if (!locationRes.error && Array.isArray(locationRes.data)) {
        for (const row of locationRes.data as any[]) {
          const id = text(row?.driver_id);
          if (id && !driverLocationById[id]) driverLocationById[id] = row;
        }
      const ratingRes = await serviceSupabase
        .from("takeout_ratings")
        .select("driver_id,driver_rating")
        .in("driver_id", assignedDriverIds);

      if (!ratingRes.error && Array.isArray(ratingRes.data)) {
        const buckets: Record<string, number[]> = {};

        for (const row of ratingRes.data as any[]) {
          const id = text(row?.driver_id);
          const rating = Number(row?.driver_rating || 0);
          if (!id || !Number.isFinite(rating) || rating <= 0) continue;
          if (!buckets[id]) buckets[id] = [];
          buckets[id].push(rating);
        }

        for (const [id, ratings] of Object.entries(buckets)) {
          driverRatingById[id] = {
            count: ratings.length,
            average: Number(
              (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2)
            ),
          };
        }
      }
      }
    }

    const enrichedOrders = orders.map((row: any) => {
      const driverId = text(row?.assigned_driver_id || row?.driver_id);
      const profile = driverId ? driverProfileById[driverId] : null;
      const location = driverId ? driverLocationById[driverId] : null;
      const rating = driverId ? driverRatingById[driverId] : null;
      const driverName = text(row?.driver_name || profile?.full_name || profile?.callsign);
      const driverPhone = text(row?.driver_phone || profile?.phone);
      const driverCallsign = text(row?.driver_callsign || profile?.callsign);
      const driverPhotoUrl = text(row?.driver_photo_url || profile?.photo_url);
      const driverVehicleType = text(row?.driver_vehicle_type || row?.vehicle_type || location?.vehicle_type);

      return {
        ...row,
        assigned_driver_id: driverId || row?.assigned_driver_id || null,
        driver_id: driverId || row?.driver_id || null,
        driver_name: driverName || null,
        driver_phone: driverPhone || null,
	driver_photo_url: driverPhotoUrl || null,
	driver_average_rating: rating?.average ?? null,
        driver_ratings_count: rating?.count ?? 0,
        driver_callsign: driverCallsign || null,
        driver_vehicle_type: driverVehicleType || null,
        vehicle_type: driverVehicleType || row?.vehicle_type || null,
        driver_lat: location?.lat != null && Number.isFinite(Number(location.lat)) ? Number(location.lat) : null,
        driver_lng: location?.lng != null && Number.isFinite(Number(location.lng)) ? Number(location.lng) : null,
        driver_last_seen_at: location?.updated_at || null,

        vendor_lat: row?.pickup_lat != null && Number.isFinite(Number(row.pickup_lat)) ? Number(row.pickup_lat) : null,
        vendor_lng: row?.pickup_lng != null && Number.isFinite(Number(row.pickup_lng)) ? Number(row.pickup_lng) : null,
        customer_lat: row?.dropoff_lat != null && Number.isFinite(Number(row.dropoff_lat)) ? Number(row.dropoff_lat) : null,
        customer_lng: row?.dropoff_lng != null && Number.isFinite(Number(row.dropoff_lng)) ? Number(row.dropoff_lng) : null,
      };
    });

    const order = enrichedOrders[0] || null;

    return json(200, {
      ok: true,
      order,
      orders: enrichedOrders,
      guard: "takeout_orders_read_v2_no_bookings_device_key_no_total_bill_no_ride_fare_no_wallet",
    });
  } catch (err: any) {
    return json(500, {
      ok: false,
      error: "TAKEOUT_ORDERS_READ_FAILED",
      message: err?.message || "Failed to read takeout orders.",
    });
  }
}


