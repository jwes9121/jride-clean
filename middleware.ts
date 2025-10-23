// middleware.ts  (App Router + NextAuth v5)
export { auth as middleware } from "@/auth";

// Do NOT match NextAuth endpoints or static files or your public auth pages
export const config = {
  matcher: [
    // protect everything except:
    // - /api/auth/* (next-auth handlers)
    // - /auth/*     (your own login/signup pages)
    // - _next assets, favicon, and any file with an extension
    "/((?!api/auth|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
