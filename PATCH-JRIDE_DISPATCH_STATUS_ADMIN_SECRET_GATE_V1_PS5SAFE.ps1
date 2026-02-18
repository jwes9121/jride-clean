param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Backup-File([string]$Path, [string]$Tag) {
  if (!(Test-Path $Path)) { return }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path $Path -Leaf
  $bak = Join-Path $bakDir ("{0}.bak.{1}.{2}" -f $name, $Tag, $ts)
  Copy-Item -Force $Path $bak
  Write-Host "[OK] Backup: $bak"
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Host "== PATCH JRIDE dispatch/status admin-secret gate (V1 / PS5-safe) =="
Write-Host "Repo: $ProjRoot"

$path = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path $path)) { throw "Missing: $path" }

Backup-File $path "DISPATCH_STATUS_ADMIN_SECRET_GATE_V1"
$src = Get-Content -Raw -LiteralPath $path

# If already present, skip
if ($src -match "JRIDE_ADMIN_SECRET_GATE_V1") {
  Write-Host "[SKIP] Admin secret gate already present"
  exit 0
}

# Insert right after supabase client init (first occurrence)
$clientInitPattern = 'const\s+supabase\s*=\s*(createClient|createRouteHandlerClient|createServerClient)\s*\([^;]*\);\s*'
if ($src -notmatch $clientInitPattern) {
  throw "Could not find supabase client initialization line to anchor gate insertion."
}

$gate = @"
  // JRIDE_ADMIN_SECRET_GATE_V1
  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret =
    String(req.headers.get("x-jride-admin-secret") || req.headers.get("x-admin-secret") || "").trim();

  const adminSecretOk = Boolean(wantSecret) && Boolean(gotSecret) && gotSecret === wantSecret;

  let actorUserId: string | null = null;

  if (!adminSecretOk) {
    try {
      const { data } = await supabase.auth.getUser();
      actorUserId = data?.user?.id ?? null;
    } catch {
      actorUserId = null;
    }
    if (!actorUserId) {
      return jsonErr("UNAUTHORIZED", "Not authenticated", 401);
    }
  }
"@

$src2 = [regex]::Replace($src, $clientInitPattern, { param($m) $m.Value + "`n" + $gate + "`n" }, 1)

Write-Utf8NoBom -Path $path -Content $src2
Write-Host "[OK] Patched: $path"
Write-Host ""
Write-Host "[NEXT] Build:"
Write-Host "  npm.cmd run build"
