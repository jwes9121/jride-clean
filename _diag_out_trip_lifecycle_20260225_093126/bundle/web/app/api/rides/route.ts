import { NextResponse } from "next/server";
function asNum(v: any): number | null {
  const n = typeof v === "number" ? v : (typeof v === "string" ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

// Ifugao bounding box (server-side hard gate).
const IFUGAO_LAT_MIN = 16.60;
const IFUGAO_LAT_MAX = 17.25;
const IFUGAO_LNG_MIN = 120.70;
const IFUGAO_LNG_MAX = 121.35;

function insideIfugao(latAny: any, lngAny: any): boolean {
  const lat = asNum(latAny);
  const lng = asNum(lngAny);
  if (lat == null || lng == null) return false;
  return lat >= IFUGAO_LAT_MIN && lat <= IFUGAO_LAT_MAX && lng >= IFUGAO_LNG_MIN && lng <= IFUGAO_LNG_MAX;
}

function json403(code: string, message: string) {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * POST /api/rides
 * Body: { passenger_id?: string, pickup_lat: number, pickup_lng: number, destination_lat?: number, destination_lng?: number, meta?: any }
 * Returns: { id }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
  // ===== JRIDE_GEO_ENFORCE_IFUGAO_BEGIN =====
  // Server-authoritative: block ride creation outside Ifugao.
  const __latAny = (body as any)?.pickup_lat ?? (body as any)?.pickupLat;
  const __lngAny = (body as any)?.pickup_lng ?? (body as any)?.pickupLng;
  if (!insideIfugao(__latAny, __lngAny)) {
    return json403("OUTSIDE_IFUGAO", "Booking is only available inside Ifugao.");
  }
  // ===== JRIDE_GEO_ENFORCE_IFUGAO_END =====

    const {
      passenger_id = null,
      pickup_lat,
      pickup_lng,
      destination_lat = null,
      destination_lng = null,
      meta = null,
    } = body as {
      passenger_id?: string | null;
      pickup_lat: number;
      pickup_lng: number;
      destination_lat?: number | null;
      destination_lng?: number | null;
      meta?: any;
    };

    if (
      typeof pickup_lat !== "number" ||
      typeof pickup_lng !== "number" ||
      Number.isNaN(pickup_lat) ||
      Number.isNaN(pickup_lng)
    ) {
      return NextResponse.json(
        { error: "pickup_lat and pickup_lng are required numbers" },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    const insert = {
      passenger_id,
      pickup_lat,
      pickup_lng,
      destination_lat,
      destination_lng,
      status: "pending",          // adjust to your enum if needed
      meta,
    };

    const { data, error } = await supabase
      .from("rides")
      .insert(insert)
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
