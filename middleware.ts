// middleware.ts (root)
import { auth } from "./auth"; // <- from your root `auth.ts`

// Only protect the routes we care about
const protectedPrefixes = [
  "/driver",
  "/rider",
  "/profile",
  "/wallet",
  "/vendor-orders",
  "/request",
  "/history",
  "/dispatch",
  "/admin",
];

export default auth((req) => {
  const { nextUrl } = req;
  const url = nextUrl.clone();

  const pathname = nextUrl.pathname;
  const isLoggedIn = !!req.auth;

  // Never touch NextAuth endpoints or static assets
  // (this also prevents loops)
  // NOTE: The matcher below also excludes these, but having this guard is cheap insurance.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|css|js|txt|map)$/)
  ) {
    return;
  }

  // Treat these as "auth pages" so we don't redirect while already on them
  const isAuthPage =
    pathname === "/auth/login" ||
    pathname === "/auth/signin" ||
    pathname === "/auth/callback" ||
    pathname.startsWith("/api/auth/signin");

  // 1) If an auth page and already logged in -> go home
  if (isAuthPage && isLoggedIn) {
    url.pathname = "/";
    return Response.redirect(url);
  }

  // 2) If a protected route and not logged in -> send to Google sign-in
  const needsAuth = protectedPrefixes.some((p) => pathname.startsWith(p));
  if (needsAuth && !isLoggedIn) {
    url.pathname = "/api/auth/signin";
    url.searchParams.set("provider", "google");
    // Optional: remember where the user was going
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return Response.redirect(url);
  }

  // otherwise, continue
});

// IMPORTANT: exclude auth & static from being matched at all
export const config = {
  matcher: [
    // Everything except:
    // - /api/auth
    // - /_next/static, /_next/image
    // - /favicon.ico and any file with an extension
    "/((?!api/auth|_next/static|_next/image|favicon\\.ico|.*\\..*$).*)",
  ],
};
