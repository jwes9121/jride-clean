// middleware.ts (safe)
import { auth } from "./auth";

export default auth((req) => {
  const p = req.nextUrl.pathname;

  // Always allow NextAuth + public + static
  if (
    p.startsWith("/api/auth") ||
    p.startsWith("/auth") ||
    p.startsWith("/_next") ||
    p === "/favicon.ico" ||
    /\.[a-zA-Z0-9]+$/.test(p)
  ) {
    return;
  }

  // Do NOT redirect here. Let pages handle access.
});

// Only apply middleware to sections you actually want guarded.
// Avoid guarding '/', '/auth', '/api/auth', and static.
export const config = {
  matcher: [
    "/admin/:path*",
    "/dispatcher/:path*",
    "/dashboard/:path*",
    "/vendor/:path*",
  ],
};
