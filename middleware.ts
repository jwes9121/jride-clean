import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * JRIDE_MW_SAFE_V1
 * Goal: NEVER block API routes that LiveTrips depends on.
 * - allow /api/dispatch/* (status/assign/emergency)
 * - allow /api/admin/* (page-data, driver_locations, drivers, etc.)
 * - allow next static assets + favicon
 *
 * If you want to re-enable strict auth later, do it AFTER dispatch hardening is stable.
 */
export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;

  // Always allow these (prevent 403 loops / broken buttons)
  if (
    p.startsWith("/api/dispatch/") ||
    p.startsWith("/api/admin/") ||
    p.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  // Allow Next.js internals & files
  if (
    p.startsWith("/_next/") ||
    p === "/favicon.ico" ||
    /\.[a-zA-Z0-9]+$/.test(p)
  ) {
    return NextResponse.next();
  }

  // For now, do not enforce anything here.
  // (Keeps dev stable while we harden dispatch routes.)
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\..*).*)"],
};
