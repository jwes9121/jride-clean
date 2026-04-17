import { NextResponse } from "next/server";
import { auth } from "./auth";

export default auth((req) => {
  const pathname = req.nextUrl.pathname;
  const session = req.auth;
  const sessionUser = (session?.user ?? null) as any;
  const role = String(sessionUser?.role || "").toLowerCase();

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  if (!sessionUser) {
    const loginUrl = new URL("/staff/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (role !== "admin" && role !== "dispatcher") {
    const deniedUrl = new URL("/staff/login", req.nextUrl.origin);
    deniedUrl.searchParams.set("error", "forbidden");
    return NextResponse.redirect(deniedUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
