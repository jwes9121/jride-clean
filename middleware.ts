export { auth as middleware } from "./auth";

// Only run where we actually need checks
export const config = {
  matcher: [
    "/admin/:path*",
    "/dispatch/:path*",
    "/driver/:path*",
    // add more private areas if needed
  ],
};
