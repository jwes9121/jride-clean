import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * DEV-ONLY MIDDLEWARE
 *
 * This middleware bypasses all auth checks so that
 * routes like /admin/livetripss can be loaded without
 * Google sign-in while you debug locally.
 *
 * DO NOT deploy this version to production.
 */

export function middleware(request: NextRequest) {
  // Just let every request through
  return NextResponse.next();
}

// Apply to everything except Next.js static assets & api auth callbacks if you want
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

