import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for admin driver-locations API."
  );
}

/**
 * Admin Supabase client
 * - Uses service role key
 * - Bypasses RLS (intended for trusted server-side use only)
 */
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const debug = searchParams.get("debug");

    const { data, error } = await supabaseAdmin
      .from("driver_locations")
      .select("driver_id, lat, lng, status, town, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("driver-locations select error:", error);
      const body: any = {
        ok: false,
        error: error.message,
        drivers: [],
      };
      return NextResponse.json(body, { status: 500 });
    }

    const drivers = data ?? [];

    // If debug=1, echo minimal env context to confirm which project we're hitting.
    if (debug) {
      return NextResponse.json({
        ok: true,
        projectUrl: supabaseUrl,
        drivers,
      });
    }

    return NextResponse.json({ ok: true, drivers });
  } catch (err: any) {
    console.error("driver-locations unexpected error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Unexpected error",
        drivers: [],
      },
      { status: 500 },
    );
  }
}
