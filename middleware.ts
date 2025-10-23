// middleware.ts (safe)
import { auth } from "./auth";

export default auth((req) => {
  const p = req.nextUrl.pathname;
  if (
    p.startsWith("/api/auth") ||
    p.startsWith("/auth") ||
    p.startsWith("/_next") ||
    p === "/favicon.ico" ||
    /\.[a-zA-Z0-9]+$/.test(p)
  ) {
    return;
  }
});

export const config = {
  matcher: ["/admin/:path*", "/dispatcher/:path*", "/dashboard/:path*", "/vendor/:path*"],
};
