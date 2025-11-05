import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Body = {
  pickup_lat: number;
  pickup_lng: number;
  dest_lat?: number | null;
  dest_lng?: number | null;
  town_hint?: string | null;
  max_km: number;
  freshness_mins: number;
};

function haversineKm(aLat:number,aLng:number,bLat:number,bLng:number){
  const R=6371, toRad=(d:number)=>d*Math.PI/180;
  const dLat=toRad(bLat-aLat), dLng=toRad(bLng-aLng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Body;
    if ([b.pickup_lat,b.pickup_lng,b.max_km,b.freshness_mins].some(v=>typeof v!=="number")) {
      return NextResponse.json({ error:"Invalid input" }, { status:400 });
    }

    const sinceISO = new Date(Date.now() - b.freshness_mins*60_000).toISOString();

    let q = supabaseAdmin
      .from("driver_locations")
      .select("driver_id,lat,lng,updated_at,drivers!inner(id,name,town,is_available)")
      .gte("updated_at", sinceISO)
      .eq("drivers.is_available", true);

    if (b.town_hint && b.town_hint.trim()!=="") q = q.eq("drivers.town", b.town_hint.trim());

    const { data: cand, error } = await q.limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status:400 });

    let best: { driver_id:string; km:number } | null = null;
    for (const row of cand ?? []) {
      const km = haversineKm(b.pickup_lat,b.pickup_lng,row.lat,row.lng);
      if (km <= b.max_km && (!best || km < best.km)) best = { driver_id: row.driver_id, km };
    }
    if (!best) return NextResponse.json({ error:"no_driver_in_radius" }, { status:404 });

    const insert = {
      pickup_lat: b.pickup_lat, pickup_lng: b.pickup_lng,
      dest_lat: b.dest_lat ?? null, dest_lng: b.dest_lng ?? null,
      town_hint: b.town_hint ?? null,
      status: "assigned",
      assigned_driver_id: best.driver_id,
    };

    const { data: ride, error: rErr } = await supabaseAdmin.from("rides").insert(insert).select().single();
    if (rErr) return NextResponse.json({ error: rErr.message }, { status:400 });

    return NextResponse.json({ ride_id: ride.id, driver_id: best.driver_id, distance_km: best.km }, { status:201 });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status:500 });
  }
}