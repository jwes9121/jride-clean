# PATCH-JRIDE_BACKEND_ACCEPT_DOES_NOT_START_TRIP_V1.ps1
# Goal:
# - Ensure driver ACCEPT only sets status="accepted"
# - Prevent ACCEPT from setting status="on_the_way"
# Safety:
# - Backup before modifications
# - Abort if expected patterns not found

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

$RepoRoot = (Get-Location).Path

$Targets = @(
  "app\api\dispatch\status\route.ts",
  "app\api\admin\dispatch\on-the-way\route.ts"
)

$BakDir = Join-Path $RepoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $BakDir | Out-Null
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

function Backup-File([string]$fullPath) {
  $name = [IO.Path]::GetFileName($fullPath)
  $bak = Join-Path $BakDir ($name + ".bak." + $ts)
  Copy-Item -LiteralPath $fullPath -Destination $bak -Force
  Ok ("[OK] Backup: " + $bak)
}

function Show-Context([string[]]$lines, [int]$i, [int]$radius=4) {
  $start = [Math]::Max(0, $i-$radius)
  $end = [Math]::Min($lines.Count-1, $i+$radius)
  for ($j=$start; $j -le $end; $j++) {
    $prefix = if ($j -eq $i) { ">>" } else { "  " }
    Write-Host ("{0}{1,5}: {2}" -f $prefix, ($j+1), $lines[$j])
  }
}

# --- AUDIT: locate on_the_way + accepted occurrences in target files ---
$found = $false
foreach ($rel in $Targets) {
  $file = Join-Path $RepoRoot $rel
  if (-not (Test-Path -LiteralPath $file)) { continue }

  Info ""
  Info ("== AUDIT: " + $rel + " ==")
  $lines = Get-Content -LiteralPath $file -Encoding UTF8

  for ($i=0; $i -lt $lines.Count; $i++) {
    $ln = $lines[$i]
    if ($ln -match '"on_the_way"' -or $ln -match '"accepted"' -or $ln -match 'on_the_way' -or $ln -match 'accepted') {
      $found = $true
      Show-Context -lines $lines -i $i -radius 3
      Info ""
    }
  }
}

if (-not $found) {
  Warn "[WARN] Did not find any on_the_way/accepted mentions in the two main targets."
  Warn "This likely means ACCEPT is handled elsewhere. We will patch a different route."
  exit 0
}

Info ""
Info "== APPLY PATCH (dispatch/status): ensure ACCEPT => accepted (NOT on_the_way) =="

$dispatchStatusRel = "app\api\dispatch\status\route.ts"
$dispatchStatus = Join-Path $RepoRoot $dispatchStatusRel

if (-not (Test-Path -LiteralPath $dispatchStatus)) {
  Die "[FAIL] Missing: $dispatchStatusRel"
}

$src = Get-Content -LiteralPath $dispatchStatus -Raw -Encoding UTF8

# We only patch if it looks like a status updater that sets on_the_way somewhere.
if ($src -notmatch '"on_the_way"') {
  Warn "[WARN] dispatch/status does not mention on_the_way; skipping patch."
  exit 0
}

# Look for an ACCEPT action block; tolerate different styles:
# - if (action === "ACCEPT") { ... status: "on_the_way" ... }
# - case "ACCEPT": ... "on_the_way" ...
$hasAccept = ($src -match 'ACCEPT') -and ($src -match '"on_the_way"')
if (-not $hasAccept) {
  Warn "[WARN] Could not confirm ACCEPT + on_the_way in dispatch/status; aborting (no changes)."
  exit 0
}

Backup-File $dispatchStatus

# Patch rule:
# If within an ACCEPT block we see status: "on_the_way", change that specific literal to "accepted".
# To avoid breaking other endpoints, we narrow the patch to a small window around ACCEPT.

$idx = $src.IndexOf("ACCEPT")
if ($idx -lt 0) {
  Warn "[WARN] ACCEPT not found by IndexOf; aborting."
  exit 0
}

# Patch within a local window (5k chars after ACCEPT)
$windowLen = [Math]::Min(5000, $src.Length - $idx)
$window = $src.Substring($idx, $windowLen)

if ($window -notmatch '"on_the_way"') {
  Warn "[WARN] No on_the_way literal near ACCEPT window; aborting."
  exit 0
}

$window2 = [regex]::Replace($window, 'status\s*:\s*"on_the_way"', 'status: "accepted"', 1)

if ($window2 -eq $window) {
  Warn "[WARN] Could not replace status: on_the_way near ACCEPT; aborting."
  exit 0
}

$src2 = $src.Substring(0, $idx) + $window2 + $src.Substring($idx + $windowLen)

Set-Content -LiteralPath $dispatchStatus -Value $src2 -Encoding UTF8
Ok ("[OK] Patched: " + $dispatchStatusRel)

Ok ""
Ok "== DONE =="
Ok "Next: rebuild and verify driver ACCEPT no longer starts trip."
