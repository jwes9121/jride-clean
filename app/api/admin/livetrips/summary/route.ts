import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export async function GET() {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: "ENV_MISSING" }, { status: 500 });
    }

    const baseHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: \Bearer \\,
    };

    const selectCols = "id,booking_code,status,assigned_driver_id,created_at,pickup_lat,pickup_lng";

    const pendingUrl = \\/rest/v1/bookings?select=\&status=in.(pending,searching)&assigned_driver_id=is.null&order=created_at.asc\;

    const activeUrl = \\/rest/v1/bookings?select=\&status=in.(assigned,driver_accepted,driver_arrived,passenger_onboard,in_transit,dropoff)&order=created_at.asc\;

    const today = new Date().toISOString().slice(0, 10);
    const completedUrl = \\/rest/v1/bookings?select=\&status=eq.completed&created_at=gte.\T00:00:00Z&order=created_at.desc\;

    const driversUrl = \\/rest/v1/driver_locations?select=driver_id,lat,lng,status,updated_at&order=updated_at.desc\;

    const [pRes, aRes, cRes, dRes] = await Promise.all([
      fetch(pendingUrl, { headers: baseHeaders }),
      fetch(activeUrl, { headers: baseHeaders }),
      fetch(completedUrl, { headers: baseHeaders }),
      fetch(driversUrl, { headers: baseHeaders })
    ]);

    const [pRaw, aRaw, cRaw, dRaw] = await Promise.all([
      pRes.text(),
      aRes.text(),
      cRes.text(),
      dRes.text(),
    ]);

    const parse = (raw) => { try { return JSON.parse(raw); } catch { return []; } };

    return NextResponse.json({
      ok: true,
      pending: parse(pRaw),
      active: parse(aRaw),
      completed: parse(cRaw),
      drivers: parse(dRaw),
    }, { status: 200 });

  } catch (err: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: err?.message }, { status: 500 });
  }
}
