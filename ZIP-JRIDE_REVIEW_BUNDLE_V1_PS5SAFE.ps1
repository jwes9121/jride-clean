param(
  [Parameter(Mandatory=$true)][string]$ProjRoot,
  [string]$OutZip = "",
  [string[]]$IncludePaths = @(
    "app\api",
    "app\admin\livetrips",
    "auth.ts",
    "middleware.ts",
    "next.config.js",
    "package.json",
    "tsconfig.json"
  )
)

$ErrorActionPreference = "Stop"

function NowStamp { Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
if (!(Test-Path -LiteralPath (Join-Path $root "package.json"))) {
  throw "ProjRoot does not look like a Next.js repo (package.json not found): $root"
}

$stamp = NowStamp
if ([string]::IsNullOrWhiteSpace($OutZip)) {
  $OutZip = Join-Path $root ("JRIDE_REVIEW_BUNDLE_" + $stamp + ".zip")
} else {
  # allow relative OutZip
  if (-not [System.IO.Path]::IsPathRooted($OutZip)) {
    $OutZip = Join-Path $root $OutZip
  }
}

$stage = Join-Path $root ("_zip_stage_" + $stamp)
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Write-Host "== JRIDE Zip Review Bundle (V1 / PS5-safe) ==" -ForegroundColor Cyan
Write-Host "Repo: $root"
Write-Host "Stage: $stage"
Write-Host "OutZip: $OutZip"
Write-Host ""

# Exclusions (avoid huge/noisy folders)
$excludeDirs = @(
  "node_modules", ".next", ".git",
  "_diag_pack", "_diag_out", "_audit", "_patch_bak",
  "dist", "build", "out", "coverage"
)

function ShouldExcludePath([string]$fullPath) {
  foreach ($d in $excludeDirs) {
    if ($fullPath -match ("\\{0}(\\|$)" -f [regex]::Escape($d))) { return $true }
  }
  return $false
}

foreach ($rel in $IncludePaths) {
  $src = Join-Path $root $rel
  if (!(Test-Path -LiteralPath $src)) {
    Write-Host "[WARN] Missing: $rel" -ForegroundColor Yellow
    continue
  }

  if (ShouldExcludePath $src) {
    Write-Host "[SKIP] Excluded by rule: $rel" -ForegroundColor DarkYellow
    continue
  }

  $dest = Join-Path $stage $rel
  $destParent = Split-Path -Parent $dest
  New-Item -ItemType Directory -Force -Path $destParent | Out-Null

  if ((Get-Item -LiteralPath $src).PSIsContainer) {
    Write-Host "[ADD] Folder: $rel"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -LiteralPath $src -Destination $destParent -Recurse -Force
  } else {
    Write-Host "[ADD] File:   $rel"
    Copy-Item -LiteralPath $src -Destination $dest -Force
  }
}

if (Test-Path -LiteralPath $OutZip) {
  Remove-Item -LiteralPath $OutZip -Force
}

Compress-Archive -LiteralPath (Join-Path $stage "*") -DestinationPath $OutZip -Force

Write-Host ""
Write-Host "[OK] Created: $OutZip" -ForegroundColor Green
Write-Host "[OK] You can upload this zip here." -ForegroundColor Green
Write-Host ""

# Cleanup stage
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Host "[OK] Cleaned staging folder." -ForegroundColor Green