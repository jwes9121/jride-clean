import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const { rideId, status } = await req.json();
    const allowed = ["assigned","in_progress","completed","cancelled","pending"];
    if (!rideId || !allowed.includes(String(status).toLowerCase())) {
      return NextResponse.json({ error: "invalid rideId/status" }, { status: 400 });
    }

    const { error } = await supabaseServer.from("rides").update({ status }).eq("id", rideId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
