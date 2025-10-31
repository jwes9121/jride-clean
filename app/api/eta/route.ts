import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // or 'edge' if you prefer; nodejs is fine

function num(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const fromLat = num(url.searchParams.get('fromLat'));
    const fromLng = num(url.searchParams.get('fromLng'));
    const toLat   = num(url.searchParams.get('toLat'));
    const toLng   = num(url.searchParams.get('toLng'));

    // basic validation
    if (
      fromLat === null || fromLng === null ||
      toLat === null   || toLng === null
    ) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_COORDS' },
        { status: 400 }
      );
    }

    const token = process.env.MAPBOX_TOKEN;
    if (!token) {
      // Don’t crash—return a graceful response the UI can handle
      return NextResponse.json(
        { ok: false, error: 'NO_MAPBOX_TOKEN', minutes: null, distanceMeters: null },
        { status: 200 }
      );
    }

    // Mapbox Directions (driving-traffic)
    const coords = `${fromLng},${fromLat};${toLng},${toLat}`;
    const qs = new URLSearchParams({
      access_token: token,
      geometries: 'geojson',
      overview: 'simplified',
      annotations: 'duration,distance',
      alternatives: 'false'
    });

    const resp = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?${qs.toString()}`,
      { method: 'GET', headers: { 'accept': 'application/json' }, cache: 'no-store' }
    );

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { ok: false, error: 'MAPBOX_ERROR', detail: text.slice(0, 500) },
        { status: 200 } // keep 200 so UI won’t throw
      );
    }

    const data = await resp.json();
    const route = data?.routes?.[0];

    if (!route) {
      return NextResponse.json(
        { ok: false, error: 'NO_ROUTE' },
        { status: 200 }
      );
    }

    const seconds = Number(route.duration ?? 0);
    const meters  = Number(route.distance ?? 0);

    return NextResponse.json({
      ok: true,
      minutes: Math.round(seconds / 60),
      distanceMeters: Math.round(meters),
    });
  } catch (err: any) {
    // Never 502—always respond JSON
    return NextResponse.json(
      { ok: false, error: 'UNEXPECTED', detail: String(err?.message ?? err) },
      { status: 200 }
    );
  }
}
