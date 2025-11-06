import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}

// Exclude API/auth/static/assets from protection.
// Your app pages remain guardable as you wish.
export const config = {
  matcher: [
    "/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
