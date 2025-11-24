// middleware.ts – protect only app pages, never /api/auth

import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  // You can add extra protection later if needed.
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Protect everything under /admin and /dispatch, etc. if you want:
    // "/admin/:path*",
    // "/dispatch/:path*",
    // But NEVER block auth or static assets:
    "/((?!api/auth|_next/static|_next/image|favicon.ico|auth/error).*)",
  ],
};

