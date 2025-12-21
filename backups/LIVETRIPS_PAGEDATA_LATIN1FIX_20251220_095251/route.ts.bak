import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


function sanitizeText(v: any) {
  if (v == null) return v;
  let s = String(v);

  // Common mojibake / double-encoded UTF-8 sequences (best-effort)
  // Replace broken dashes/ellipsis/quotes that often appear as Ã¢â‚¬â„¢ etc.
  s = s
    .replace(/Ã¢â‚¬â€�/g, '"')
    .replace(/Ã¢â‚¬Å“/g, '"')
    .replace(/Ã¢â‚¬â„¢/g, "'")
    .replace(/Ã¢â‚¬â€œ/g, "-")
    .replace(/Ã¢â‚¬â€�/g, "-")
    .replace(/Ã¢â‚¬Â¦/g, "...")
    .replace(/Ã¢â‚¬â€?/g, "-");

  // Single-layer mojibake
  s = s
    .replace(/â€”/g, "-")
    .replace(/â€“/g, "-")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€�/g, '"')
    .replace(/â€¦/g, "...");

  // Real unicode dashes -> ASCII
  s = s.replace(/[—–]/g, "-");

  return s;
}export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

const LIVE_STATUSES = ["pending", "assigned", "on_the_way", "on_trip"];

export async function GET(req: NextRequest) {
  const sb = supabaseAdmin();

  const debug = req.nextUrl.searchParams.get("debug") === "1";

  // 1) Trips (bypass RPC, bypass RLS)
  const { data: trips, error: tripsError } = await sb
    .from("bookings")
    .select(
      [
        "id",
        "booking_code",
        "status",
        "town",
        "zone_id",
        "driver_id",
        "assigned_driver_id",
        "passenger_name",
        "from_label",
        "to_label",
        "pickup_lat",
        "pickup_lng",
        "dropoff_lat",
        "dropoff_lng",
        "created_at",
        "updated_at",
        "base_fee",
        "company_cut",
        "driver_payout",
        "vendor_id",
        "service_type",
        "trip_type",
        "customer_status",
      ].join(",")
    )
    .in("status", LIVE_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(300);

  if (tripsError) {
    console.error("[page-data] trips query error", tripsError);
    return NextResponse.json(sanitizeDeep({ error: tripsError.message }), { status: 500 });
  }


function sanitizeDeep(obj: any): any {
  if (obj == null) return obj;
  if (typeof obj === "string") return sanitizeText(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeDeep);
  if (typeof obj === "object") {
    const out: any = {};
    for (const k of Object.keys(obj)) out[k] = sanitizeDeep((obj as any)[k]);
    return out;
  }
  return obj;
}
  // 2) Zones workload (keep as-is, but also bypass RLS)
  const { data: zones, error: zonesError } = await sb
    .from("zone_capacity_view")
    .select("zone_id, zone_name, color_hex, capacity_limit, active_drivers, available_slots, status")
    .order("zone_name");

  if (zonesError) {
    console.error("[page-data] zone capacity error", zonesError);
    return NextResponse.json(sanitizeDeep({ error: zonesError.message }), { status: 500 });
  }

  return NextResponse.json(sanitizeDeep({
      trips: trips ?? [],
      zones: zones ?? [],
      ...(debug
        ? {
            debug: {
              liveStatuses: LIVE_STATUSES,
              tripCount: trips?.length ?? 0,
            },
          }
        : {}),
    }),
    { status: 200 }
  );
}