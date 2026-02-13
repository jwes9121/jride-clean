// app/api/dispatch/overview/route.ts
// Dispatch overview API - reads from dispatch_rides_view in Supabase

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET() {
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase env vars for dispatch overview");
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_MISCONFIGURED",
        message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 500 }
    );
  }

  const url = `${supabaseUrl}/rest/v1/dispatch_rides_view?select=*`;

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
      console.error("Supabase dispatch_rides_view error:", data);
      return NextResponse.json(
        {
          ok: false,
          error: "UPSTREAM_ERROR",
          message: "Failed to load dispatch overview from Supabase",
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
    console.error("Dispatch overview GET error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "DISPATCH_OVERVIEW_ERROR",
        message: "Unexpected error while fetching dispatch overview",
      },
      { status: 500 }
    );
  }
}
