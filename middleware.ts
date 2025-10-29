import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "./auth"; // <-- root-relative

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

  const needsAuth = protectedPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (!needsAuth) {
    return NextResponse.next();
  }

  const session = await auth();

  if (!session?.user) {
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/auth|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
