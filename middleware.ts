// middleware.ts - JRide auth middleware (NextAuth v5)

export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    // Protect everything EXCEPT:
    // - NextAuth auth/api routes
    // - static assets
    // - favicon
    // - any file with an extension (e.g. .css, .js, .png)
    "/((?!api/auth|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
