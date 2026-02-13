# PATCH-JRIDE_VENDOR_LANDING_FIX_V1.ps1
# Creates app/vendor/page.tsx (redirect to /vendor-orders) and fixes middleware.ts (remove deprecated throw)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bakDir = Join-Path $root "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

Ok "== JRide Patch: Vendor landing + middleware fix (V1) =="
Info ("Repo root: {0}" -f $root)

# --- 1) Ensure app/vendor/page.tsx exists and redirects to /vendor-orders ---
$vendorDir = Join-Path $root "app\vendor"
$vendorPage = Join-Path $vendorDir "page.tsx"

New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null

if (Test-Path $vendorPage) {
  $bak = Join-Path $bakDir ("app_vendor_page.tsx.bak.{0}" -f $ts)
  Copy-Item -Force $vendorPage $bak
  Warn ("[BACKUP] Existing vendor page backed up to: {0}" -f $bak)
} else {
  Info "[INFO] app/vendor/page.tsx does not exist; will create it."
}

$vendorPageContent = @'
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default function VendorLanding(props: { searchParams?: SP }) {
  const sp = props?.searchParams || {};
  const raw = sp["vendor_id"];
  const vendorId = typeof raw === "string" ? raw.trim() : "";
  if (vendorId) {
    redirect(`/vendor-orders?vendor_id=${encodeURIComponent(vendorId)}`);
  }
  redirect("/vendor-orders");
}
'@

Set-Content -Path $vendorPage -Value $vendorPageContent -Encoding UTF8
Ok ("[OK] Wrote: {0}" -f $vendorPage)

# --- 2) Fix middleware.ts (remove deprecated throw stub) ---
$mwPath = Join-Path $root "middleware.ts"
if (Test-Path $mwPath) {
  $mwBak = Join-Path $bakDir ("middleware.ts.bak.{0}" -f $ts)
  Copy-Item -Force $mwPath $mwBak
  Ok ("[OK] Backup: {0}" -f $mwBak)
} else {
  Warn "[WARN] middleware.ts not found. Creating a new one."
}

$mwContent = @'
import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Safe NextAuth v5 middleware (no crash, no vendor blocking)
 * - Allows public + Next internals
 * - Enforces auth ONLY on /admin and /dispatcher (adjust later if needed)
 */
export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname || "/";

  // Always allow Next internals + static files
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Protect only admin/dispatcher areas (keep vendor free for now)
  if (pathname.startsWith("/admin") || pathname.startsWith("/dispatcher")) {
    if (!req.auth?.user) {
      const url = new URL("/auth/signin", nextUrl);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
'@

Set-Content -Path $mwPath -Value $mwContent -Encoding UTF8
Ok ("[OK] Patched: {0}" -f $mwPath)

Ok ""
Ok "NEXT: run a build to confirm."
