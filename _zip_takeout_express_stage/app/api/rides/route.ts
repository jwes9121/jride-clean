import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * POST /api/rides
 * Body: { passenger_id?: string, pickup_lat: number, pickup_lng: number, destination_lat?: number, destination_lng?: number, meta?: any }
 * Returns: { id }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
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
