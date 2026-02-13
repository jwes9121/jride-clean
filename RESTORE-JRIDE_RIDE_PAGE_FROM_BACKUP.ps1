# RESTORE-JRIDE_RIDE_PAGE_FROM_BACKUP.ps1
# One file only: app\ride\page.tsx
# Restores from a known backup to fix brace/JSX corruption.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

$root = Get-Location
$target = Join-Path $root "app\ride\page.tsx"
if (!(Test-Path $target)) { Fail "Target file not found: $target" }

$preferred = Join-Path $root "app\ride\page.tsx.bak.20260103_074102"

$bakToUse = $null
if (Test-Path $preferred) {
  $bakToUse = $preferred
  Ok "Preferred backup found: $bakToUse"
} else {
  Warn "Preferred backup missing: $preferred"
  $baks = Get-ChildItem -Path (Join-Path $root "app\ride") -Filter "page.tsx.bak.*" -File | Sort-Object LastWriteTime -Descending
  if (!$baks -or $baks.Count -lt 1) { Fail "No backups found under app\\ride\\ (page.tsx.bak.*)" }
  $bakToUse = $baks[0].FullName
  Ok ("Using most recent backup: " + $bakToUse)
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$pre = "$target.pre-restore.$stamp"
Copy-Item $target $pre -Force
Ok "Saved current broken file as: $pre"

Copy-Item $bakToUse $target -Force
Ok "Restored app\\ride\\page.tsx from backup."
