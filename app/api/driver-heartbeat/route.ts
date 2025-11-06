import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const { driver_id, lat, lng, is_available = true } = await req.json();
    if (!driver_id || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "driver_id, lat, lng required" }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from("driver_locations")
      .upsert(
        { driver_id, lat, lng, is_available, last_seen: new Date().toISOString() },
        { onConflict: "driver_id" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
