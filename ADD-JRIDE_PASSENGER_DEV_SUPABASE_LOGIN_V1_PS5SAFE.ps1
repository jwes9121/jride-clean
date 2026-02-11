$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK]  $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

function Find-RepoRoot([string]$StartDir){
  $dir = Resolve-Path -LiteralPath $StartDir
  while($true){
    $pkg = Join-Path -Path $dir -ChildPath "package.json"
    if(Test-Path -LiteralPath $pkg){ return $dir.Path }
    $parent = Split-Path -Path $dir -Parent
    if(-not $parent -or $parent -eq $dir.Path){ break }
    $dir = $parent
  }
  throw "Could not find repo root (package.json) from: $StartDir"
}

Write-Host "== JRide: Add Passenger Dev Supabase Login API (V1 / PS5-safe) =="

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Find-RepoRoot $scriptDir
Ok "RepoRoot: $repoRoot"

$relDir = "app\api\public\passenger\dev-login"
$dir = Join-Path -Path $repoRoot -ChildPath $relDir
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Ok "Dir: $dir"

$target = Join-Path -Path $dir -ChildPath "route.ts"

# route.ts contents (dev only). Requires env: JRIDE_DEV_PASSENGER_EMAIL / JRIDE_DEV_PASSENGER_PASSWORD
$code = @'
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  // DEV ONLY: require explicit env flag
  const devEnabled = process.env.JRIDE_DEV_PASSENGER_LOGIN === "1";
  if (!devEnabled) {
    return NextResponse.json({ ok: false, error: "DEV_LOGIN_DISABLED" }, { status: 404 });
  }

  const email = process.env.JRIDE_DEV_PASSENGER_EMAIL || "";
  const password = process.env.JRIDE_DEV_PASSENGER_PASSWORD || "";
  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "MISSING_DEV_CREDENTIALS", need: ["JRIDE_DEV_PASSENGER_EMAIL", "JRIDE_DEV_PASSENGER_PASSWORD"] },
      { status: 500 }
    );
  }

  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ ok: false, error: "SIGNIN_FAILED", details: error.message }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    user_id: data.user?.id ?? null,
    email: data.user?.email ?? null,
    note: "Supabase session cookie should now be set for this browser.",
  });
}
'@

Set-Content -LiteralPath $target -Value $code -Encoding UTF8
Ok "Wrote: $target"

Ok "DONE. Next: set env vars, run dev, POST /api/public/passenger/dev-login, then re-check /can-book."
