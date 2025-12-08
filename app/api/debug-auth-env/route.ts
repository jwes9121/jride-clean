import { NextResponse } from "next/server";

export async function GET() {
  // DO NOT deploy this in production. Local debugging only.
  return NextResponse.json({
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    AUTH_SECRET_present: Boolean(process.env.AUTH_SECRET),
    NEXTAUTH_SECRET_present: Boolean(process.env.NEXTAUTH_SECRET),
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? null,
    GOOGLE_CLIENT_SECRET_present: Boolean(process.env.GOOGLE_CLIENT_SECRET),
  });
}
