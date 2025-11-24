import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const supabase = createClient(url, key);

  try {
    // Test access to real table
    const { data, error } = await supabase
      .from("driver_locations")
      .select("id, driver_id, lat, lng, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(5);

    return NextResponse.json({ url, hasKey: true, error, data });
  } catch (err: any) {
    return NextResponse.json({ url, hasKey: true, error: err.message });
  }
}
