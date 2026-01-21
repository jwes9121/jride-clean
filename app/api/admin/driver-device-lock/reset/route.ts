import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const driverId = String(body?.driver_id ?? body?.driverId ?? "").trim();
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "driver_id required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("driver_device_locks")
      .delete()
      .eq("driver_id", driverId);

    if (error) {
      console.error("admin reset device lock error", error);
      return NextResponse.json({ ok: false, error: "DB_ERROR_RESET" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, driver_id: driverId }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}