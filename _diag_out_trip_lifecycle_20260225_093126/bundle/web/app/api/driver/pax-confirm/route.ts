import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(data: any, status: number = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req: Request) {
  try {
    const body: any = await req.json().catch(() => ({}));

    const ride_id = String(body?.ride_id || "");
    const driver_id = String(body?.driver_id || "");

    if (!ride_id || !driver_id) {
      return json({ ok: false, error: "MISSING_RIDE_OR_DRIVER" }, 400);
    }

    const matches = body?.matches === false ? false : true;
    const booked_pax = body?.booked_pax != null ? String(body.booked_pax).slice(0, 32) : null;
    const actual_pax = body?.actual_pax != null ? String(body.actual_pax).slice(0, 32) : null;
    const reason = body?.reason != null ? String(body.reason).slice(0, 64) : null;
    const note = body?.note != null ? String(body.note).slice(0, 240) : null;

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

    const { error } = await sb
      .from("ride_pax_confirmations")
      .insert({
        ride_id,
        driver_id,
        matches,
        booked_pax,
        actual_pax,
        reason,
        note,
      });

    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}