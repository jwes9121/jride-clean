import { auth } from "./auth";
import { NextResponse } from "next/server";

export async function middleware(req: Request) {
  const url = new URL(req.url);
  const { pathname } = url;

  const publicPaths = [
    "/",
    "/auth/signin",
    "/auth/error",
  ];

  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth") ||
    pathname.match(/\.(.*)$/) ||
    publicPaths.includes(pathname)
  ) {
    return NextResponse.next();
  }

  const requiresAuth =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dispatcher") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/rides") ||
    pathname.startsWith("/settings");

  if (!requiresAuth) {
    return NextResponse.next();
  }

  const session = await auth();

  if (!session) {
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/|api/auth|auth|favicon.ico|.*\\..*).*)",
  ],
};
