param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function EnsureDir([string]$p){ if(!(Test-Path -LiteralPath $p)){ New-Item -ItemType Directory -Path $p | Out-Null } }
function WriteUtf8NoBom([string]$Path,[string]$Content){
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path,$Content,$utf8NoBom)
}

$apiRoute = Join-Path $ProjRoot "app\api\verify\session-user\route.ts"
if(!(Test-Path -LiteralPath $apiRoute)){
  throw "ROUTE_NOT_FOUND: $apiRoute"
}

$rootAuth = Join-Path $ProjRoot "auth.ts"
if(!(Test-Path -LiteralPath $rootAuth)){
  throw "ROOT_AUTH_NOT_FOUND: expected $rootAuth"
}

$bakDir = Join-Path $ProjRoot "_patch_bak"
EnsureDir $bakDir
$ts = Stamp
$bak = Join-Path $bakDir ("route.ts.bak.VERIFY_SESSIONUSER_AUTH_WRAPPER_V1.$ts")
Copy-Item -LiteralPath $apiRoute -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

# NOTE:
# route.ts is app/api/verify/session-user/route.ts
# root auth.ts is at /auth.ts
# correct relative path: ../../../../auth
$content = @'
import { NextResponse } from "next/server";
import { auth } from "../../../../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Use NextAuth v5 wrapper form so cookies from THIS request are used
export const GET = auth(async (req) => {
  try {
    const email = (req as any)?.auth?.user?.email ?? null;

    if (!email) {
      return NextResponse.json(
        {
          ok: false,
          reason: "no_session_email",
          debug: {
            hasAuth: !!(req as any)?.auth,
            authKeys: (req as any)?.auth ? Object.keys((req as any).auth) : [],
            userKeys: (req as any)?.auth?.user ? Object.keys((req as any).auth.user) : [],
          },
        },
        { status: 200 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRole) {
      return NextResponse.json(
        {
          ok: false,
          reason: "missing_env",
          needs: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
        },
        { status: 200 }
      );
    }

    // Supabase Auth Admin API: list users, match by email
    const adminUrl = `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`;
    const ar = await fetch(adminUrl, {
      method: "GET",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!ar.ok) {
      const t = await ar.text();
      return NextResponse.json(
        { ok: false, reason: "admin_api_error", status: ar.status, body: t },
        { status: 200 }
      );
    }

    const users = await ar.json();
    const arr = Array.isArray(users) ? users : (users?.users || []);
    const u = Array.isArray(arr)
      ? arr.find((x: any) => (x?.email || "").toLowerCase() === String(email).toLowerCase())
      : null;

    if (!u?.id) {
      return NextResponse.json(
        { ok: false, reason: "no_supabase_user_for_email", email },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: true, email, supabase_user_id: u.id },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, reason: "exception", message: String(e?.message || e) },
      { status: 200 }
    );
  }
});
'@

WriteUtf8NoBom $apiRoute $content
Write-Host "[OK] Patched: $apiRoute"
Write-Host "[DONE] VERIFY_SESSIONUSER_AUTH_WRAPPER_V1 applied."