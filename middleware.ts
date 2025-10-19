// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

// IMPORTANT: exclude API, auth pages, and Next internals
export const config = {
  matcher: [
    // run on everything EXCEPT these
    "/((?!api|api/auth|_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|auth).*)",
  ],
};
