import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const booking_code = String(body?.booking_code || "").trim();
    const fare = Number(body?.fare);

    if (!booking_code) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING_CODE" }, { status: 400 });
    }
    if (!Number.isFinite(fare) || fare <= 0) {
      return NextResponse.json({ ok: false, code: "INVALID_FARE" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Try verified_fare first, fallback to proposed_fare
    let { error } = await supabase
      .from("bookings")
      .update({ verified_fare: fare })
      .eq("booking_code", booking_code);

    if (error) {
      const retry = await supabase
        .from("bookings")
        .update({ proposed_fare: fare })
        .eq("booking_code", booking_code);

      if (retry.error) {
        return NextResponse.json(
          { ok: false, code: "UPDATE_FAILED", message: retry.error.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
