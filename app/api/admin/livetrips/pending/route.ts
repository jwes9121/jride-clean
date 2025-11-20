export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export async function GET() {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error(
        "[admin/livetrips/pending] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars"
      );
      return NextResponse.json(
        {
          error: "ENV_MISSING",
          message: "SUPABASE_URL or SUPABASE_ANON_KEY missing",
        },
        { status: 500 }
      );
    }

    // Get bookings with status 'pending' or 'searching' and no assigned driver
    const query =
      "status=in.(pending,searching)&assigned_driver_id=is.null&order=created_at.asc";
    const url = `${SUPABASE_URL}/rest/v1/bookings?${query}&select=id,booking_code,status,assigned_driver_id,created_at,pickup_lat,pickup_lng`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      cache: "no-store",
    });

    const raw = await res.text();
    let json: any = null;

    try {
      json = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error(
        "[admin/livetrips/pending] Failed to parse Supabase response as JSON:",
        e,
        "raw=",
        raw
      );
    }

    if (!res.ok) {
      console.error(
        "[admin/livetrips/pending] Supabase error:",
        res.status,
        raw
      );
      return NextResponse.json(
        {
          error: "DB_ERROR_FETCH",
          status: res.status,
          message: json?.message ?? raw ?? "Unknown Supabase error",
        },
        { status: 500 }
      );
    }

    const bookings = Array.isArray(json) ? json : [];

    return NextResponse.json(
      {
        ok: true,
        bookings,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[admin/livetrips/pending] SERVER ERROR:", error);
    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: error?.message ?? "Unknown server error",
      },
      { status: 500 }
    );
  }
}

