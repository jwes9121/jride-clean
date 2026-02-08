import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Safe NextAuth v5 middleware (no crash, no vendor blocking)
 * - Allows public + Next internals
 * - Enforces auth ONLY on /admin and /dispatcher (adjust later if needed)
 */
export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname || "/";

  // Always allow Next internals + static files
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Protect only admin/dispatcher areas (keep vendor free for now)
  if (pathname.startsWith("/admin") || pathname.startsWith("/dispatcher")) {
    if (!req.auth?.user) {
      const url = new URL("/auth/signin", nextUrl);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
