import { auth, handlers, signIn, signOut } from "@/configs/nextauth";
import { NextResponse } from "next/server";

import { computeTriplycFare } from "../../../lib/fare";

// this is what frontend is probably POSTing
// we make everything optional so the API never crashes TS
type CreateBookingBody = {
  mode?: string;            // "tricycle" | "motorcycle"
  origin?: string;
  destination?: string;
  passengers?: number;
  distanceKm?: number;
  minutes?: number;
};

export async function POST(req: Request) {
  try {
    // require login
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // read body
    const body = (await req.json()) as CreateBookingBody;

    // call fare helper using the single-object signature our stub expects
    const fareQuote = computeTriplycFare({
      mode: body.mode ?? "tricycle",
      passengers: body.passengers ?? 1,
      distanceKm: body.distanceKm ?? 2,
      minutes: body.minutes ?? 5,
    });

    // respond with the computed estimate
    return NextResponse.json(
      {
        ok: true,
        fare: fareQuote,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/bookings error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
