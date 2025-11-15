import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bookingCode, driverId } = body;

    if (!bookingCode || !driverId) {
      return NextResponse.json(
        { ok: false, error: "Missing bookingCode or driverId" },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from("bookings")
      .update({
        status: "assigned",
        assigned_driver_id: driverId,
        updated_at: new Date().toISOString(),
      })
      .eq("booking_code", bookingCode)
      .select();

    if (error) {
      console.error("assign error:", error);
      return NextResponse.json(
        { ok: false, error: error.message ?? "Failed update" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    console.error("assign try/catch:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
