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
  `script-src ${SELF} 'unsafe-eval' 'wasm-unsafe-eval' ${MAPBOX.join(" ")}`,
  `style-src ${SELF} 'unsafe-inline' ${MAPBOX.join(" ")}`,
  `img-src ${SELF} data: blob: ${MAPBOX.join(" ")}`,
  `font-src ${SELF} data: ${MAPBOX.join(" ")}`,
  `worker-src ${SELF} blob:`,
  `connect-src ${SELF} ${MAPBOX.join(" ")} ${SUPABASE.join(" ")} https://*.supabase.co wss://*.supabase.co`,
  `frame-ancestors ${SELF}`,
].join("; ");

export function middleware(req: NextRequest){ if (req.nextUrl.pathname === "/admin/livetrips"){ const url=req.nextUrl.clone(); url.pathname="/admin/livetest"; return NextResponse.redirect(url);}
  const res = NextResponse.next();
  const url = req.nextUrl.pathname;
  const skip =
    url.startsWith("/_next/") ||
    url.startsWith("/favicon.ico") ||
    url.match(/\.[\w]+$/) ||
    url.startsWith("/api/auth");

  if (!skip) res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Permissions-Policy", "geolocation=(), microphone=()");
  return res;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|.*\\..*|api/auth|api/rides/assign-nearest).*)"],
};

