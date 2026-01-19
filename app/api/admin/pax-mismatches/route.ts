import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(data: any, status: number = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(String(u.searchParams.get("limit") || "200"), 10) || 200, 10), 500);

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
      .select("ride_id, driver_id, matches, booked_pax, actual_pax, reason, note, created_at")
      .eq("matches", false)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, rows: data || [] });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}