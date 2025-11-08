// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAP_ROUTES = ["/admin/livetest", "/admin/livedrivermap"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Apply relaxed CSP only on map routes
  const needsMapboxCSP = MAP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );

  if (!needsMapboxCSP) return NextResponse.next();

  const res = NextResponse.next();

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com",
    "style-src 'self' 'unsafe-inline' https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com",
    "img-src 'self' data: blob: https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com",
    "font-src 'self' data: https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com",
    "connect-src 'self' https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com https://qpemhlgjcotngxahjidj.supabase.co https://*.supabase.co wss://qpemhlgjcotngxahjidj.supabase.co wss://*.supabase.co",
    "worker-src 'self' blob:",
    "frame-ancestors 'self'"
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);

  return res;
}

export const config = {
  matcher: ["/admin/:path*"],
};
