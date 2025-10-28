import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({
    secret: !!process.env.NEXTAUTH_SECRET,
    googleId: !!process.env.GOOGLE_CLIENT_ID,
    googleSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    url: process.env.NEXTAUTH_URL,
  });
}
