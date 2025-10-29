import { NextResponse } from "next/server";
import { auth } from "./auth";

const PROTECTED_PREFIXES = ["/dispatch", "/admin", "/dash"];
const AUTH_BYPASS_PREFIXES = ["/api/auth", "/auth/signin", "/auth/error", "/auth/callback"];

function requiredRoleForPath(pathname: string): "admin" | "dispatcher" | "user" {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/dispatch")) return "dispatcher";
  if (pathname.startsWith("/dash")) return "user";
  return "user";
}

export default async function middleware(req: Request) {
  const { pathname } = new URL(req.url);

  if (AUTH_BYPASS_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();

  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/auth/signin", req.url));

  const userRole = (session.user as any).role ?? "user";
  const needRole = requiredRoleForPath(pathname);

  const ok =
    needRole === "user" ||
    (needRole === "dispatcher" && (userRole === "dispatcher" || userRole === "admin")) ||
    (needRole === "admin" && userRole === "admin");

  if (!ok) return NextResponse.redirect(new URL("/dispatch", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dispatch",
    "/dispatch/:path*",
    "/admin",
    "/admin/:path*",
    "/dash",
    "/dash/:path*",
  ],
};
