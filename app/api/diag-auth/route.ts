// app/api/diag-auth/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const body = {
    NEXTAUTH_URL_present: !!process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET_present: !!process.env.NEXTAUTH_SECRET,
    GOOGLE_CLIENT_ID_present: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET_present: !!process.env.GOOGLE_CLIENT_SECRET,
    ENABLE_GOOGLE: process.env.ENABLE_GOOGLE ?? null,
  };

  return NextResponse.json(body, {
    headers: { "cache-control": "no-store" },
    status: 200,
  });
}