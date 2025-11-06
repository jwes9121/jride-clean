import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-only

// POST { ride_id: string }
export async function POST(req: Request) {
  try {
    const { ride_id } = await req.json();
    if (!ride_id) {
      return NextResponse.json({ status: "error", message: "ride_id required" }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false }
    });

    // call the v2 RPC (the one you just verified)
    const { data, error } = await supabase.rpc("assign_nearest_driver_v2", { p_ride_id: ride_id });

    if (error) {
      return NextResponse.json({ status: "error", message: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? { status: "error", message: "no response" });
  } catch (e: any) {
    return NextResponse.json({ status: "error", message: String(e?.message ?? e) }, { status: 500 });
  }
}
