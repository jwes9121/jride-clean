import { auth } from "./auth";
import { NextResponse } from "next/server";

export async function middleware(req: Request) {
  const url = new URL(req.url);
  const { pathname } = url;

  // Public paths that should not force login
  const publicPaths = [
    "/",
    "/auth/signin",
    "/auth/error",
  ];

  // Always allow:
  // - Next.js internals / static assets
  // - favicon / file assets
  // - auth pages
  // - next-auth API
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth") ||
    pathname.match(/\.(.*)$/) || // any file with extension (.png .ico .js .css etc)
    publicPaths.includes(pathname)
  ) {
    return NextResponse.next();
  }

  // Routes that REQUIRE authentication
  const requiresAuth =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dispatcher") ||
    pathname.startsWith("/dashboard");

  // If not protected, allow through
  if (!requiresAuth) {
    return NextResponse.next();
  }

  // Check active session
  const session = await auth();

  // If no session, bounce to /auth/signin and preserve original target
  if (!session) {
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // (Optional) example role gate (leave commented until you're ready)
  // if (pathname.startsWith("/admin")) {
  //   const role = (session.user as any)?.role;
  //   if (role !== "admin") {
 //     return NextResponse.redirect(new URL("/", req.url));
 //   }
  // }

  return NextResponse.next();
}

// IMPORTANT: exclude auth + static so we don't trigger infinite loops
export const config = {
  matcher: [
    "/((?!_next/|api/auth|auth|favicon.ico|.*\\..*).*)",
  ],
};
