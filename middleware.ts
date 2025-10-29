import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "./auth";

// define which pages require login
const protectedPaths = [
  "/",
  "/dashboard",
  "/dispatch",
  "/admin",
  "/admin/livetrips",
  "/admin/verification",
  "/whoami",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // does this path need auth?
  const needsAuth = protectedPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (!needsAuth) {
    // public route, let it through
    return NextResponse.next();
  }

  // check session via NextAuth v5
  const session = await auth();

  if (!session?.user) {
    // not logged in -> go to signin (public), not loop
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(signInUrl);
  }

  // logged in, pass through
  return NextResponse.next();
}

// IMPORTANT: exclude auth-related and static stuff
export const config = {
  matcher: [
    "/((?!api/auth|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
