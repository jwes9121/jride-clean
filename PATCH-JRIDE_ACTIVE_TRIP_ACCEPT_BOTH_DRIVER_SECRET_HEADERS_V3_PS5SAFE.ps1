param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

Write-Host "== JRIDE Patch: active-trip accept both driver secret headers (V3 / PS5-safe) =="
Write-Host "Root: $ProjRoot"

function Read-TextUtf8 {
  param([Parameter(Mandatory=$true)][string]$Path)
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-TextUtf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and !(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  if (!(Test-Path -LiteralPath $Path)) {
    throw "Missing file: $Path"
  }
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  if (!(Test-Path -LiteralPath $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($Path)
  $bak = Join-Path $bakDir ($name + ".bak." + $Tag + "." + $stamp)
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Replace-Exact {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Old,
    [Parameter(Mandatory=$true)][string]$New,
    [Parameter(Mandatory=$true)][string]$Label
  )

  $content = Read-TextUtf8 -Path $Path
  if ($content.IndexOf($Old) -lt 0) {
    throw "Anchor not found for $Label in $Path"
  }

  $updated = $content.Replace($Old, $New)
  if ($updated -eq $content) {
    throw "Replacement produced no change for $Label in $Path"
  }

  Write-TextUtf8NoBom -Path $Path -Content $updated
  Write-Host "[OK] Patched: $Label"
}

$routePath = Join-Path $ProjRoot "app\api\driver\active-trip\route.ts"
Backup-File -Path $routePath -Tag "ACTIVE_TRIP_BOTH_DRIVER_SECRET_HEADERS_V3"

$oldAllow = @'
function allow(req: Request) {
  // Recommended: protect with DRIVER_PING_SECRET (already in your Vercel env)
  const want = String(process.env.DRIVER_PING_SECRET || "").trim();
  const got = String(req.headers.get("x-driver-ping-secret") || "").trim();
  if (!want) return true; // if not set, allow (dev)
  return Boolean(got) && got === want;
}
'@

$newAllow = @'
function allow(req: Request) {
  // Accept both legacy and current driver-secret headers.
  const want = String(
    process.env.DRIVER_PING_SECRET ||
    process.env.JRIDE_DRIVER_SECRET ||
    ""
  ).trim();

  const got = String(
    req.headers.get("x-driver-ping-secret") ||
    req.headers.get("x-jride-driver-secret") ||
    ""
  ).trim();

  if (!want) return true; // if not set, allow (dev)
  return Boolean(got) && got === want;
}
'@

Replace-Exact -Path $routePath -Old $oldAllow -New $newAllow -Label "Allow both driver secret headers"

Write-Host "[DONE] Patch applied."