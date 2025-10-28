// Middleware that protects certain app routes, but does NOT interfere with NextAuth OAuth.

import { NextResponse } from "next/server";
import { auth } from "./auth";

// Routes that should require auth
const PROTECTED_PREFIXES = ["/dispatch", "/admin", "/dash"];

// Routes that must bypass middleware entirely (NextAuth auth flow, callbacks, errors, etc.)
const AUTH_BYPASS_PREFIXES = [
  "/api/auth",
  "/auth/signin",
  "/auth/error",
  "/auth/callback",
];

export async function middleware(req: Request) {
  const url = new URL(req.url);
  const { pathname } = url;

  // 1. Allow NextAuth/OAuth routes through untouched.
  if (AUTH_BYPASS_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // 2. If this path is protected, require a session.
  const needsAuth = PROTECTED_PREFIXES.some(prefix => pathname.startsWith(prefix));

  if (needsAuth) {
    const session = await auth();
    if (!session) {
      // redirect to /auth/signin if not logged in
      const signinUrl = new URL("/auth/signin", req.url);
      return NextResponse.redirect(signinUrl);
    }
  }

  // 3. Otherwise allow the request through.
  return NextResponse.next();
}

// Only run middleware for real app routes, skip _next/static etc.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/debug-auth-env).*)",
  ],
};
