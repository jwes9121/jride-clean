// middleware.ts
export { default } from "next-auth/middleware";

/**
 * Only run the auth middleware on the routes that must be protected.
 * VERY IMPORTANT: This matcher does NOT include /auth or /api/auth,
 * so NextAuth's own pages and callbacks are never intercepted.
 */
export const config = {
  matcher: [
    "/admin/:path*",
    "/dispatch/:path*",
    "/delivery/:path*",
    "/bookings/:path*",
    // add any other *protected* app routes here
  ],
};
