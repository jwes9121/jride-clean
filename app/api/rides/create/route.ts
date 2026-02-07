import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const { pickup_lat, pickup_lng, town = "Lagawe" } = await req.json();

    if (typeof pickup_lat !== "number" || typeof pickup_lng !== "number") {
      return NextResponse.json({ error: "pickup_lat and pickup_lng required" }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from("rides")
      .insert({ pickup_lat, pickup_lng, town, status: "pending" })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, rideId: data.id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

