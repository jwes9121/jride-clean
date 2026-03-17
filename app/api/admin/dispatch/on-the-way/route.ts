import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { bookingId } = await req.json();

  if (!bookingId) {
    return NextResponse.json(
      { error: "Missing bookingId" },
      { status: 400 }
    );
  }

  try {
    const { data: booking, error: readErr } = await supabase
      .from("bookings")
      .select("id, status, passenger_fare_response, proposed_fare, verified_fare, driver_id, assigned_driver_id")
      .eq("id", bookingId)
      .single();

    if (readErr) {
      console.error("ON_THE_WAY read error", readErr);
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const st = String(booking.status ?? "").trim().toLowerCase();
    const resp = String(booking.passenger_fare_response ?? "").trim().toLowerCase();
    const hasFare = booking.proposed_fare != null || booking.verified_fare != null;

    const steps: string[] = [];

    if (st === "assigned" && (resp === "accepted" || hasFare)) {
      steps.push("accepted", "fare_proposed", "ready");
    } else if (st === "accepted" && (resp === "accepted" || hasFare)) {
      steps.push("fare_proposed", "ready");
    } else if (st === "fare_proposed" && resp === "accepted") {
      steps.push("ready");
    }

    for (const nextSt of steps) {
      const { error: stepErr } = await supabase
        .from("bookings")
        .update({
          status: nextSt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingId);

      if (stepErr) {
        console.error("ON_THE_WAY auto-advance failed", nextSt, stepErr);
        return NextResponse.json(
          {
            error: "Lifecycle auto-advance failed",
            attempted_step: nextSt,
            message: stepErr.message,
            current_status: st,
          },
          { status: 500 }
        );
      }
    }

    const { error } = await supabase
      .from("bookings")
      .update({
        status: "on_the_way",
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    if (error) {
      console.error("ON_THE_WAY error", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("ON_THE_WAY unexpected", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}