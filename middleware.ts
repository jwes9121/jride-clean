export { auth as middleware } from "@/auth";

// Only protect the signed-in areas.
// Do NOT include `/`, `/api/auth/*`, or any auth pages here.
export const config = {
  matcher: [
    "/driver/:path*",
    "/rider/:path*",
    "/profile/:path*",
    "/wallet/:path*",
    "/request/:path*",
  ],
};
