// middleware.ts – allow NextAuth routes and protect only app pages

export { auth as middleware } from ""@/auth"";

export const config = {
  matcher: [
    // Protect everything EXCEPT:
    // - /api/auth/* (NextAuth)
    // - /auth/*    (sign-in page)
    // - static assets & files with extensions
    ""/((?!api/auth|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"",
  ],
};
