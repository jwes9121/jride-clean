export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    // Run on everything except Next.js assets and images
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
