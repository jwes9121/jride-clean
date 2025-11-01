import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Reasonable CSP that allows Next to hydrate and Mapbox to connect.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' blob:",        // allow Next inline runtime; no 'unsafe-eval'
    "style-src 'self' 'unsafe-inline' blob:",         // Tailwind/Next style tags
    "img-src 'self' data: blob: https://*",
    "font-src 'self' data:",
    "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com https://*.mapbox.com",
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

// Exclude static assets and auth endpoints from middleware work
export const config = {
  matcher: ["/((?!_next/|.*\\..*|api/auth|favicon.ico).*)"],
};
