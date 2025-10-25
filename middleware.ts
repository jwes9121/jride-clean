// middleware.ts
import { NextResponse } from "next/server";
import { auth } from "./auth";

export async function middleware(req: Request) {
  const session = await auth();

  const url = new URL(req.url);
  const pathname = url.pathname;

  // What routes require auth?
  // We will protect /dispatch and /admin*.
  // We will NOT protect /auth or /api/auth.
  const needsAuth =
    pathname.startsWith("/dispatch") ||
    pathname.startsWith("/admin");

  // If user is not signed in and is trying to access a protected page,
  // send them to the signin screen instead of 404 or loop.
  if (needsAuth && !session) {
    return NextResponse.redirect(new URL("/auth/signin", req.url));
  }

  // Otherwise, allow request through.
  return NextResponse.next();
}

// VERY IMPORTANT: matcher defines which routes this middleware runs on.
// DO NOT include /api/auth or /auth in here, or you'll break NextAuth.
export const config = {
  matcher: [
    "/dispatch/:path*",
    "/admin/:path*",
  ],
};
