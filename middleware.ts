import { NextResponse } from "next/server";
import { auth } from "@/configs/nextauth";

// This middleware protects certain routes by requiring login.
export async function middleware(req: Request) {
  const session = await auth();
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Routes that should require auth:
  const protectedPrefixes = ["/dispatch", "/admin", "/dash"];

  const needsAuth = protectedPrefixes.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (needsAuth && !session) {
    return NextResponse.redirect(new URL("/auth/signin", req.url));
  }

  return NextResponse.next();
}

// Limit middleware to only these routes so /auth and public stuff still loads
export const config = {
  matcher: ["/dispatch/:path*", "/admin/:path*", "/dash/:path*"],
};
