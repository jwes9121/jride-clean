// /app/api/rides/assign-nearest/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { ride_id } = await req.json();

  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/assign_nearest_driver_v1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,                 // SRK
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
    },
    body: JSON.stringify({ p_ride_id: ride_id }),
  });

  const data = await r.json();
  return NextResponse.json(data, { status: r.ok ? 200 : 400 });
}
