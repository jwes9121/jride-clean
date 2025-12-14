import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function sbGET(url: string, srk: string, path: string) {
  const res = await fetch(`${url}${path}`, {
    headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

function haversineKm(aLat:number,aLng:number,bLat:number,bLng:number) {
  const R = 6371;
  const dLat = (bLat-aLat) * Math.PI/180;
  const dLng = (bLng-aLng) * Math.PI/180;
  const sLat1 = aLat * Math.PI/180;
  const sLat2 = bLat * Math.PI/180;
  const x = Math.sin(dLat/2)**2 + Math.cos(sLat1)*Math.cos(sLat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(x)));
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingCode = String(body?.bookingCode || "").trim();
    if (!bookingCode) return NextResponse.json({ error: "bookingCode required" }, { status: 400 });

    const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
    const srk = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Booking info (your schema uses from_label/to_label + pickup_lat/lng)
    const bookings = await sbGET(url, srk,
      `/rest/v1/bookings?select=id,booking_code,status,assigned_driver_id,driver_id,pickup_lat,pickup_lng,town&booking_code=eq.${encodeURIComponent(bookingCode)}&limit=1`
    );
    const b = bookings?.[0];
    if (!b?.id) return NextResponse.json({ error: `booking not found: ${bookingCode}` }, { status: 404 });

    const currentDriver = b.assigned_driver_id || b.driver_id || null;
    const pLat = Number(b.pickup_lat);
    const pLng = Number(b.pickup_lng);

    if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) {
      return NextResponse.json({ error: "booking pickup_lat/pickup_lng missing" }, { status: 400 });
    }

    // Driver live locations:
    // We use mv_driver_live if available, else driver_locations
    // Try mv_driver_live first
    let drivers: any[] = [];
    try {
      drivers = await sbGET(url, srk,
        `/rest/v1/mv_driver_live?select=driver_id,lat,lng,updated_at,status&limit=2000`
      );
    } catch {
      drivers = await sbGET(url, srk,
        `/rest/v1/driver_locations?select=driver_id,lat,lng,updated_at&limit=2000`
      );
    }

    // Busy drivers = drivers assigned to any active booking
    const busyBookings = await sbGET(url, srk,
      `/rest/v1/bookings?select=assigned_driver_id,driver_id,status&id=neq.${encodeURIComponent(String(b.id))}&status=in.(assigned,on_the_way,on_trip)&limit=2000`
    );
    const busySet = new Set<string>();
    for (const x of busyBookings || []) {
      const d = x.assigned_driver_id || x.driver_id;
      if (d) busySet.add(String(d));
    }

    const out = (drivers || [])
      .map((d) => {
        const driverId = String(d.driver_id || d.id || "");
        const lat = Number(d.lat ?? d.latitude);
        const lng = Number(d.lng ?? d.longitude);
        if (!driverId || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (currentDriver && driverId === String(currentDriver)) return null; // exclude current driver
        if (busySet.has(driverId)) return null; // exclude busy
        const km = haversineKm(pLat, pLng, lat, lng);
        return {
          driver_id: driverId,
          distance_km: Number(km.toFixed(2)),
          last_seen: d.updated_at || null,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.distance_km - b.distance_km)
      .slice(0, 8);

    return NextResponse.json({
      booking: { id: b.id, booking_code: b.booking_code, status: b.status, current_driver: currentDriver },
      drivers: out,
      excluded_current_driver: currentDriver,
      excluded_busy_count: busySet.size,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
