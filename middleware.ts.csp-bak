import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // ✅ CSP: Vercel-safe, Mapbox-safe, Next.js-safe
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' blob: https://cdn.vercel-insights.com https://api.mapbox.com https://events.mapbox.com",
    "style-src 'self' 'unsafe-inline' blob: https://api.mapbox.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com https://*.mapbox.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com https://*.mapbox.com https://*.supabase.co",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-ancestors 'self'"
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  return res;
}

// skip static files, auth, API calls
export const config = {
  matcher: ["/((?!_next/|.*\\..*|api/auth|favicon.ico).*)"],
};
