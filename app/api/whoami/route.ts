// app/api/whoami/route.ts
import { NextResponse } from "next/server";

// Temporary stub for production build.
export async function GET() {
  return NextResponse.json({
    ok: true,
    user: null,
    note: "whoami stub",
  });
}
