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

    // --- AUTO ADVANCE BEFORE ON_THE_WAY ---
  const { data: b } = await supabase
    .from("bookings")
    .select("status, passenger_fare_response, verified_fare")
    .eq("id", bookingId)
    .single();

  if (b) {
    if (b.status === "assigned" && b.passenger_fare_response === "accepted") {
      await supabase.from("bookings").update({ status: "fare_proposed" }).eq("id", bookingId);
      await supabase.from("bookings").update({ status: "ready" }).eq("id", bookingId);
    }
    if (b.status === "fare_proposed" && b.passenger_fare_response === "accepted") {
      await supabase.from("bookings").update({ status: "ready" }).eq("id", bookingId);
    }
  }
  // --- END AUTO ADVANCE ---
  const { error } = await supabase
    .from("bookings")
    .update({ status: "on_the_way" })
    .eq("id", bookingId);

  if (error) {
    console.error("ON_THE_WAY error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
