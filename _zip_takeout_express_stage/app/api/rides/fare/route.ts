import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const bookingCode: string | undefined = body?.bookingCode;
    const fare: number | undefined = body?.fare;

    if (!bookingCode || typeof fare !== "number") {
      return NextResponse.json(
        { ok: false, error: "MISSING_OR_INVALID_FIELDS" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .update({
        proposed_fare: fare,
        status: "awaiting_passenger_confirmation",
        updated_at: new Date().toISOString(),
      })
      .eq("booking_code", bookingCode)
      .select("*")
      .single();

    if (error) {
      console.error("FARE_UPDATE_ERROR", error);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR_UPDATE", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, booking: data });
  } catch (err: any) {
    console.error("FARE_ROUTE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
