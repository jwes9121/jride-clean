import { NextResponse } from "next/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const revalidate = 0;

export async function GET() {
  const r = await fetch(`${url}/rest/v1/driver_locations?select=driver_id,lat,lng,heading,speed,updated_at&order=updated_at.desc`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    cache: "no-store",
  });
  if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: r.status });
  const data = await r.json();
  return NextResponse.json(data);
}
