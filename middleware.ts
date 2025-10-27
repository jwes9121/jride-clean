import { NextResponse } from "next/server";
import { auth } from "@/configs/nextauth";

// This middleware can protect certain routes if we want.
// For now we’ll allow everything, but we can gate /dispatch or /admin later.

export async function middleware(req: Request) {
  const session = await auth();

  // Example: protect /dispatch and /admin
  const url = new URL(req.url);
  const pathname = url.pathname;

  const protectedPaths = ["/dispatch", "/admin", "/dash"];
  const needsAuth = protectedPaths.some((p) => pathname.startsWith(p));

  if (needsAuth && !session) {
    return NextResponse.redirect(new URL("/auth/signin", req.url));
  }

  // otherwise allow request
  return NextResponse.next();
}

// Optional: only run middleware on some paths to reduce overhead.
export const config = {
  matcher: ["/dispatch/:path*", "/admin/:path*", "/dash/:path*"],
};
