// middleware.ts (PERMANENT)
import { auth } from "./auth";

export default auth((req) => {
  const p = req.nextUrl.pathname;

  // Always allow NextAuth and static
  if (
    p.startsWith("/api/auth") ||
    p.startsWith("/auth") ||
    p.startsWith("/_next") ||
    p === "/favicon.ico" ||
    /\.[a-zA-Z0-9]+$/.test(p) // static files
  ) {
    return;
  }

  // If you want to protect only specific areas, list them:
  // if (p.startsWith("/admin") || p.startsWith("/dispatcher")) {
  //   // leaving empty lets NextAuth handle protection
  //   return;
  // }

  // Don’t auto-redirect here; let pages handle it.
});

export const config = {
  // Exclude NextAuth + static explicitly
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
