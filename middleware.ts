// middleware.ts
import { NextResponse } from "next/server";
import { auth } from "./auth";

// Routes that require being logged in at all
const PROTECTED_PREFIXES = ["/dispatch", "/admin", "/dash"];

// Routes that must bypass middleware completely (login flow, callback, errors, etc.)
const AUTH_BYPASS_PREFIXES = [
  "/api/auth",
  "/auth/signin",
  "/auth/error",
  "/auth/callback",
];

// For a given path, what role do we require?
function requiredRoleForPath(pathname: string): "admin" | "dispatcher" | "user" {
  if (pathname.startsWith("/admin")) {
    return "admin"; // admin-only
  }

  if (pathname.startsWith("/dispatch")) {
    return "dispatcher"; // dispatcher or admin
  }

  if (pathname.startsWith("/dash")) {
    return "user"; // any logged-in user
  }

  return "user";
}

export default async function middleware(req: Request) {
  const url = new URL(req.url);
  const { pathname } = url;

  // 1. Let auth callbacks / signin / error continue untouched
  if (AUTH_BYPASS_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // 2. If this path isn't one we care about, allow it
  const needsAuth = PROTECTED_PREFIXES.some(prefix =>
    pathname.startsWith(prefix)
  );
  if (!needsAuth) {
    return NextResponse.next();
  }

  // 3. Get session
  const session = await auth();

  // 3a. If not logged in, send to /auth/signin
  if (!session || !session.user) {
    const signinUrl = new URL("/auth/signin", req.url);
    return NextResponse.redirect(signinUrl);
  }

  // 4. Role check
  const userRole = (session.user as any).role ?? "user";
  const needRole = requiredRoleForPath(pathname);

  // role rules:
  // - admin can see everything
  // - dispatcher can see dispatcher + user
  // - user can only see user
  const roleAllowsAccess = (() => {
    if (needRole === "user") return true;
    if (needRole === "dispatcher") {
      return userRole === "dispatcher" || userRole === "admin";
    }
    if (needRole === "admin") {
      return userRole === "admin";
    }
    return false;
  })();

  if (!roleAllowsAccess) {
    // not allowed -> bounce somewhere safe
    return NextResponse.redirect(new URL("/dispatch", req.url));
  }

  // 5. all good
  return NextResponse.next();
}

// IMPORTANT: matcher must NOT use capture groups or lookaheads.
// We just directly list which routes middleware should run on.
export const config = {
  matcher: [
    "/dispatch",
    "/dispatch/:path*",
    "/admin",
    "/admin/:path*",
    "/dash",
    "/dash/:path*",
  ],
};
