// app/api/dispatch/trips/route.ts
// Trip queue API - reads from bookings table in Supabase

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET() {
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase env vars for dispatch trips");
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_MISCONFIGURED",
        message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 500 }
    );
  }

  const url = `${supabaseUrl}/rest/v1/bookings?select=*&order=created_at.desc`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      cache: "no-store",
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Supabase bookings error:", data);
      return NextResponse.json(
        {
          ok: false,
          error: "UPSTREAM_ERROR",
          message: "Failed to load bookings from Supabase",
          details: data,
        },
        { status: res.status }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        rows: data,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Dispatch trips GET error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "DISPATCH_TRIPS_ERROR",
        message: "Unexpected error while fetching trips",
      },
      { status: 500 }
    );
  }
}
