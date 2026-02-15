import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

export const revalidate = 0;

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function pick(obj: any, keys: string[]) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = (obj as any)[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") return v;
    }
  }
  return undefined;
}

function extractTripsAnyShape(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  if (typeof payload === "object") {
    const t1 = (payload as any).trips;
    if (Array.isArray(t1)) return t1;

    const t2 = (payload as any).bookings;
    if (Array.isArray(t2)) return t2;

    const t3 = (payload as any).data;
    if (Array.isArray(t3)) return t3;

    const keys = Object.keys(payload)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length) return keys.map((k) => (payload as any)[k]).filter(Boolean);
  }

  return [];
}

export async function GET(req: Request) {
  try {
  // Force service-role client here to avoid RLS silently returning empty trips in production.
  const sbUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const sbServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  const using_service_role = Boolean(sbUrl && sbServiceKey);

  const supabase = createClient(
    sbUrl,
    (sbServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || ""),
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }
  );
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    
    const forceCode = (url.searchParams.get("code") || "").trim();
const { data: rpcData, error: rpcErr } =     // AUTO: ?code= bypass to fetch a single booking for diagnosis
    if (forceCode) {
      const probe = await supabase
        .from("bookings")
        .select("*")
        .eq("booking_code", forceCode)
        .limit(1);

      const row = (probe as any)?.data?.[0] ?? null;

      return ok({
        trips: row ? [row] : [],
        __debug: debug ? {
          injected_active_statuses: ACTIVE_STATUSES,
          using_service_role: (typeof using_service_role !== "undefined") ? using_service_role : null,
          has_SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
          has_SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
          code: forceCode,
          probe_error: (probe as any)?.error ? (((probe as any).error as any)?.message || String((probe as any).error)) : null
        } : undefined
      });
    }
await supabase.rpc(
      "admin_get_live_trips_page_data_v2"
    );

    if (rpcErr) {
      console.error("LIVETRIPS_RPC_ERROR", rpcErr);
      return bad("LiveTrips RPC failed", "LIVETRIPS_RPC_ERROR", 500, {
        details: rpcErr.message,
      });
    }

    const trips = extractTripsAnyShape(rpcData);

    const existingCodes = new Set(
      trips
        .map((t: any) => pick(t, ["booking_code", "bookingCode", "code"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );

    const existingIds = new Set(
      trips
        .map((t: any) => pick(t, ["id", "uuid", "booking_id", "bookingId"]))
        .map((v: any) => (v ? String(v).trim() : ""))
        .filter(Boolean)
    );

    const ACTIVE_STATUSES = ["requested", "pending", "ready", "assigned", "on_the_way", "arrived", "enroute", "on_trip"]; /* PHASE3C2_INCLUDE_REQUESTED_ACTIVE_STATUSES */

    try {
      const { data: activeRows, error: activeErr } = await supabase
        .from("bookings")
        .select("*, proposed_fare, verified_fare, pickup_distance_fee, platform_service_fee, total_to_pay")
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(250);

      

      // Debug visibility (safe)
      if (debug) {
        (debug as any).active_rows_count = Array.isArray(activeRows) ? activeRows.length : 0;
        (debug as any).active_error = activeErr ? ((activeErr as any)?.message || String(activeErr)) : null;
      }
if (activeErr) {
        console.error("LIVETRIPS_FALLBACK_ACTIVE_ERROR", activeErr);
      } else if (Array.isArray(activeRows) && activeRows.length) {
        for (const b of activeRows as any[]) {
          const bid = b?.id != null ? String(b.id) : "";
          const bcode = b?.booking_code != null ? String(b.booking_code) : "";

          if ((bid && existingIds.has(bid)) || (bcode && existingCodes.has(bcode))) continue;

          trips.push({
            id: bid || null,
            uuid: bid || null,
            booking_id: bid || null,
            booking_code: bcode || null,
            status: b?.status ?? null,
            town: b?.town ?? null,
            zone: b?.town ?? null,
            driver_id: b?.driver_id ?? (b as any)?.assigned_driver_id ?? null,

            pickup_lat: b?.pickup_lat ?? null,
            pickup_lng: b?.pickup_lng ?? null,
            dropoff_lat: b?.dropoff_lat ?? null,
            dropoff_lng: b?.dropoff_lng ?? null,
            pickup_label: b?.pickup_label ?? b?.from_label ?? null,
            dropoff_label: b?.dropoff_label ?? b?.to_label ?? null,

            created_at: b?.created_at ?? null,
            updated_at: b?.updated_at ?? null,

            trip_type: b?.trip_type ?? null,
            vendor_id: b?.vendor_id ?? null,

            // ===== STEP5D_FALLBACK_EMERGENCY =====
            is_emergency: (b as any)?.is_emergency ?? (b as any)?.isEmergency ?? null,
            pickup_distance_km:
              (b as any)?.pickup_distance_km ??
              (b as any)?.pickupDistanceKm ??
              (b as any)?.pickup_distance ??
              (b as any)?.pickupDistance ??
              null,
            emergency_pickup_fee_php:
              (b as any)?.emergency_pickup_fee_php ??
              (b as any)?.emergencyPickupFeePhp ??
              (b as any)?.pickup_distance_fee ??
              (b as any)?.pickup_distance_fee_php ??
              null,
            // ===== END STEP5D_FALLBACK_EMERGENCY =====
            __fallback_injected: true,
          });

          if (bid) existingIds.add(bid);
          if (bcode) existingCodes.add(bcode);
        }
      }
    } catch (e: any) {
      console.error("LIVETRIPS_FALLBACK_ACTIVE_EXCEPTION", e?.message || e);
    }
  const tripsOut = (Array.isArray(trips) ? trips : []).map((t: any) => ({
    // ===== STEP5D_TRIPSOUT_EMERGENCY =====
    is_emergency: Boolean(
      (t as any)?.is_emergency ??
      (t as any)?.isEmergency ??
      false
    ),
    pickup_distance_km:
      (t as any)?.pickup_distance_km ??
      (t as any)?.pickupDistanceKm ??
      (t as any)?.pickup_distance ??
      (t as any)?.pickupDistance ??
      (t as any)?.driver_to_pickup_km ??
      null,
    emergency_pickup_fee_php:
      (t as any)?.emergency_pickup_fee_php ??
      (t as any)?.emergencyPickupFeePhp ??
      (t as any)?.pickup_distance_fee ??
      (t as any)?.pickup_distance_fee_php ??
      null,
    // ===== END STEP5D_TRIPSOUT_EMERGENCY =====

    ...t,
    suggested_verified_fare:
      (t as any)?.suggested_verified_fare ??
      (t as any)?.suggestedVerifiedFare ??
      (t as any)?.verified_suggested_fare ??
      (t as any)?.fare_suggested_verified ??
      (t as any)?.suggested_fare_verified ??
      (t as any)?.suggested_fare ??
      null,
  }));

  const payload =
      rpcData && typeof rpcData === "object" && !Array.isArray(rpcData)
        ? { ...(rpcData as any), trips: tripsOut, __debug: debug ? { injected_active_statuses: ACTIVE_STATUSES, using_service_role: (typeof using_service_role !== "undefined") ? using_service_role : null, has_SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL), has_SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) } : undefined }
        : { trips: tripsOut, __debug: debug ? { injected_active_statuses: ACTIVE_STATUSES } : undefined };

    return ok(payload);
  } catch (err: any) {
    console.error("LIVETRIPS_PAGE_DATA_UNEXPECTED_ERROR", err);
    return bad(
      "Unexpected error in LiveTrips page-data route",
      "LIVETRIPS_PAGE_DATA_UNEXPECTED_ERROR",
      500,
      { details: err?.message ?? String(err) }
    );
  }
}
