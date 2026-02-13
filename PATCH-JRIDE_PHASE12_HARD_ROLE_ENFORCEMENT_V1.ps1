$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
$ts = Timestamp

function Ensure-Dir($p) { if (!(Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }

function Backup-IfExists($path) {
  if (Test-Path $path) {
    $bak = "$path.bak.$ts"
    Copy-Item -Force $path $bak
    Write-Host "[OK] Backup: $bak"
  }
}

function Write-Utf8NoBom($path, $content) {
  Ensure-Dir (Split-Path -Parent $path)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  Write-Host "[OK] Wrote: $path"
}

function Fail($m) { throw $m }

$root = (Get-Location).Path

$authTs = Join-Path $root "auth.ts"
$mwTs   = Join-Path $root "middleware.ts"

if (!(Test-Path $authTs)) { Fail "Missing file: $authTs" }
if (!(Test-Path $mwTs))   { Fail "Missing file: $mwTs" }

Backup-IfExists $authTs
Backup-IfExists $mwTs

# ----------------------------
# auth.ts
# - Adds JWT + session callbacks to attach role (admin/dispatcher)
# - Role source: email allowlist env vars (NO DB, NO schema)
# Env vars:
#   JRIDE_ADMIN_EMAILS="a@x.com,b@y.com"
#   JRIDE_DISPATCHER_EMAILS="d@x.com,e@y.com"
# If none set: defaults to "admin" (fail-open to avoid lockouts)
# ----------------------------
$authContent = @'
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

function parseEmailList(s?: string | null) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function roleFromEmail(email?: string | null): "admin" | "dispatcher" {
  const e = String(email || "").toLowerCase().trim();

  const admins = parseEmailList(process.env.JRIDE_ADMIN_EMAILS || process.env.ADMIN_EMAILS);
  const dispatchers = parseEmailList(process.env.JRIDE_DISPATCHER_EMAILS || process.env.DISPATCHER_EMAILS);

  // Priority: explicit lists
  if (e && dispatchers.includes(e)) return "dispatcher";
  if (e && admins.includes(e)) return "admin";

  // Default: admin (fail-open to prevent accidental lockout)
  return "admin";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },

  callbacks: {
    async jwt({ token }) {
      // Attach role based on email allowlists (no DB)
      const email = (token && (token.email as any)) ? String(token.email) : "";
      (token as any).role = roleFromEmail(email);
      return token;
    },

    async session({ session, token }) {
      // Expose role to session.user.role for UI and middleware
      const role = (token as any)?.role || "admin";
      (session as any).user = (session as any).user || {};
      (session as any).user.role = role;
      return session;
    },
  },
});
'@

Write-Utf8NoBom $authTs $authContent

# ----------------------------
# middleware.ts
# - Uses NextAuth v5 auth() wrapper to get req.auth
# - Enforces role access ONLY for /admin/*
# - Does NOT touch /api/* (matcher excludes api)
# - Dispatcher allowlist is route-prefix based
# ----------------------------
$mwContent = @'
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

export const config = {
  // Keep your safe matcher: never touch /api/*, next assets, favicon, or files
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
'@

Write-Utf8NoBom $mwTs $mwContent

Write-Host ""
Write-Host "[DONE] PHASE12: Hard role enforcement installed (auth.ts callbacks + middleware route gating)."
Write-Host ""
Write-Host "IMPORTANT: Set env vars to define who is dispatcher/admin:"
Write-Host "  JRIDE_ADMIN_EMAILS=""admin1@gmail.com,admin2@gmail.com"""
Write-Host "  JRIDE_DISPATCHER_EMAILS=""dispatcher1@gmail.com,dispatcher2@gmail.com"""
Write-Host "If unset, role defaults to admin (fail-open) to avoid lockouts."
