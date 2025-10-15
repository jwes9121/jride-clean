import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  const { booking_id, driver_id, fare } = await req.json();

  const finalFare = fare + 10; // add service fee

  const { data, error } = await supabase
    .from("bookings")
    .update({
      driver_id,
      proposed_fare: finalFare,
      status: "proposed",
    })
    .eq("id", booking_id);

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ booking: data });
}
