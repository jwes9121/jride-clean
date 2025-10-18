// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(_req: NextRequest) {
  // Add route guards here if you want (e.g., /admin)
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything EXCEPT NextAuth and static assets
    "/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
