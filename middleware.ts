export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    "/driver/:path*",
    "/rider/:path*",
    "/profile/:path*",
    "/wallet/:path*",
    "/request/:path*",
  ],
};
