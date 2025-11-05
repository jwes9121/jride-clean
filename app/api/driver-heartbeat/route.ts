import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(url, key, { auth: { persistSession: false } });

export async function POST(req: NextRequest) {
  try {
    const { driverId, lat, lng, isAvailable = true } = await req.json();

    if (!driverId || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "driverId, lat, lng required" }, { status: 400 });
    }

    // Upsert into driver_locations (expects FK to public.drivers(id))
    const { error } = await supabase
      .from("driver_locations")
      .upsert(
        { driver_id: driverId, lat, lng, is_available: !!isAvailable, last_seen: new Date().toISOString() },
        { onConflict: "driver_id" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ status: "ok" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
