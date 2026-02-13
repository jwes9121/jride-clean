// app/api/rides/save-assign/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,  // server-only
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // 1) Create the ride first (same validation)
    const required = ["pickup_lat", "pickup_lng"];
    for (const key of required) {
      if (body[key] === undefined || body[key] === null) {
        return NextResponse.json({ error: `Missing ${key}` }, { status: 400 });
      }
    }

    const rideInsert = {
      passenger_name: body.passenger_name ?? null,
      passenger_phone: body.passenger_phone ?? null,
      pickup_address: body.pickup_address ?? null,
      pickup_lat: Number(body.pickup_lat),
      pickup_lng: Number(body.pickup_lng),
      destination_address: body.destination_address ?? null,
      destination_lat: body.destination_lat != null ? Number(body.destination_lat) : null,
      destination_lng: body.destination_lng != null ? Number(body.destination_lng) : null,
      town_hint: body.town_hint ?? null,
      status: "new" as const,
    };

    const { data: ride, error: insertErr } = await supabase
      .from("rides")
      .insert(rideInsert)
      .select("*")
      .single();

    if (insertErr || !ride) {
      return NextResponse.json({ error: insertErr?.message ?? "Insert failed" }, { status: 500 });
    }

    // 2) Assign nearest (server-side RPC)
    const maxKm = body.max_km != null ? Number(body.max_km) : 5;
    const freshness = body.freshness_mins != null ? Number(body.freshness_mins) : 5;

    const { data: assigned, error: rpcErr } = await supabase
      .rpc("assign_nearest_driver_to_ride", {
        p_ride_id: ride.id,
        p_max_km: maxKm,
        p_freshness_mins: freshness,
      });

    if (rpcErr) {
      // We still return the created ride (unassigned) so UI can show it
      return NextResponse.json({
        ride,
        assigned: null,
        note: "RPC error; ride saved but not assigned",
        rpc_error: rpcErr.message,
      }, { status: 200 });
    }

    // assigned returns table(ride_id, assigned_driver, status)
    const result = Array.isArray(assigned) && assigned.length ? assigned[0] : null;

    return NextResponse.json({
      ride_id: ride.id,
      assigned_driver: result?.assigned_driver ?? null,
      ride_status: result?.status ?? "new",
    }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unexpected error" }, { status: 500 });
  }
}
