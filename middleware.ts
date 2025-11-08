// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Remove or override Vercel's default CSP
  res.headers.set(
    "Content-Security-Policy",
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;"
  );
  res.headers.set("X-Frame-Options", "ALLOWALL");
  res.headers.set("Cross-Origin-Embedder-Policy", "unsafe-none");
  res.headers.set("Cross-Origin-Opener-Policy", "unsafe-none");
  res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
