// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// If you have logic, keep it here. Otherwise just pass through:
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

/**
 * Run middleware on everything EXCEPT:
 * - API routes (including NextAuth)
 * - Next.js internals and assets
 * - Favicons/robots/manifest
 * - Auth pages (/auth/**) so the sign-in UI and callbacks are not intercepted
 */
export const config = {
  matcher: [
    "/((?!api|api/auth|_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|auth).*)",
  ],
};

