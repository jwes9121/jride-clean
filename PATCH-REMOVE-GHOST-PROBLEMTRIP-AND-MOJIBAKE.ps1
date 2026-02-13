# PATCH-REMOVE-GHOST-PROBLEMTRIP-AND-MOJIBAKE.ps1
# Run from repo root:
#   powershell -ExecutionPolicy Bypass -File .\PATCH-REMOVE-GHOST-PROBLEMTRIP-AND-MOJIBAKE.ps1

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd-HHmmss" }

$ts = Stamp
$root = Get-Location

$liveTrips = "app\admin\livetrips\LiveTripsClient.tsx"
$smartSug  = "app\admin\livetrips\components\SmartAutoAssignSuggestions.tsx"
$dispatch  = "app\dispatch\page.tsx"

$targets = @($liveTrips, $smartSug, $dispatch)

Write-Host "[0/4] Repo: $root" -ForegroundColor Cyan

# 1) Backups
Write-Host "[1/4] Creating backups..." -ForegroundColor Cyan
foreach ($f in $targets) {
  if (!(Test-Path $f)) { Fail "Missing file: $f" }
  Copy-Item $f "$f.bak.$ts" -Force
  Write-Host "  [OK] Backup: $f.bak.$ts" -ForegroundColor Green
}

# Helpers: read/write UTF-8 (no BOM)
function ReadUtf8NoBom([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes((Join-Path $root $path))
  return [System.Text.UTF8Encoding]::new($false).GetString($bytes)
}
function WriteUtf8NoBom([string]$path, [string]$text) {
  $enc = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllBytes((Join-Path $root $path), $enc.GetBytes($text))
}

# Mojibake scrub (keep it minimal + safe)
function FixMojibake([string]$t) {
  $t = $t.Replace("â€¦", "...")     # ellipsis
  $t = $t.Replace("…", "...")       # real ellipsis (just in case)
  $t = $t.Replace("â€¢", " - ")     # bullet
  $t = $t.Replace("•", " - ")       # bullet
  $t = $t.Replace("", "")          # stray 
  return $t
}

# 2) Patch LiveTripsClient.tsx (remove ghost trips + scrub mojibake)
Write-Host "[2/4] Patching LiveTripsClient.tsx (hide ghost trips + fix mojibake)..." -ForegroundColor Cyan
$lt = ReadUtf8NoBom $liveTrips

$lt = FixMojibake $lt

# Insert a filter after `const normalized = trips.map((t) => ({ ... }))`
# We do structure-based insertion: find the exact `setAllTrips(normalized);` and add a filter just before it.
$needle = "setAllTrips(normalized);"
if ($lt -notmatch [regex]::Escape($needle)) {
  Fail "Could not find 'setAllTrips(normalized);' in $liveTrips"
}

# If already patched, don't double-apply
if ($lt -match "filter\(\(t\)\s*=>\s*\(\(t\.booking_code") {
  Write-Host "  [SKIP] Ghost-trip filter already present." -ForegroundColor Yellow
} else {
  $insert = @'
    // Hide ghost/malformed rows (no booking_code and no usable id/uuid).
    // These cannot be progressed and only create "PROBLEM" noise in the UI.
    const cleaned = normalized.filter((t) => {
      const hasCode = !!String(t.booking_code || "").trim();
      const hasId = !!String(t.uuid || t.id || "").trim();
      return hasCode || hasId;
    });

'@

  $lt = $lt.Replace($needle, $insert + "    " + $needle.Replace("normalized", "cleaned"))
}

WriteUtf8NoBom $liveTrips $lt
Write-Host "  [OK] Patched: $liveTrips" -ForegroundColor Green

# 3) Patch SmartAutoAssignSuggestions.tsx mojibake
Write-Host "[3/4] Patching SmartAutoAssignSuggestions.tsx (fix mojibake)..." -ForegroundColor Cyan
$sa = ReadUtf8NoBom $smartSug
$sa2 = FixMojibake $sa
if ($sa2 -ne $sa) {
  WriteUtf8NoBom $smartSug $sa2
  Write-Host "  [OK] Patched: $smartSug" -ForegroundColor Green
} else {
  Write-Host "  [OK] No mojibake found in: $smartSug" -ForegroundColor Green
}

# 4) Patch Dispatch page mojibake
Write-Host "[4/4] Patching Dispatch page.tsx (fix mojibake)..." -ForegroundColor Cyan
$dp = ReadUtf8NoBom $dispatch
$dp2 = FixMojibake $dp
if ($dp2 -ne $dp) {
  WriteUtf8NoBom $dispatch $dp2
  Write-Host "  [OK] Patched: $dispatch" -ForegroundColor Green
} else {
  Write-Host "  [OK] No mojibake found in: $dispatch" -ForegroundColor Green
}

Write-Host ""
Write-Host "[DONE] Now run:" -ForegroundColor Yellow
Write-Host "  npm.cmd run build"
Write-Host "  npm.cmd run dev"
Write-Host ""
Write-Host "If anything goes wrong, restore the .bak.$ts files." -ForegroundColor Yellow
