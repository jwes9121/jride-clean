import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "./auth";

/**
 * JRIDE_PHASE12_HARD_ROLE_ENFORCEMENT_V1
 *
 * HARD RULES:
 * - DO NOT BLOCK /api/* (matcher excludes api)
 * - NO mutations, NO DB changes, NO UI changes
 *
 * Role enforcement:
 * - admin: allow all /admin/*
 * - dispatcher: allow only:
 *   /admin/livetrips
 *   /admin/trips/at-risk
 *   /admin/ops/*
 *   /admin/audit
 *   /admin/control-center
 *
 * Role source:
 * - session.user.role (set in auth.ts callbacks via email allowlists)
 * - Defaults to admin if not present (fail-open)
 */

function getRole(req: any): "admin" | "dispatcher" {
  const r = String(req?.auth?.user?.role || "").toLowerCase().trim();
  if (r === "dispatcher") return "dispatcher";
  return "admin";
}

function isAdminPath(p: string) {
  return p === "/admin" || p.startsWith("/admin/");
}

function dispatcherAllowed(p: string) {
  if (p === "/admin" || p === "/admin/control-center") return true;
  if (p === "/admin/livetrips" || p.startsWith("/admin/livetrips/")) return true;
  if (p === "/admin/trips/at-risk" || p.startsWith("/admin/trips/at-risk/")) return true;
  if (p === "/admin/audit" || p.startsWith("/admin/audit/")) return true;
  if (p.startsWith("/admin/ops/")) return true;
  return false;
}

export default auth((req: NextRequest & { auth?: any }) => {
  const p = req.nextUrl.pathname;

  // Middleware matcher already excludes /api/* and assets, but keep extra safety:
  if (p.startsWith("/api/") || p.startsWith("/_next/") || p === "/favicon.ico" || /\.[a-zA-Z0-9]+$/.test(p)) {
    return NextResponse.next();
  }

  // Only enforce inside /admin/*
  if (!isAdminPath(p)) return NextResponse.next();

  // If not authenticated, redirect to sign-in with callback
  const isAuthed = !!req.auth?.user;
  if (!isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/signin";
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + (req.nextUrl.search || ""));
    return NextResponse.redirect(url);
  }

  const role = getRole(req);

  // Admin: everything allowed
  if (role === "admin") return NextResponse.next();

  // Dispatcher: enforce allowlist
  if (role === "dispatcher") {
    if (dispatcherAllowed(p)) return NextResponse.next();

    // Deny: redirect to control-center with context
    const url = req.nextUrl.clone();
    url.pathname = "/admin/control-center";
    url.searchParams.set("denied", "1");
    url.searchParams.set("from", p);
    return NextResponse.redirect(url);
  }

  // Default allow
  return NextResponse.next();
});

export const config = { matcher: ["/((?!api/auth|api/driver|api/live-location|_next/static|_next/image|favicon\.ico|.*\..*).*)"] };
