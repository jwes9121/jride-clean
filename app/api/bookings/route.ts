import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  const { passenger_id, pickup, destination } = await req.json();

  // Step 1: check if trip exists in history
  const { data: pastTrips } = await supabase
    .from("trip_history")
    .select("final_fare")
    .eq("pickup", pickup)
    .eq("destination", destination)
    .limit(3);

  let suggestedFare = null;
  if (pastTrips && pastTrips.length > 0) {
    const avg =
      pastTrips.reduce((sum, trip) => sum + trip.final_fare, 0) /
      pastTrips.length;
    suggestedFare = Math.round(avg); // simple avg fare
  }

  // Step 2: create booking
  const { data, error } = await supabase.from("bookings").insert([
    {
      passenger_id,
      pickup,
      destination,
      status: "pending",
      proposed_fare: suggestedFare, // null if no history yet
    },
  ]);

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ booking: data, suggestedFare });
}
