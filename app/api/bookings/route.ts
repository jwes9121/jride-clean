// app/api/bookings/route.ts
import { NextResponse } from "next/server";
import { computeTriplycFare } from "../../../lib/fare";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Handle ride booking requests from the client
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Expecting JSON like:
    // {
    //   "origin": "Lagawe Market",
    //   "destination": "Kiangan Plaza",
    //   "passengers": 2
    // }

    const origin: string = body.origin ?? "";
    const destination: string = body.destination ?? "";
    const passengers: number = Number(body.passengers ?? 1);

    // compute fare using the same global logic used in the UI
    const fare = computeTriplycFare(origin, destination, passengers);

    // Try to insert booking record into Supabase "rides" (or "bookings" if that's your table)
    // Adjust table/columns to match your schema.
    const { data, error } = await supabase
      .from("rides")
      .insert([
        {
          pickup_location: origin,
          dropoff_location: destination,
          passenger_count: passengers,
          estimated_fare: fare,
          status: "pending",
          created_at: new Date().toISOString(),
        },
      ])
      .select("*")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      // Even if insert fails (RLS etc.), we still respond 200 with fare,
      // because client UI just needs a response. You can change this to 400 if you want strict.
      return NextResponse.json(
        {
          ok: false,
          message: "Failed to save booking in database (RLS maybe).",
          fare,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        fare,
        ride: data,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("POST /api/bookings error:", err);
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid request",
      },
      { status: 400 }
    );
  }
}
