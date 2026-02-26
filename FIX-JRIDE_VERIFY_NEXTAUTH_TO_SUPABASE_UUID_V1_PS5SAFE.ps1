param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp() { Get-Date -Format "yyyyMMdd_HHmmss" }

function EnsureDir([string]$p) {
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function WriteUtf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$ts = Stamp
$bakDir = Join-Path $ProjRoot "_patch_bak"
EnsureDir $bakDir

# Paths
$verifyPath = Join-Path $ProjRoot "app\verify\page.tsx"
$verificationPath = Join-Path $ProjRoot "app\verification\page.tsx"
$apiDir = Join-Path $ProjRoot "app\api\verify\session-user"
$apiRoute = Join-Path $apiDir "route.ts"

if (!(Test-Path -LiteralPath $verifyPath)) {
  throw "VERIFY_PAGE_NOT_FOUND: $verifyPath"
}

# Backup existing files
Copy-Item -LiteralPath $verifyPath -Destination (Join-Path $bakDir ("page.tsx.bak.VERIFY_NEXTAUTH_UUID_V1.$ts")) -Force
Write-Host ("[OK] Backup: " + (Join-Path $bakDir ("page.tsx.bak.VERIFY_NEXTAUTH_UUID_V1.$ts")))

if (Test-Path -LiteralPath $verificationPath) {
  Copy-Item -LiteralPath $verificationPath -Destination (Join-Path $bakDir ("page.tsx.bak.VERIFICATION_PAGE_V1.$ts")) -Force
  Write-Host ("[OK] Backup: " + (Join-Path $bakDir ("page.tsx.bak.VERIFICATION_PAGE_V1.$ts")))
}

# ------------------------------------------------------------
# A) Create API route: /api/verify/session-user
#    - reads NextAuth session (auth() from root auth.ts)
#    - resolves Supabase auth UUID by email via Supabase Admin API
# ------------------------------------------------------------
EnsureDir $apiDir

$apiContent = @'
import { NextResponse } from "next/server";
import { auth } from "../../../../auth";

export async function GET() {
  try {
    const session = await auth();
    const email = session?.user?.email || null;

    if (!email) {
      return NextResponse.json({ ok: false, reason: "no_session_email" }, { status: 200 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRole) {
      return NextResponse.json(
        { ok: false, reason: "missing_env", needs: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] },
        { status: 200 }
      );
    }

    // Supabase Admin API: list users, filter by email
    // Docs vary by project; this works for common Supabase Auth admin endpoint.
    const url = `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`;
    const r = await fetch(url, {
      method: "GET",
      headers: {
        "apikey": serviceRole,
        "Authorization": `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ ok: false, reason: "admin_api_error", status: r.status, body: t }, { status: 200 });
    }

    const users = await r.json();
    const arr = Array.isArray(users) ? users : (users?.users || []);
    const u = Array.isArray(arr) ? arr.find((x: any) => (x?.email || "").toLowerCase() === email.toLowerCase()) : null;

    if (!u?.id) {
      return NextResponse.json({ ok: false, reason: "no_supabase_user_for_email", email }, { status: 200 });
    }

    return NextResponse.json({ ok: true, email, supabase_user_id: u.id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, reason: "exception", message: String(e?.message || e) }, { status: 200 });
  }
}
'@

WriteUtf8NoBom $apiRoute $apiContent
Write-Host "[OK] Wrote: app/api/verify/session-user/route.ts"

# ------------------------------------------------------------
# B) Make /verification reuse /verify page (so passenger button works)
# ------------------------------------------------------------
EnsureDir (Join-Path $ProjRoot "app\verification")

$verificationContent = @'
export { default } from "../verify/page";
'@

WriteUtf8NoBom $verificationPath $verificationContent
Write-Host "[OK] Wrote: app/verification/page.tsx (re-export /verify)"

# ------------------------------------------------------------
# C) Patch /verify/page.tsx:
#    - add NextAuth->Supabase UUID resolver call on mount
#    - if found, setUserId(...) and setAuthUserPresent(true)
#    - keep existing logic as fallback
# ------------------------------------------------------------
$src = Get-Content -LiteralPath $verifyPath -Raw

# If already patched, avoid duplicate
if ($src -match "JRIDE_NEXTAUTH_SUPABASE_UUID_RESOLVER_V1") {
  Write-Host "[WARN] /verify already has resolver patch marker. No further changes."
  exit 0
}

# We inject a useEffect block right after the first useEffect import usage area by locating: "useEffect(() => {"
# If not found, we insert right after "export default function" opening brace.
$inject = @'

  // ===== JRIDE_NEXTAUTH_SUPABASE_UUID_RESOLVER_V1 =====
  useEffect(() => {
    let cancelled = false;

    async function resolveFromNextAuth() {
      try {
        // Resolve Supabase auth UUID using NextAuth session email (server-side lookup)
        const r = await fetch("/api/verify/session-user", { cache: "no-store" });
        const j = await r.json().catch(() => null);

        if (cancelled) return;

        if (j?.ok && j?.supabase_user_id) {
          setUserId(String(j.supabase_user_id));
          setAuthUserPresent(true);
          return;
        }
      } catch {
        // ignore, fallback to existing supabase.auth.getUser logic below
      }
    }

    resolveFromNextAuth();
    return () => { cancelled = true; };
  }, []);
  // ===== /JRIDE_NEXTAUTH_SUPABASE_UUID_RESOLVER_V1 =====

'@

$posUseEffect = $src.IndexOf("useEffect(() =>")
if ($posUseEffect -ge 0) {
  # insert before the first existing useEffect so resolver runs early
  $src = $src.Insert($posUseEffect, $inject)
  Write-Host "[OK] Inserted resolver useEffect before first existing useEffect()."
} else {
  $m = [regex]::Match($src, "export\s+default\s+function\s+[A-Za-z0-9_]*\s*\([^)]*\)\s*\{")
  if (-not $m.Success) {
    throw "PATCH_POINT_NOT_FOUND: could not find export default function to inject resolver."
  }
  $insertAt = $m.Index + $m.Length
  $src = $src.Insert($insertAt, $inject)
  Write-Host "[OK] Inserted resolver block at top of component."
}

WriteUtf8NoBom $verifyPath $src
Write-Host "[OK] Patched: app/verify/page.tsx (NextAuth->Supabase UUID resolver)"
Write-Host "[DONE] FIX-JRIDE_VERIFY_NEXTAUTH_TO_SUPABASE_UUID_V1 applied."