import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  const { booking_id, response } = await req.json();

  if (response === "accept") {
    // Mark accepted
    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "accepted" })
      .eq("id", booking_id)
      .select()
      .single();

    // Save to history
    if (data) {
      await supabase.from("trip_history").insert([
        {
          pickup: data.pickup,
          destination: data.destination,
          final_fare: data.proposed_fare,
        },
      ]);
    }

    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ booking: data });
  } else {
    // Decline → free booking for next driver
    await supabase
      .from("bookings")
      .update({ status: "declined", driver_id: null })
      .eq("id", booking_id);

    return NextResponse.json({ message: "Booking declined, reassign driver" });
  }
}
