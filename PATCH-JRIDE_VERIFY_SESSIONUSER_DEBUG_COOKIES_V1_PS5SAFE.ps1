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
if(!(Test-Path -LiteralPath $apiRoute)){ throw "ROUTE_NOT_FOUND: $apiRoute" }

$rootAuth = Join-Path $ProjRoot "auth.ts"
if(!(Test-Path -LiteralPath $rootAuth)){ throw "ROOT_AUTH_NOT_FOUND: $rootAuth" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
EnsureDir $bakDir
$ts = Stamp
$bak = Join-Path $bakDir ("route.ts.bak.VERIFY_SESSIONUSER_DEBUG_COOKIES_V1.$ts")
Copy-Item -LiteralPath $apiRoute -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$content = @'
import { NextResponse } from "next/server";
import { auth } from "../../../../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cookieNames(cookieHeader: string | null) {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split("=")[0])
    .slice(0, 50);
}

// NextAuth v5 wrapper form
export const GET = auth(async (req) => {
  try {
    const cookieHeader = req.headers.get("cookie");
    const names = cookieNames(cookieHeader);

    const a: any = (req as any).auth;
    const email = a?.user?.email ?? null;
    const name = a?.user?.name ?? null;
    const userId = a?.user?.id ?? null;

    // This debug is safe (no cookie values)
    if (!email && !userId) {
      return NextResponse.json(
        {
          ok: false,
          reason: "no_session_identity",
          debug: {
            hasAuth: !!a,
            authKeys: a ? Object.keys(a) : [],
            userKeys: a?.user ? Object.keys(a.user) : [],
            cookieHeaderPresent: !!cookieHeader,
            cookieNames: names,
          },
        },
        { status: 200 }
      );
    }

    // For now just prove we can see identity
    return NextResponse.json(
      {
        ok: true,
        identity: {
          email,
          namePresent: !!name,
          userIdPresent: !!userId,
        },
        debug: {
          cookieHeaderPresent: !!cookieHeader,
          cookieNames: names,
        },
      },
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
Write-Host "[DONE] VERIFY_SESSIONUSER_DEBUG_COOKIES_V1 applied."