import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const DEFAULT_ONLINE_WINDOW_MIN = 10; // fallback if not provided in body

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<{
      pickup_lat: number;
      pickup_lng: number;
      freshness_mins: number;
    }>;

    const pickup_lat = body.pickup_lat;
    const pickup_lng = body.pickup_lng;
    const freshness_mins =
      typeof body.freshness_mins === "number" && !Number.isNaN(body.freshness_mins)
        ? body.freshness_mins
        : DEFAULT_ONLINE_WINDOW_MIN;

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

    const sinceISO = new Date(Date.now() - freshness_mins * 60_000).toISOString();

    const supabase = supabaseAdmin();

    // Query available drivers with recent location
    const { data: rows, error } = await supabase
      .from("driver_locations")
      .select("driver_id, lat, lng, updated_at, drivers!inner(id, name, town, is_available)")
      .gte("updated_at", sinceISO)
      .eq("drivers.is_available", true);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No available drivers online." }, { status: 404 });
    }

    // Pick nearest via Haversine
    const best = rows
      .map((r) => ({
        ...r,
        distance_km: haversineKm(pickup_lat, pickup_lng, r.lat, r.lng),
      }))
      .sort((a, b) => a.distance_km - b.distance_km)[0];

    // TODO: perform actual DB assignment (insert ride + mark driver busy) if desired
    return NextResponse.json(
      {
        assigned_driver_id: best.driver_id,
        distance_km: Number(best.distance_km.toFixed(3)),
        driver: best.drivers,
        location: { lat: best.lat, lng: best.lng, updated_at: best.updated_at },
        window_minutes: freshness_mins,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
