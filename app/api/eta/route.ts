import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromLat = Number(searchParams.get("fromLat"));
  const fromLng = Number(searchParams.get("fromLng"));
  const toLat   = Number(searchParams.get("toLat"));
  const toLng   = Number(searchParams.get("toLng"));

  if (
    !isFinite(fromLat) || !isFinite(fromLng) ||
    !isFinite(toLat)   || !isFinite(toLng)
  ) {
    return NextResponse.json({ error: "Invalid coords" }, { status: 400 });
  }

  const token = process.env.MAPBOX_TOKEN;
  if (!token) return NextResponse.json({ error: "MAPBOX_TOKEN missing" }, { status: 500 });

  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false&geometries=geojson&access_token=${encodeURIComponent(token)}`;

  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return NextResponse.json({ error: "Mapbox error" }, { status: 502 });
    const j = await r.json();

    const route = j?.routes?.[0];
    if (!route) return NextResponse.json({ error: "No route" }, { status: 404 });

    const seconds = route.duration ?? null;
    const km = (route.distance ?? 0) / 1000;

    return NextResponse.json({
      minutes: seconds ? Math.max(1, Math.round(seconds / 60)) : null,
      km: Math.round(km * 10) / 10
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown" }, { status: 500 });
  }
}
