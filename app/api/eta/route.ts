import { NextResponse } from "next/server";
export const runtime = "nodejs";

function num(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const fromLat = num(u.searchParams.get("fromLat"));
    const fromLng = num(u.searchParams.get("fromLng"));
    const toLat   = num(u.searchParams.get("toLat"));
    const toLng   = num(u.searchParams.get("toLng"));

    if (fromLat===null || fromLng===null || toLat===null || toLng===null)
      return NextResponse.json({ ok:false, error:"INVALID_COORDS" }, { status:400 });

    const token = process.env.MAPBOX_TOKEN;
    if (!token)
      return NextResponse.json({ ok:false, error:"NO_MAPBOX_TOKEN", minutes:null, distanceMeters:null }, { status:200 });

    const coords = `${fromLng},${fromLat};${toLng},${toLat}`;
    const resp = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?access_token=${token}&geometries=geojson&overview=simplified&alternatives=false&annotations=duration,distance`,
      { headers: { accept: "application/json" }, cache: "no-store" }
    );

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ ok:false, error:"MAPBOX_ERROR", detail:text.slice(0,500) }, { status:200 });
    }

    const data: any = await resp.json();
    const route = data?.routes?.[0];
    if (!route) return NextResponse.json({ ok:false, error:"NO_ROUTE" }, { status:200 });

    const seconds = Number(route.duration ?? 0);
    const meters  = Number(route.distance ?? 0);

    return NextResponse.json({ ok:true, minutes: Math.round(seconds/60), distanceMeters: Math.round(meters) });
  } catch (err: any) {
    return NextResponse.json({ ok:false, error:"UNEXPECTED", detail:String(err?.message ?? err) }, { status:200 });
  }
}
