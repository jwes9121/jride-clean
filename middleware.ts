// middleware.ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  const pathname = nextUrl.pathname;
  const isApiAuth = pathname.startsWith("/api/auth");
  const isAuthRoute = pathname.startsWith("/auth");

  // Never intercept the auth callback endpoints
  if (isApiAuth) return;

  // Not logged in → force to /auth/signin (preserve where they wanted to go)
  if (!isLoggedIn && !isAuthRoute) {
    const login = new URL("/auth/signin", nextUrl);
    login.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(login);
  }

  // Already logged in and hitting an auth route → push home
  if (isLoggedIn && isAuthRoute) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  // Otherwise, allow
  return;
});

export const config = {
  // don’t run on static assets / _next / favicon
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
