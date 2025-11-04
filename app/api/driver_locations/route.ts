import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY on the server" },
      { status: 500 }
    );
  }

  const u = new URL(`${url.replace(/\/+$/,"")}/rest/v1/driver_locations`);
  u.searchParams.set("select", "driver_id,lat,lng,updated_at");
  u.searchParams.set("order", "updated_at.desc");
  u.searchParams.set("limit", "200");

  try {
    const resp = await fetch(u.toString(), {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "public",
        "Content-Profile": "public",
      },
      cache: "no-store",
    });
    const data = await resp.json().catch(() => ([]));
    return NextResponse.json(data, { status: resp.status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}