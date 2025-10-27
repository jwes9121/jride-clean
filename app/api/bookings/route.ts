// app/api/bookings/route.ts

// Temporary stub so production build succeeds.
// We can wire real logic later.

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, message: "bookings stub" });
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "not implemented" },
    { status: 501 }
  );
}
