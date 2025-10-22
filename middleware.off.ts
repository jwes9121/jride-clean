// middleware.ts
export { auth as middleware } from "@/auth";

export const config = {
  // Only protect real app areas; DO NOT match /auth or /api/auth
  matcher: [
    "/driver/:path*",
    "/rider/:path*",
    "/profile/:path*",
    "/wallet/:path*",
    "/request/:path*",
  ],
};
