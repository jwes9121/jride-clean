# PATCH-JRIDE_PUBLIC_AUTH_SESSION_SSR_V2_PS5SAFE.ps1
# Goal:
# - Replace app/api/public/auth/session/route.ts with an SSR-cookie based version
# - Fix build error: NextResponse.json only supports 1-2 args (headers must be inside init)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

Write-Host "== JRide Patch: Public Auth Session (SSR-cookie) V2 / PS5-safe ==" -ForegroundColor Cyan

$RepoRoot = (Get-Location).Path
if (!(Test-Path (Join-Path $RepoRoot "app"))) { Die "Run this from repo root (folder containing /app)." }

$Target = Join-Path $RepoRoot "app\api\public\auth\session\route.ts"
if (!(Test-Path $Target)) { Die "Missing target: $Target" }

$BakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $BakDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $BakDir ("route.ts.bak.{0}" -f $Stamp)
Copy-Item $Target $Backup -Force
Ok "[OK] Backup: $Backup"

# SSR-cookie based session route (must match can-book's createClient() auth path)
# NOTE: No secrets, no token echoes.
$NewContent = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  try {
    const supabase = createClient();

    const { data, error } = await supabase.auth.getUser();
    const user = data?.user ?? null;

    const headers = { "Cache-Control": "no-store, max-age=0" };

    if (error || !user) {
      return NextResponse.json(
        { ok: true, authed: false },
        { status: 200, headers }
      );
    }

    const role = (user.user_metadata as any)?.role ?? null;

    return NextResponse.json(
      {
        ok: true,
        authed: true,
        role,
        user: {
          id: user.id,
          email: user.email ?? null,
          phone: (user as any).phone ?? null
        }
      },
      { status: 200, headers }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "SESSION_ROUTE_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
'@

# Write UTF8 (no BOM) to avoid weird TS/Next parsing issues
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Target, $NewContent, $Utf8NoBom)

Ok "[OK] Patched: $Target"
Ok "[OK] DONE. Next: npm.cmd run build"
