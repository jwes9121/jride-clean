// middleware.ts
import { auth } from "./auth";
import { NextResponse } from "next/server";

export async function middleware(req: Request) {
  const url = new URL(req.url);
  const { pathname } = url;

  // 1. Public paths that should NEVER trigger auth
  const publicPaths = [
    "/",
    "/auth/signin",
    "/auth/error",
  ];

  // 2. Always allow these patterns:
  // - Next.js internal assets
  // - static files
  // - favicon
  // - auth routes
  // - api/auth routes
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth") ||
    pathname.match(/\.(.*)$/) || // any file with an extension, e.g. .png .ico .js .css
    publicPaths.includes(pathname)
  ) {
    return NextResponse.next();
  }

  // 3. Protect admin/dashboard routes
  // (You can add more prefixes here if needed)
  const requiresAuth =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dispatcher") ||
    pathname.startsWith("/dashboard");

  if (!requiresAuth) {
    // not protected, just continue
    return NextResponse.next();
  }

  // 4. For protected routes, check session
  const session = await auth();

  if (!session) {
    // no session → send them to sign-in page IN THE SAME HOST
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // (Optional) role-based gate:
  // if (pathname.startsWith("/admin") && (session.user as any).role !== "admin") {
  //   return NextResponse.redirect(new URL("/", req.url));
  // }

  return NextResponse.next();
}

// VERY IMPORTANT
export const config = {
  matcher: [
    // run middleware for everything EXCEPT the stuff we declared above
    "/((?!_next/|api/auth|auth|favicon.ico|.*\\..*).*)",
  ],
};
