// app/api/dispatch/assign/route.ts
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { booking_id, driver_id } = await req.json();

    if (!booking_id || !driver_id) {
      return NextResponse.json(
        { ok: false, error: "Missing booking_id or driver_id" },
        { status: 400 }
      );
    }

    // Update bookings table
    const { error } = await supabase
      .from("bookings")
      .update({
        assigned_driver_id: driver_id,
        status: "assigned",
        updated_at: new Date().toISOString(),
      })
      .eq("booking_id", booking_id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as any).message },
      { status: 500 }
    );
  }
}
