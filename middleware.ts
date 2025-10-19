// middleware.ts
import { withAuth } from "next-auth/middleware";

/**
 * Protect ONLY the app areas that require auth.
 * NextAuth's own routes (/api/auth/*) are NOT matched here, so the OAuth flow works.
 */
export default withAuth({
  pages: {
    signIn: "/auth/signin",
  },
});

// Only run middleware on private sections of the site.
export const config = {
  matcher: [
    "/admin/:path*",
    "/dispatch/:path*",
    "/delivery/:path*",
    "/bookings/:path*",
  ],
};
