import { NextResponse } from "next/server";

// Disabled in clean build: avoids Supabase init at import time.
// Replace with the real implementation later.
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Bookings propose API is disabled in this build." },
    { status: 501 }
  );
}

// Keep it dynamic so Next doesn't try to prerender anything
export const dynamic = "force-dynamic";
