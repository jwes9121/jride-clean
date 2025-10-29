// middleware.ts
import { NextResponse } from "next/server";
import { auth } from "./auth";

// Routes that require being logged in at all
const PROTECTED_PREFIXES = ["/dispatch", "/admin", "/dash"];

// Routes that must bypass middleware completely (login flow, callback, static, etc.)
const AUTH_BYPASS_PREFIXES = [
  "/api/auth",
  "/auth/signin",
  "/auth/error",
  "/auth/callback",
];

// Helper: decide what level of access a route needs
function requiredRoleForPath(pathname: string): "admin" | "dispatcher" | "user" {
  // Admin pages
  if (pathname.startsWith("/admin")) {
    return "admin";
  }

  // Dispatch panel pages (dispatchers and admins should both see this)
  if (pathname.startsWith("/dispatch")) {
    return "dispatcher";
  }

  // Dash or other internal pages -> basic logged-in user is enough for now
  if (pathname.startsWith("/dash")) {
    return "user";
  }

  return "user";
}

export default async function middleware(req: Request) {
  const url = new URL(req.url);
  const { pathname } = url;

  // 1. Allow bypass routes through untouched
  if (AUTH_BYPASS_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // 2. Check: does this route require login?
  const needsAuth = PROTECTED_PREFIXES.some(prefix => pathname.startsWith(prefix));
  if (!needsAuth) {
    // Public route, allow
    return NextResponse.next();
  }

  // 3. Get the session (auth() comes from NextAuth v5 / auth.js root config)
  const session = await auth();

  // 3a. No session? -> send to signin
  if (!session || !session.user) {
    const signinUrl = new URL("/auth/signin", req.url);
    return NextResponse.redirect(signinUrl);
  }

  // 4. Role enforcement
  // We'll assume you attach role info either:
  //   - into the session as session.user.role
  //   - OR you can later fetch from DB here if you haven't injected role into session yet.

  // For now, try to read it from session.user.role.
  // You will add this field in your auth.ts config (step 4 below).
  const userRole = (session.user as any).role ?? "user";
  const needRole = requiredRoleForPath(pathname);

  // Allowed combinations:
  // admin can see everything
  // dispatcher can see dispatcher-level and user-level
  // user can only see user-level
  const roleAllowsAccess = (() => {
    if (needRole === "user") return true; // any logged-in user ok
    if (needRole === "dispatcher") {
        return userRole === "dispatcher" || userRole === "admin";
    }
    if (needRole === "admin") {
        return userRole === "admin";
    }
    return false;
  })();

  if (!roleAllowsAccess) {
    // Not authorized -> you can either redirect, or show 403
    // We'll just redirect to /dispatch for now to keep UX simple
    return NextResponse.redirect(new URL("/dispatch", req.url));
  }

  // 5. All checks passed
  return NextResponse.next();
}

// Only run middleware for real app routes, skip static assets, etc.
export const config = {
  matcher: [
    // Apply to everything except static assets, Next internals, icons, and the debug-auth page if you have one
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(png|jpg|svg|ico|css|js)$).*)",
  ],
};
