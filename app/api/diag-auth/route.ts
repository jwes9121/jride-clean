import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    NEXTAUTH_URL_present: !!process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET_present: !!process.env.NEXTAUTH_SECRET,
    GOOGLE_CLIENT_ID_present: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET_present: !!process.env.GOOGLE_CLIENT_SECRET,
  });
}
