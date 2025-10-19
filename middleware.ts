// middleware.ts
export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    // protect real pages, but don't run on next assets or auth endpoints
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/_diag).*)",
  ],
};

