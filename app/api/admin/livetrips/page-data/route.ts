import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    console.log("[API] /admin/livetrips/page-data called");

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      console.error("[API] Missing Supabase env vars");
      return NextResponse.json(
        { error: "Missing Supabase env vars" },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key);

    const { data, error } = await supabase.rpc(
      "admin_get_live_trips_page_data"
    );

    console.log("[API] RPC data:", data);
    console.log("[API] RPC error:", error);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? {});
  } catch (err: any) {
    console.error("[API] Unexpected error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unexpected server error" },
      { status: 500 }
    );
  }
}
