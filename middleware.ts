// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Minimal example:
 * - Do NOT run on NextAuth endpoints (/api/auth/*)
 * - Do NOT run on static assets
 * - Protect only the routes you actually want (e.g., /admin)
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Example gate: require session cookie on /admin pages (customize as needed)
  if (pathname.startsWith("/admin")) {
    // Let the app/page check session; middleware stays light to avoid
    // breaking OAuth. You can add lightweight IP/rate logic here if needed.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything EXCEPT:
    // - NextAuth routes
    // - API routes you don’t want to intercept
    // - Static assets
    "/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
