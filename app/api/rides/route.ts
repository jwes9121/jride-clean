import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Body = {
  pickup_lat: number;
  pickup_lng: number;
  dest_lat?: number | null;
  dest_lng?: number | null;
  town_hint?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    if (typeof body.pickup_lat !== "number" || typeof body.pickup_lng !== "number") {
      return NextResponse.json({ error: "Invalid pickup coords" }, { status: 400 });
    }

    const insert = {
      pickup_lat: body.pickup_lat,
      pickup_lng: body.pickup_lng,
      dest_lat: body.dest_lat ?? null,
      dest_lng: body.dest_lng ?? null,
      town_hint: body.town_hint ?? null,
      status: "pending",
      assigned_driver_id: null as string | null,
    };

    const { data, error } = await supabaseAdmin.from("rides").insert(insert).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}