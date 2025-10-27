// app/api/whoami/route.ts

// Temporary stub for production.
// We'll fill this with real session-aware whoami later.

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    user: null,
    note: "whoami stub",
  });
}
