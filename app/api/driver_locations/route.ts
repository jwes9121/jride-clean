import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
    },
  }
);

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("driver_locations")
    .select("driver_id, lat, lng, status, town, updated_at")
    .neq("status", "offline"); // adjust filter as needed

  if (error) {
    console.error("driver_locations admin fetch error", error);
    return NextResponse.json(
      { ok: false, error: "DB_ERROR_FETCH" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, drivers: data ?? [] });
}
