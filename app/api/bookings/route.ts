// app/api/bookings/route.ts
import { NextResponse } from "next/server";

// Minimal stub so build succeeds.
// Wire real logic later.
export async function GET() {
  return NextResponse.json({ ok: true, message: "bookings stub" });
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "not implemented" },
    { status: 501 }
  );
}
