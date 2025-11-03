import { NextResponse } from "next/server";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://cdn.vercel-insights.com",
  "img-src 'self' blob: data: https://api.mapbox.com https://events.mapbox.com https://*.tile.openstreetmap.org",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://events.mapbox.com https://cdn.vercel-insights.com",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join("; ");

export function middleware() {
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", CSP);
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("X-XSS-Protection", "0");
  return res;
}

// exclude auth/static/assets/files with extensions
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|auth|.*\\.[\\w]+$).*)",
  ],
};
