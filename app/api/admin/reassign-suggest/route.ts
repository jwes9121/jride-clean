import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function haversineMeters(lat1:number,lng1:number,lat2:number,lng2:number){
  const R = 6371000;
  const toRad = (d:number)=> d*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLng = toRad(lng2-lng1);
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

async function sbGET(SUPABASE_URL:string, SR:string, path:string) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const bookingId = u.searchParams.get("bookingId");
    const bookingCode = u.searchParams.get("bookingCode");
    const limit = Math.min(Number(u.searchParams.get("limit") || "3") || 3, 10);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SR = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const bookingSelect = "id,booking_code,pickup_lat,pickup_lng,assigned_driver_id,status";

    let booking: any = null;

    if (bookingId) {
      const rows = await sbGET(
        SUPABASE_URL, SR,
        `/rest/v1/bookings?select=${bookingSelect}&limit=1&id=eq.${encodeURIComponent(bookingId)}`
      );
      booking = rows?.[0];
    } else if (bookingCode) {
      const rows = await sbGET(
        SUPABASE_URL, SR,
        `/rest/v1/bookings?select=${bookingSelect}&limit=1&booking_code=eq.${encodeURIComponent(bookingCode)}`
      );
      booking = rows?.[0];
    } else {
      return NextResponse.json({ error: "Provide bookingId or bookingCode" }, { status: 400 });
    }

    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    const pickLat = Number(booking.pickup_lat);
    const pickLng = Number(booking.pickup_lng);
    const currentDriver = String(booking.assigned_driver_id || "");

    if (!Number.isFinite(pickLat) || !Number.isFinite(pickLng)) {
      return NextResponse.json({ error: "Missing pickup_lat/pickup_lng" }, { status: 400 });
    }

    const rows = await sbGET(
      SUPABASE_URL, SR,
      `/rest/v1/driver_locations?select=driver_id,lat,lng,updated_at&order=updated_at.desc&limit=1500`
    );

    const seen = new Set<string>();
    const candidates: any[] = [];

    for (const r of rows ?? []) {
      const did = String(r.driver_id || "");
      if (!did) continue;

      // ✅ Exclude the currently assigned driver from suggestions
      if (currentDriver && did === currentDriver) continue;

      if (seen.has(did)) continue;
      seen.add(did);

      const lat = Number(r.lat);
      const lng = Number(r.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const meters = haversineMeters(pickLat, pickLng, lat, lng);
      candidates.push({
        driver_id: did,
        lat,
        lng,
        updated_at: r.updated_at ?? null,
        distance_m: Math.round(meters),
      });

      if (candidates.length >= 500) break;
    }

    candidates.sort((a,b)=> a.distance_m - b.distance_m);

    return NextResponse.json({
      booking: {
        id: booking.id,
        booking_code: booking.booking_code,
        pickup_lat: pickLat,
        pickup_lng: pickLng,
        assigned_driver_id: booking.assigned_driver_id,
        status: booking.status,
      },
      count: candidates.slice(0, limit).length,
      suggestions: candidates.slice(0, limit),
    });

  } catch (e:any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
