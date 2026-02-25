import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(data: any, status: number = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const ride_id = String(u.searchParams.get("ride_id") || "");

    if (!ride_id) return json({ ok: false, error: "MISSING_RIDE_ID" }, 400);

    const url =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";

    const service =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      process.env.SUPABASE_SERVICE_KEY ||
      "";

    if (!url || !service) {
      return json({ ok: false, error: "SERVER_MISSING_SUPABASE_SERVICE_ROLE" }, 500);
    }

    const sb = createClient(url, service, { auth: { persistSession: false } });

    const { data, error } = await sb
      .from("ride_pax_confirmations")
      .select("matches, booked_pax, actual_pax, reason, created_at")
      .eq("ride_id", ride_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) return json({ ok: false, error: error.message }, 500);

    const row = (data && data.length ? data[0] : null);
    return json({ ok: true, row });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}