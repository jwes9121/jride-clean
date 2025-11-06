// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAPBOX = [
  "https://api.mapbox.com",
  "https://*.tiles.mapbox.com",
  "https://events.mapbox.com",
];

const SUPABASE = [
  "https://qpemhlgjcotngxahjidj.supabase.co",
  "wss://qpemhlgjcotngxahjidj.supabase.co",
];

const SELF = "'self'";

const csp = [
  `default-src ${SELF}`,
  // Next dev / Mapbox sometimes require 'unsafe-eval' or 'wasm-unsafe-eval' (Mapbox GL v2 uses WASM)
  `script-src ${SELF} 'unsafe-eval' 'wasm-unsafe-eval' ${MAPBOX.join(" ")}`,
  // Mapbox CSS + Tailwind injects; keep 'unsafe-inline' for styles
  `style-src ${SELF} 'unsafe-inline' ${MAPBOX.join(" ")}`,
  // Map images/markers + Mapbox sprites/fonts
  `img-src ${SELF} data: blob: ${MAPBOX.join(" ")}`,
  `font-src ${SELF} data: ${MAPBOX.join(" ")}`,
  // Needed for Mapbox web workers
  `worker-src ${SELF} blob:`,
  // Tile JSON, sprites, fonts, Supabase REST/Realtime (HTTP + WebSocket)
  `connect-src ${SELF} ${MAPBOX.join(" ")} ${SUPABASE.join(" ")} https://*.supabase.co wss://*.supabase.co`,
  // Next static runtime assets
  `frame-ancestors ${SELF}`,
].join("; ");

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Don’t apply CSP to Next image/static and auth routes
  const url = req.nextUrl.pathname;
  const skip =
    url.startsWith("/_next/") ||
    url.startsWith("/favicon.ico") ||
    url.match(/\.[\w]+$/) || // any file.ext
    url.startsWith("/api/auth");

  if (!skip) {
    res.headers.set("Content-Security-Policy", csp);
  }

  // Minimal security headers
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Permissions-Policy", "geolocation=(), microphone=()");

  return res;
}

export const config = {
  matcher: [
    // allow our API route used by Assign Nearest
    "/((?!_next/|favicon.ico|.*\\..*|api/auth|api/rides/assign-nearest).*)",
  ],
};
