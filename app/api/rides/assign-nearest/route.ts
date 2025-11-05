import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// How far back to consider a driver "recently online"
const ONLINE_WINDOW_MINUTES = 10;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { pickup_lat, pickup_lng } = body as {
      pickup_lat: number;
      pickup_lng: number;
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

    const sinceISO = new Date(
      Date.now() - ONLINE_WINDOW_MINUTES * 60 * 1000
    ).toISOString();

    const supabase = supabaseAdmin();

    // 1) Get recently updated, available drivers with their latest location
    const { data: rows, error } = await supabase
      .from("driver_locations")
      .select(
        "driver_id, lat, lng, updated_at, drivers!inner(id, name, town, is_available)"
      )
      .gte("updated_at", sinceISO)
      .eq("drivers.is_available", true);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: "No available drivers online." },
        { status: 404 }
      );
    }

    // 2) Compute nearest by simple haversine
    const nearest = rows
      .map((r) => ({
        ...r,
        distance_km: haversineKm(pickup_lat, pickup_lng, r.lat, r.lng),
      }))
      .sort((a, b) => a.distance_km - b.distance_km)[0];

    // TODO: your actual assignment logic here (insert into rides, etc.)
    // For now, just return the selected driver
    return NextResponse.json(
      {
        assigned_driver_id: nearest.driver_id,
        distance_km: Number(nearest.distance_km.toFixed(3)),
        driver: nearest.drivers,
        location: { lat: nearest.lat, lng: nearest.lng, updated_at: nearest.updated_at },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

// Small, standalone haversine helper
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
