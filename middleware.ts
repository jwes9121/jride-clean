// middleware.ts – allow NextAuth routes and protect only app pages

export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
