import { NextResponse } from "next/server";

/** CSP for dev + prod
 *  - allows Supabase REST + Realtime (HTTPS/WSS)
 *  - allows Next.js dev HMR (HTTP/WS localhost)
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:",
  "connect-src 'self' http://localhost:* ws://localhost:* https://*.supabase.co wss://*.supabase.co https://api.supabase.com",
  "frame-ancestors 'self'",
  "worker-src 'self' blob:",
].join("; ");

export function middleware(req) {
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "geolocation=(), microphone=()");
  return res;
}

// Apply to everything except Next static assets and files
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt)$).*)",
  ],
};
