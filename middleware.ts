// middleware.ts
export { default } from "next-auth/middleware";

export const config = {
  // protect everything except Next.js assets and NextAuth endpoints
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/_diag).*)",
  ],
};
