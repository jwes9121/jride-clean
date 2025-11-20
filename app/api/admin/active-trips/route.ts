import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from("admin_active_trips_v1")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("ACTIVE_TRIPS_DB_ERROR", error);
      return NextResponse.json({ error: "ACTIVE_TRIPS_DB_ERROR", message: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err: any) {
    return NextResponse.json({ error: "ACTIVE_TRIPS_APP_ERROR", message: err.message }, { status: 500 });
  }
}
