import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(url, key, { auth: { persistSession: false } });

export async function GET() {
  const { data, error } = await supabase
    .from("driver_locations")
    .select("driver_id, lat, lng, is_available")
    .order("last_seen", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const fc = {
    type: "FeatureCollection" as const,
    features: (data || []).map((d) => ({
      type: "Feature" as const,
      properties: { driver_id: d.driver_id, is_available: d.is_available },
      geometry: { type: "Point" as const, coordinates: [d.lng, d.lat] as [number, number] },
    })),
  };

  return NextResponse.json(fc);
}
