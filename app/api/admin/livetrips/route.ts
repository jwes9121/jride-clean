Set-Location "C:\Users\jwes9\Desktop\jride-clean-fresh"

@'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Prefer server-side envs, fall back to NEXT_PUBLIC if needed
const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "LIVE_TRIPS_ROUTE_ERROR: Supabase env vars missing. Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_ / SUPABASE_ANON_KEY) in .env.local"
  );
}

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      })
    : null;

/**
 * GET /api/admin/livetrips
 *
 * Returns live trips for dispatch from the `dispatch_rides_view` view.
 */
export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json(
        {
          error: "LIVE_TRIPS_DB_ERROR",
          message:
            "Supabase client not initialized. Check Supabase env vars on server.",
        },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from("dispatch_rides_view")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("LIVE_TRIPS_DB_ERROR (Supabase)", error);
      return NextResponse.json(
        {
          error: "LIVE_TRIPS_DB_ERROR",
          message: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        bookings: data ?? [],
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("LIVE_TRIPS_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "LIVE_TRIPS_UNEXPECTED_ERROR",
        message: err?.message ?? "Unexpected error",
      },
      { status: 500 }
    );
  }
}
'@ | Set-Content -Encoding UTF8 "app\api\admin\livetrips\route.ts"
