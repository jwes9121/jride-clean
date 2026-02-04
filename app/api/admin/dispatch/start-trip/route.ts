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

  const { error } = await supabase
    .from("bookings")
    .update({ status: "on_trip" })
    .eq("id", bookingId);

  if (error) {
    console.error("START_TRIP error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
