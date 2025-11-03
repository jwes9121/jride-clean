// middleware.ts
import { NextResponse } from "next/server";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // allow inline styles (Tailwind) and self
  "style-src 'self' 'unsafe-inline'",
  // allow our scripts + Vercel analytics
  "script-src 'self' 'unsafe-inline' https://cdn.vercel-insights.com",
  // images + tiles
  "img-src 'self' blob: data: https://api.mapbox.com https://events.mapbox.com https://*.tile.openstreetmap.org",
  // **THIS IS THE FIX**: allow REST + realtime to Supabase, plus Mapbox & Vercel analytics
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://events.mapbox.com https://cdn.vercel-insights.com",
  // fonts and workers
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

// exclude auth routes, static assets, and files with extensions
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|auth|.*\\.[\\w]+$).*)",
  ],
};
