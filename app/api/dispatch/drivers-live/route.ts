export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Read-only "driver live" snapshot for Dispatch.
// Uses mv_driver_live (already present in DB).
// Returns: id, driver_status, driver_name, wallet_balance, wallet_locked, min_wallet_required, lat, lng, location_updated_at

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ""
);

export async function GET(_req: NextRequest) {
  try {
    const { data, error } = await supabase
      .from("mv_driver_live")
      .select("id, driver_status, driver_name, wallet_balance, wallet_locked, min_wallet_required, lat, lng, location_updated_at, updated_at")
      .limit(2000);

    if (error) {
      return NextResponse.json({ ok: false, code: "DRIVERS_LIVE_QUERY_FAILED", message: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, drivers: data || [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: String(e?.message || "Unknown error") },
      { status: 500 }
    );
  }
}
