import { auth } from "./auth";

export default auth((req) => {
  // Public / allowed paths
  if (
    req.nextUrl.pathname.startsWith("/api/auth") ||
    req.nextUrl.pathname.startsWith("/auth") ||
    req.nextUrl.pathname.startsWith("/_next") ||
    req.nextUrl.pathname.startsWith("/favicon.ico") ||
    /\.[a-zA-Z0-9]+$/.test(req.nextUrl.pathname) // static files
  ) {
    return;
  }
  // No custom redirects here; let NextAuth do its thing.
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
