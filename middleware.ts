export { auth as middleware } from "@/auth";

// Only protect real app sections; DO NOT include `/` or `/api/auth/*`
export const config = {
  matcher: [
    "/driver/:path*",
    "/rider/:path*",
    "/profile/:path*",
    "/wallet/:path*",
    "/request/:path*",
  ],
};
