export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const secret = process.env.SUPABASE_SECRET!;

  try {
    const { ride_id, pickup_lat, pickup_lng, town } = await req.json();

    // 1) RPC to find nearest driver (server Secret key)
    const rpc = await fetch(`${url}/rest/v1/rpc/find_nearest_driver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: secret,
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        p_pickup_lat: pickup_lat,
        p_pickup_lng: pickup_lng,
        p_town: town,
      }),
    });
    const nearest = await rpc.json();
    if (!rpc.ok || !Array.isArray(nearest) || nearest.length === 0) {
      return NextResponse.json({ status: "no_driver" });
    }
    const driverId = nearest[0].driver_id;

    // 2) Update ride
    const upd = await fetch(`${url}/rest/v1/rides?id=eq.${ride_id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
        apikey: secret,
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        driver_id: driverId,
        status: "assigned",
        assigned_at: new Date().toISOString(),
      }),
    });
    if (!upd.ok) {
      const t = await upd.text();
      return NextResponse.json({ status: "error", message: t }, { status: 500 });
    }

    return NextResponse.json({ status: "ok", driver_id: driverId });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e.message }, { status: 500 });
  }
}
