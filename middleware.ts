import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/|vendor-samples/|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
