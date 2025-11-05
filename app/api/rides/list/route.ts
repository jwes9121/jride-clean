import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(url, key, { auth: { persistSession: false } });

export async function GET() {
  // Select only columns we know exist in your schema
  const { data, error } = await supabase
    .from("rides")
    .select(
      "id, status, pickup_lat, pickup_lng, town, created_at, driver_id, vehicle_type"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
