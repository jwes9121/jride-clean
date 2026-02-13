# RESTORE-JRIDE_RIDE_PAGE_PICK_CLEAN_BACKUP_V1.ps1
# ASCII-only. Scans page.tsx.bak.* and restores the newest "clean" backup.
# Clean = does not contain known corruption patterns that broke TSX parsing.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$dir = Join-Path $root "app\ride"
$target = Join-Path $dir "page.tsx"

if (!(Test-Path -LiteralPath $dir)) { Fail "Missing folder: $dir" }
if (!(Test-Path -LiteralPath $target)) { Fail "Missing target: $target" }

$bakFiles = Get-ChildItem -LiteralPath $dir -File -Filter "page.tsx.bak.*" |
  Sort-Object LastWriteTime -Descending

if (!$bakFiles -or $bakFiles.Count -eq 0) {
  Fail "No backups found in $dir matching page.tsx.bak.*"
}

function IsClean($text) {
  # Known corruptions:
  if ($text -match 'function\\\s*p4Money') { return $false }
  if ($text -match 'lines\.join\("\s*\r?\n\s*"\)') { return $false }
  if ($text -match 'return\\\s*\(') { return $false }

  # Also reject if file has any obvious stray "\ " tokens (backslash + space)
  if ($text -match '\\ ') { return $false }

  # Must still look like a TSX page (basic sanity)
  if ($text -notmatch 'return\s*\(\s*<main') { return $false }

  return $true
}

$chosen = $null

foreach ($f in $bakFiles) {
  $txt = [System.IO.File]::ReadAllText($f.FullName)
  if (IsClean $txt) {
    $chosen = $f
    break
  }
}

if (!$chosen) {
  Fail "No CLEAN backup found. All backups contain corruption patterns. We will need a different recovery approach."
}

# Keep current broken file as a sidecar
Copy-Item -LiteralPath $target -Destination ($target + ".before_restore") -Force

# Restore chosen backup
Copy-Item -LiteralPath $chosen.FullName -Destination $target -Force

Write-Host "[OK] Restored: $target"
Write-Host "[OK] From backup: $($chosen.FullName)"
Write-Host "[OK] Previous broken file saved as: $($target).before_restore"
Write-Host ""
Write-Host "NEXT:"
Write-Host "  npm.cmd run build"
