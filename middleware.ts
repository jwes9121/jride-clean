import { NextResponse } from "next/server";

export function middleware() {
  // No CSP headers here; just pass through
  return NextResponse.next();
}

// Keep auth/static/images unprotected to avoid loops
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|auth|.*\\..*).*)"],
};