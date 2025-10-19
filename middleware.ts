export { auth as middleware } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dispatch/:path*",   // add any sections that must be logged-in
    "/admin/:path*",
  ],
};
